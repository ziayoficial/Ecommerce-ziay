import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { catalogService } from '@/lib/services'
import { enrichProductImage } from '@/lib/vision/pipeline'
import { getLogger } from '@/lib/logger'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/product-enrichment')

const EnrichSchema = z.object({
  tenantId: z.string().min(1),
  sku: z.string().min(1),
})

// GET /api/product-enrichment?tenantId=X
// Devuelve los ProductEnrichment del tenant + los productos que aún no tienen
// enriquecimiento (pending).
//
// SPRINT8-SERVICES-REST-001 — migrated the 3 parallel findMany calls
// (enrichments, products, enrichedSkus) to `catalogService.getEnrichments`
// + `catalogService.getActiveProductsForEnrichment`. Response shape
// unchanged.
/**
 * GET /api/product-enrichment
 *
 * List existing ProductEnrichment rows + products that still lack enrichment (pending).
 *
 * @security Requires authentication + tenant access (requireTenantAccess)
 * @returns { enrichments, pending }
 */
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId is required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

    const [{ enrichments, enrichedSkus }, products] = await Promise.all([
      catalogService.getEnrichments(tenantId),
      catalogService.getActiveProductsForEnrichment(tenantId),
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
  

})

// POST /api/product-enrichment
// Body: { tenantId, sku }
// Llama al VLM (z-ai-web-dev-sdk glm-4.6v) para analizar la imagen del producto
// y hace upsert del ProductEnrichment correspondiente.
//
// SPRINT8-SERVICES-REST-001 — migrated the `db.product.findUnique` lookup
// to `catalogService.getProductBySku` + the `db.productEnrichment.upsert`
// to `catalogService.upsertEnrichment`. Response shape unchanged.
/**
 * POST /api/product-enrichment
 *
 * Enrich a product with AI-generated description / images / attributes.
 *
 * @security Requires authentication + tenant access
 * @returns Enriched product data
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

  const limited = rateLimit(req, {
    max: 30,
    windowMs: 60_000,
    namespace: 'api:product-enrichment:post',
  })
  if (limited) return limited

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = EnrichSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const { tenantId, sku } = parseResult.data

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const product = await catalogService.getProductBySku(tenantId, String(sku))
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
  if (!product.imageUrl) {
    return NextResponse.json(
      { error: 'Product has no imageUrl — cannot enrich via VLM' },
      { status: 400 },
    )
  }

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

    const enrichment = await catalogService.upsertEnrichment({
      tenantId,
      sku: product.sku,
      tags: JSON.stringify(tagsArray),
      description: description || null,
      enrichmentScore: score,
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
  

})
