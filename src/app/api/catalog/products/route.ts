import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'

// GET /api/catalog/products?tenantId=...&q=...
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const q = req.nextUrl.searchParams.get('q') || ''
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const products = await db.product.findMany({
    where: {
      tenantId,
      active: true,
      ...(q ? { OR: [
        { name: { contains: q } }, { sku: { contains: q } },
        { diseno: { contains: q } }, { categoria: { contains: q } },
      ] } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    products: products.map(p => ({
      id: p.id, sku: p.sku, name: p.name, description: p.description,
      price: p.price, cost: p.cost, imageUrl: p.imageUrl, stock: p.stock,
      diseno: p.diseno, categoria: p.categoria,
      imagenMetadataVisible: p.imagenMetadataVisible, fuenteSincronizacion: p.fuenteSincronizacion,
    })),
    count: products.length,
  })
}
