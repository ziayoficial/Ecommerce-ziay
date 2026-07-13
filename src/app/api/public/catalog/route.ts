import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/middleware/rate-limit'

// GET /api/public/catalog?slug=X — catálogo público de un tenant para SSR del
// storefront /t/[slug]. NO requiere auth.
//
// Devuelve los productos activos del tenant + datos básicos del tenant
// (slug, marca, plataformaCatalogo).
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 120,
    windowMs: 60_000,
    namespace: 'api:public:catalog',
  })
  if (limited) return limited

  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) {
    return NextResponse.json(
      { error: 'slug is required' },
      { status: 400 },
    )
  }

  const tenant = await db.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      nombreNegocio: true,
      marca: true,
      plataformaCatalogo: true,
      activo: true,
    },
  })
  if (!tenant || !tenant.activo) {
    return NextResponse.json(
      { error: 'Tenant not found or inactive' },
      { status: 404 },
    )
  }

  const products = await db.product.findMany({
    where: { tenantId: tenant.id, active: true },
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      price: true,
      imageUrl: true,
      stock: true,
      diseno: true,
      categoria: true,
    },
    orderBy: [{ categoria: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      nombreNegocio: tenant.nombreNegocio,
      marca: tenant.marca,
      plataformaCatalogo: tenant.plataformaCatalogo,
    },
    products,
  })
}
