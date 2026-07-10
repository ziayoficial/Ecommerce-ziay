// CommerceFlow OS — API /api/catalog/sync
// Saramantha §8.2–§8.5, §9.2–§9.5 — sincronización del catálogo del tenant.
//
// POST body: { tenantId }
// Resuelve el `EcommerceAdapter` del tenant, llama a `buscarProductos('')`
// para obtener todos, y upserta los resultados en la tabla `Product` con
// `fuenteSincronizacion` matching el adapter. Devuelve el conteo de productos
// sincronizados.
//
// Esta ruta es idempotente: ejecutarla múltiples veces produce el mismo estado
// final en la tabla `Product` (upsert por [tenantId, sku]).

import { NextRequest, NextResponse } from 'next/server'
import { getEcommerceAdapter } from '@/lib/adapters/registry'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { tenantId } = body as { tenantId?: string }

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { plataformaCatalogo: true, slug: true, nombreNegocio: true },
    })
    if (!tenant) {
      return NextResponse.json({ error: `Tenant not found: ${tenantId}` }, { status: 404 })
    }

    const adapter = await getEcommerceAdapter(tenantId)
    const productos = await adapter.buscarProductos('')

    // Determinar el valor de fuenteSincronizacion según plataforma del tenant.
    const fuenteMap: Record<string, string> = {
      whatsapp_catalog: 'whatsapp_catalog',
      woocommerce: 'woocommerce',
      shopify: 'shopify',
      catalogo_propio_cliente: 'supabase_cliente',
      catalogo_nuestro: 'supabase_nuestro',
    }
    const fuente = fuenteMap[tenant.plataformaCatalogo] ?? 'whatsapp_catalog'

    // Upsert por [tenantId, sku] (restricción única definida en el schema).
    let syncedCount = 0
    for (const p of productos) {
      await db.product.upsert({
        where: { tenantId_sku: { tenantId, sku: p.sku } },
        create: {
          tenantId,
          sku: p.sku,
          name: p.name,
          price: p.precio,
          imageUrl: p.imagen_url || null,
          stock: p.stock,
          diseno: p.diseno ?? null,
          categoria: p.categoria ?? null,
          fuenteSincronizacion: fuente,
        },
        update: {
          name: p.name,
          price: p.precio,
          imageUrl: p.imagen_url || null,
          stock: p.stock,
          diseno: p.diseno ?? null,
          categoria: p.categoria ?? null,
          fuenteSincronizacion: fuente,
        },
      })
      syncedCount++
    }

    await db.auditLog.create({
      data: {
        tenantId,
        action: 'catalog_sync',
        entity: 'product',
        meta: JSON.stringify({
          plataforma: tenant.plataformaCatalogo,
          fuente,
          synced: syncedCount,
        }),
      },
    })

    return NextResponse.json({
      ok: true,
      tenantId,
      tenantSlug: tenant.slug,
      plataforma: tenant.plataformaCatalogo,
      fuenteSincronizacion: fuente,
      synced: syncedCount,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
