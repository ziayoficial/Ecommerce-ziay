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
//
// FIX-SECURITY-AUTH-001 (#26) — requireTenantAccess(tenantId). Any authed
// user used to be able to generate a shipping guide against any tenant's
// order (cross-tenant Shipment create + Order.status mutation).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getLogisticsAdapter } from '@/lib/adapters/registry'
import { normalizeCarrierName } from '@/lib/carriers'
import { captureError } from '@/lib/capture-error'
import { db } from '@/lib/db'
import { logisticsService } from '@/lib/services'

// TD-2: Zod schema for shipping guide POST.
const ShippingGuideSchema = z.object({
  tenantId: z.string().min(1),
  orderId: z.string().min(1),
}).passthrough()

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json()
    const parseResult = ShippingGuideSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const { tenantId, orderId } = parseResult.data

    // FIX-SECURITY-AUTH-001 (#26) — tenant gate before any external API call.
    const { error } = await requireTenantAccess(tenantId)
    if (error) return error

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
