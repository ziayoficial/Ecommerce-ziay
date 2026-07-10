// CommerceFlow OS — API /api/shipping/guide
// Saramantha §8.6, §6.10 — generación de guía vía LogisticsAdapter.
//
// POST body: { tenantId, orderId }
// Carga el pedido, resuelve el adaptador logístico del tenant, genera la guía,
// persiste el resultado como `Shipment` en la DB (con transportadora
// normalizada contra `Carrier`) y la vincula al `Order`. Actualiza `Order.status`
// a `shipped` y crea un `OrderEvent` de tipo `shipped`.

import { NextRequest, NextResponse } from 'next/server'
import { getLogisticsAdapter } from '@/lib/adapters/registry'
import { normalizeCarrierName } from '@/lib/carriers'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
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
    const order = await db.order.findFirst({
      where: { tenantId, id: orderId },
      include: { items: true, customer: true },
    })
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

    // Persistir como Shipment.
    const shipment = await db.shipment.create({
      data: {
        tenantId,
        orderId: order.id,
        proveedor: (await db.tenant.findUnique({ where: { id: tenantId }, select: { proveedorLogistico: true } }))?.proveedorLogistico ?? 'dropi',
        numeroGuia: shipmentResult.numero_guia,
        urlSeguimiento: shipmentResult.url_seguimiento,
        transportadora: shipmentResult.transportadora,
        transportadoraCanonica,
        tarifa: quote.tarifa,
        tiempoEstimadoDias: quote.tiempo_estimado_dias,
        estado: 'generada',
      },
    })

    // Actualizar estado del pedido y registrar evento.
    await db.order.update({
      where: { id: order.id },
      data: {
        status: 'shipped',
        shipping: quote.tarifa,
      },
    })
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'shipped',
        note: `Guía ${shipmentResult.numero_guia} (${transportadoraCanonica}) — $${quote.tarifa} COP, ETA ${quote.tiempo_estimado_dias} días`,
      },
    })
    await db.auditLog.create({
      data: {
        tenantId,
        action: 'shipping_guide_generated',
        entity: 'shipment',
        entityId: shipment.id,
        meta: JSON.stringify({
          orderId: order.id,
          numero_guia: shipmentResult.numero_guia,
          transportadora: shipmentResult.transportadora,
          transportadoraCanonica,
          tarifa: quote.tarifa,
        }),
      },
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
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
