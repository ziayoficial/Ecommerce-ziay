// ZIAY — API /api/shipping/guide
// Saramantha §8.6, §6.10 — generación de guía vía LogisticsAdapter.
//
// POST body: { tenantId, orderId }
// Carga el pedido, resuelve el adaptador logístico del tenant, genera la guía,
// persiste el resultado como `Shipment` en la DB (con transportadora
// normalizada contra `Carrier`) y la vincula al `Order`. Actualiza `Order.status`
// a `shipped` y crea un `OrderEvent` de tipo `shipped`.
//
// SPRINT8-SERVICES-REST-001 — migrated the order lookup + the 4-write
// persistence cascade (Shipment + Order + OrderEvent + AuditLog) to
// `logisticsService`. The carrier adapter calls still live in the route
// (they're HTTP-bound, not DB-bound). Response shape unchanged.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getLogisticsAdapter } from '@/lib/adapters/registry'
import { normalizeCarrierName } from '@/lib/carriers'
import { captureError } from '@/lib/capture-error'
import { db } from '@/lib/db'
import { logisticsService } from '@/lib/services'

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const body = await req.json()
    const { tenantId, orderId } = body as { tenantId?: string; orderId?: string }

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    // Cargar el pedido y sus items para saber cantidad de unidades y contacto.
    const order = await logisticsService.getOrderForShipment(tenantId, orderId)
    if (!order) {
      return NextResponse.json({ error: `Order not found: ${orderId}` }, { status: 404 })
    }

    const itemsCount = order.items.reduce((acc, it) => acc + it.quantity, 0) || 1

    // Construir dirección como mapa libre (cada proveedor la interpreta).
    const direccion: Record<string, string> = {
      contacto_id: order.customerId,
      nombre: order.customer.name,
      telefono: order.customer.phone ?? '',
      ciudad: order.city ?? '',
      pais: order.country ?? 'CO',
      direccion: order.address ?? '',
    }

    const adapter = await getLogisticsAdapter(tenantId)

    // Cotizar para fijar la tarifa real de la guía.
    const quote = await adapter.cotizarFlete(
      direccion.ciudad,
      direccion.pais,
      itemsCount,
    )

    // Generar la guía.
    const shipmentResult = await adapter.generarGuia({
      contacto_id: order.customerId,
      direccion,
      valor: order.total,
      items_count: itemsCount,
    })

    // Normalizar la transportadora contra el catálogo canónico del tenant.
    const transportadoraCanonica = await normalizeCarrierName(
      tenantId,
      shipmentResult.transportadora,
    )

    // Resolve the tenant's default logistics provider — the Shipment row
    // stores it as the `proveedor` field. This is a tiny read that doesn't
    // justify a service method on its own (rule #2 — 1 simple read).
    const tenantRow = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { proveedorLogistico: true },
    })

    // Persist Shipment + Order + OrderEvent + AuditLog via the service.
    const { shipment } = await logisticsService.persistShipmentGuide({
      tenantId,
      orderId: order.id,
      customerId: order.customerId,
      proveedor: tenantRow?.proveedorLogistico ?? 'dropi',
      numeroGuia: shipmentResult.numero_guia,
      urlSeguimiento: shipmentResult.url_seguimiento,
      transportadora: shipmentResult.transportadora,
      transportadoraCanonica,
      tarifa: quote.tarifa,
      tiempoEstimadoDias: quote.tiempo_estimado_dias,
      orderNumber: order.number,
    })

    return NextResponse.json({
      ok: true,
      shipment: {
        id: shipment.id,
        numero_guia: shipmentResult.numero_guia,
        url_seguimiento: shipmentResult.url_seguimiento,
        transportadora: shipmentResult.transportadora,
        transportadoraCanonica,
        tarifa: quote.tarifa,
        tiempo_estimado_dias: quote.tiempo_estimado_dias,
        estado: shipment.estado,
      },
      order: {
        id: order.id,
        number: order.number,
        status: 'shipped',
      },
    })
  } catch (err) {
    captureError(err as Error, { path: '/api/shipping/guide', method: 'POST' })
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
