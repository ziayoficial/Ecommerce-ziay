import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { enrichProductImage } from '@/lib/vision/pipeline'
import { getLogger } from '@/lib/logger'

const log = getLogger('api/product-enrichment')

// GET /api/product-enrichment?tenantId=X
// Devuelve los ProductEnrichment del tenant + los productos que aún no tienen
// enriquecimiento (pending).
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId is required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const [enrichments, products, enrichedSkus] = await Promise.all([
    db.productEnrichment.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    }),
    db.product.findMany({
      where: { tenantId, active: true },
      select: { sku: true, name: true, imageUrl: true },
      orderBy: { name: 'asc' },
    }),
    db.productEnrichment.findMany({
      where: { tenantId },
      select: { sku: true },
    }),
  ])

  const enrichedSet = new Set(enrichedSkus.map((e) => e.sku))
  const pending = products
    .filter((p) => !enrichedSet.has(p.sku))
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      imageUrl: p.imageUrl,
      hasImage: !!p.imageUrl,
    }))

  return NextResponse.json({ enrichments, pending })
}

// POST /api/product-enrichment
// Body: { tenantId, sku }
// Llama al VLM (z-ai-web-dev-sdk glm-4.6v) para analizar la imagen del producto
// y hace upsert del ProductEnrichment correspondiente.
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 30,
    windowMs: 60_000,
    namespace: 'api:product-enrichment:post',
  })
  if (limited) return limited

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tenantId, sku } = body ?? {}
  if (!tenantId || !sku) {
    return NextResponse.json(
      { error: 'tenantId and sku are required' },
      { status: 400 },
    )
  }

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const product = await db.product.findUnique({
    where: { tenantId_sku: { tenantId, sku: String(sku) } },
  })
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
  if (!product.imageUrl) {
    return NextResponse.json(
      { error: 'Product has no imageUrl — cannot enrich via VLM' },
      { status: 400 },
    )
  }

  try {
    const vlm = await enrichProductImage(
      product.imageUrl,
      product.name,
      { tenantId },
    )
    const tagsArray = Array.isArray(vlm.tags) ? vlm.tags : []
    const description = [vlm.alt_image, vlm.description_seo]
      .filter(Boolean)
      .join('\n\n')
    const score = Math.min(
      1,
      (tagsArray.length > 0 ? 0.4 : 0) +
        (vlm.alt_image ? 0.3 : 0) +
        (vlm.description_seo ? 0.3 : 0),
    )

    const enrichment = await db.productEnrichment.upsert({
      where: { tenantId_sku: { tenantId, sku: product.sku } },
      create: {
        tenantId,
        sku: product.sku,
        tags: JSON.stringify(tagsArray),
        description: description || null,
        enrichmentScore: score,
      },
      update: {
        tags: JSON.stringify(tagsArray),
        description: description || null,
        enrichmentScore: score,
      },
    })

    log.info(
      { tenantId, sku: product.sku, tags: tagsArray.length, score },
      'product enriched via VLM',
    )

    return NextResponse.json({
      enrichment,
      vlm: {
        alt_image: vlm.alt_image,
        tags: vlm.tags,
        description_seo: vlm.description_seo,
      },
    })
  } catch (err) {
    log.error(
      { err, tenantId, sku: product.sku, imageUrl: product.imageUrl },
      'VLM enrichment failed',
    )
    return NextResponse.json(
      {
        error: 'Enrichment failed',
        detail: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 },
    )
  }
}
