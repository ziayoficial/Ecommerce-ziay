// ────────────────────────────────────────────────────────────────────
// 7.2 — Agente de novedades logísticas (novedades)
// Maneja incidencias reportadas por la transportadora (rechazo, dirección
// errónea, destinatario no encontrado) y guía al cliente hacia resolución.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildNovedadesPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de novedades logísticas de ${tenant.slug} (estándar colombiano: Coordinadora,
Interrapidísimo, Servientrega, TCC, 99minutos). Cuando una transportadora reporta una novedad
(dirección errónea, destinatario no encontrado, rechazo, robo, extravío, devolución), tu trabajo es:
1) Clasificar la novedad (de ${ctx.novedadTipo || 'desconocida'} a una de las categorías estándar).
2) Proponer la acción correctiva inmediata (reprogramar, actualizar dirección, escalar a oficina,
contactar destinatario, iniciar reclamación).
3) Redactar un mensaje al cliente en tono_marca, explicando la situación y pidiendo SOLO la
información necesaria para resolver (pregunta binaria o dato puntual). Nunca culpes al cliente.
Máximo 30 palabras + el dato que necesitas confirmar.`
  let shipmentInfo = ''
  type ShipmentWithOrder = NonNullable<Awaited<ReturnType<typeof db.shipment.findFirst<{ include: { order: { select: { number: true; customer: { select: { name: true; phone: true; city: true; address: true } } } } } }>>>>
  let shipment: ShipmentWithOrder | null = null
  if (ctx.shipmentId) {
    shipment = await db.shipment.findUnique({
      where: { id: ctx.shipmentId },
      include: { order: { select: { number: true, customer: { select: { name: true, phone: true, city: true, address: true } } } } },
    }) as ShipmentWithOrder | null
  } else if (ctx.guia) {
    // No unique constraint on [tenantId, numeroGuia] → use findFirst.
    shipment = await db.shipment.findFirst({
      where: { tenantId: ctx.tenantId, numeroGuia: ctx.guia },
      include: { order: { select: { number: true, customer: { select: { name: true, phone: true, city: true, address: true } } } } },
    })
  }
  if (shipment) {
    shipmentInfo = `Guía ${shipment.numeroGuia} | transportadora: ${shipment.transportadoraCanonica || shipment.transportadora} | estado: ${shipment.estado} | novedad reportada: ${shipment.novedad || '(vacía)'} | pedido: ${shipment.order.number} | cliente: ${shipment.order.customer.name} | dirección original: ${shipment.order.customer.address || '?'}, ${shipment.order.customer.city || '?'}`
  }
  const user = `Tipo de novedad reportada por el proveedor: ${ctx.novedadTipo || 'Novedad genérica'}

Detalle del envío:
${shipmentInfo || 'Sin envío localizado — pide al cliente el número de guía o pedido.'}

Mensaje del cliente: "${ctx.message || '(el cliente aún no responde — redacta el primer contacto sobre la novedad)'}"`
  return { system, user }
}
