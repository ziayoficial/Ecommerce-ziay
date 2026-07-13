// ────────────────────────────────────────────────────────────────────
// 7.1 — Agente de seguimiento de guía (guide_tracking)
// Consulta el estado de una guía vía LogisticsAdapter y reporta al cliente
// en lenguaje cercano, con el tono de marca del tenant.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildGuideTrackingPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de seguimiento de guías de ${tenant.slug}. Recibes una guía o número de
pedido, consultas el estado real vía LogisticsAdapter (no inventes estados) y devuelves un mensaje
cercano al cliente (tuteando, tono_marca del tenant) con: transportadora, estado actual, última
novedad si la hay, y ubicación aproximada o ETA. Si la guía no existe para este tenant, dilo. Si
ya fue entregada, felicita y pide feedback en una pregunta binaria. Máximo 25 palabras + el dato
de la guía.`
  let shipmentInfo = ''
  type ShipmentWithOrder = NonNullable<Awaited<ReturnType<typeof db.shipment.findFirst<{ include: { order: { select: { number: true; customer: { select: { name: true; city: true } } } } } }>>>>
  let shipment: ShipmentWithOrder | null = null
  if (ctx.shipmentId) {
    shipment = await db.shipment.findUnique({
      where: { id: ctx.shipmentId },
      include: { order: { select: { number: true, customer: { select: { name: true, city: true } } } } },
    }) as ShipmentWithOrder | null
  } else if (ctx.guia) {
    // No unique constraint on [tenantId, numeroGuia] → use findFirst.
    shipment = await db.shipment.findFirst({
      where: { tenantId: ctx.tenantId, numeroGuia: ctx.guia },
      include: { order: { select: { number: true, customer: { select: { name: true, city: true } } } } },
    })
  } else if (ctx.orderId) {
    shipment = await db.shipment.findFirst({
      where: { tenantId: ctx.tenantId, orderId: ctx.orderId },
      include: { order: { select: { number: true, customer: { select: { name: true, city: true } } } } },
    })
  }
  if (shipment) {
    shipmentInfo = `Guía ${shipment.numeroGuia || '(sin número)'} | transportadora: ${shipment.transportadoraCanonica || shipment.transportadora || shipment.proveedor} | estado: ${shipment.estado} | novedad: ${shipment.novedad || 'ninguna'} | ETA: ${shipment.tiempoEstimadoDias ?? '?'} días | pedido: ${shipment.order.number} | cliente: ${shipment.order.customer.name} (${shipment.order.customer.city || '?'})`
  }
  const user = `Proveedor logístico del tenant: ${tenant.proveedorLogistico}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}

Estado real de la guía (vía DB — el LogisticsAdapter refrescará antes de responder):
${shipmentInfo || 'No se encontró guía con los datos proporcionados — pide al cliente el número de pedido o guía.'}

Consulta del cliente: "${ctx.message || '¿Dónde está mi pedido?'}"`
  return { system, user }
}
