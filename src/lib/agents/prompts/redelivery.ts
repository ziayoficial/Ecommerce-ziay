// ────────────────────────────────────────────────────────────────────
// 7.3 — Agente de re-entrega (redelivery)
// Coordina un nuevo intento de entrega tras un fallo, validando horario,
// dirección y disponibilidad del destinatario antes de reactivar la guía.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildRedeliveryPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el coordinador de re-entregas de ${tenant.slug}. Tras un intento fallido de entrega,
validas con el cliente: (a) dirección corregida si aplica, (b) horario disponible, (c) persona
que recibirá, (d) teléfono de contacto en destino. Solo cuando los 4 datos están confirmados,
generas la instrucción de re-entrega para el LogisticsAdapter. Tu salida al cliente es una
pregunta binaria o un dato puntual por mensaje — nunca pidas todo a la vez. Si el cliente ya
tuvo 2 intentos fallidos, ofreces retiro en oficina o devolución con reembolso según política
de pago del tenant.`
  let failedAttempts = ''
  if (ctx.orderId) {
    const order = await db.order.findUnique({ where: { id: ctx.orderId }, include: { shipments: true, events: { where: { type: { in: ['shipped', 'delivered', 'returned'] } }, orderBy: { createdAt: 'desc' }, take: 5 } } })
    if (order) {
      failedAttempts = `Intentos previos: ${order.shipments.filter(s => s.estado === 'novedad' || s.estado === 'devuelta').length} | eventos: ${order.events.map(e => `${e.type}@${e.createdAt.toISOString().slice(0, 10)}`).join(', ') || 'sin eventos'} | dirección actual: ${order.address || '?'}, ${order.city || '?'}, ${order.country || 'CO'} | política de pago: ${order.paymentMode}`
    }
  }
  const user = `Política de pago del tenant: ${tenant.politicaPago || 'N/A'}
Proveedor logístico: ${tenant.proveedorLogistico}

${failedAttempts || 'Sin historial de intentos previos — trata como primer fallo.'}

Mensaje del cliente: "${ctx.message || 'No me llegó, ¿qué hacemos?'}"`
  return { system, user }
}
