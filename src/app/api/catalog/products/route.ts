import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { withCache } from '@/lib/cache'
import { captureError } from '@/lib/capture-error'
import { catalogService } from '@/lib/services'

// GET /api/catalog/products?tenantId=...&q=...
// Cached for 5 minutes per (tenantId, q) — products don't change often and
// the catalog view is one of the highest-traffic endpoints. Cache key
// includes tenantId to avoid cross-tenant data leaks.
//
// SPRINT7-POSTGRES-SERVICES-001 — migrated from `db.product.findMany` to
// `catalogService.getProducts`. Response shape is unchanged.
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    const q = req.nextUrl.searchParams.get('q') || ''
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

    const payload = await withCache(
      `catalog:${tenantId}:${q}`,
      5 * 60_000,
      () => fetchProducts(tenantId, q),
    )
    return NextResponse.json(payload)
  } catch (err) {
    captureError(err as Error, { path: '/api/catalog/products', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

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
