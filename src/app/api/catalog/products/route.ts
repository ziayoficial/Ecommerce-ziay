import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { withCache } from '@/lib/cache'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { catalogService } from '@/lib/services'

// GET /api/catalog/products?tenantId=...&q=...
// Cached for 5 minutes per (tenantId, q) — products don't change often and
// the catalog view is one of the highest-traffic endpoints. Cache key
// includes tenantId to avoid cross-tenant data leaks.
//
// SPRINT7-POSTGRES-SERVICES-001 — migrated from `db.product.findMany` to
// `catalogService.getProducts`. Response shape is unchanged.
//
// FIX-SECURITY-AUTH-001 (#24) — tenantId is verified against the caller's
// session via requireTenantAccess. Any authed user used to be able to read
// any tenant's product catalog.
//
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapped with `withErrorHandling` so any
// unhandled exception is funneled through Sentry + the structured pino
// logger.
/**
 * GET /api/catalog/products
 *
 * List catalog products with search/pagination.
 *
 * @security Requires authentication + tenant access
 * @returns Paginated product list
 */
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const q = req.nextUrl.searchParams.get('q') || ''

  const payload = await withCache(
    `catalog:${tenantId}:${q}`,
    5 * 60_000,
    () => fetchProducts(tenantId, q),
  )
  return NextResponse.json(payload)
})

async function fetchProducts(tenantId: string, q: string) {
  const products = await catalogService.getProducts(tenantId, q || undefined)

  return {
    products: products.map(p => ({
      id: p.id, sku: p.sku, name: p.name, description: p.description,
      price: p.price, cost: p.cost, imageUrl: p.imageUrl, stock: p.stock,
      diseno: p.diseno, categoria: p.categoria,
      imagenMetadataVisible: p.imagenMetadataVisible, fuenteSincronizacion: p.fuenteSincronizacion,
    })),
    count: products.length,
  }
}
