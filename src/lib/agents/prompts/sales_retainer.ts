// ────────────────────────────────────────────────────────────────────
// 7.6 — Agente retenedor de ventas (sales_retainer)
// Detecta ventas en riesgo de cancelación (cliente dice "lo pienso",
// "me lo cambio", "lo cancelo") y aplica la técnica de retención correcta.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildSalesRetainerPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el retenedor de ventas de ${tenant.slug}. Cuando un cliente muestra señal de
cancelación o duda ("lo pienso", "me arrepentí", "mejor no", "lo cancelo"), aplicas:
1) Reconoces la emoción en una frase corta (sin disculparte por el producto).
2) Refuerzas el valor ya acordado (precio, margen, exclusividad) — consulta la cotización real.
3) Ofreces UNA sola alternativa concreta (no muchas): cambio de diseño, pago contra entrega,
agendar entrega, pequeño bono de fidelización. Nunca descuento agresivo sin autorización.
4) Cierras con pregunta binaria. Si el cliente insiste en cancelar, respetas y registras el motivo.
Máximo 25 palabras + la alternativa. Nunca presionas más de dos veces en la misma conversación.`
  let orderContext = ''
  if (ctx.orderId) {
    const order = await db.order.findUnique({ where: { id: ctx.orderId }, include: { items: true, customer: { select: { name: true } } } })
    if (order) {
      orderContext = `Pedido ${order.number} | total $${order.total} | estado ${order.status} | items: ${order.items.map(i => `${i.quantity}× ${i.name} ($${i.unitPrice})`).join(', ')} | cliente ${order.customer.name}`
    }
  }
  const objections = await db.objection.findMany({ where: { tenantId: ctx.tenantId, tipoObjecion: { in: ['lo_pienso', 'cancelacion', 'devolucion'] } } })
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}
Política de pago: ${tenant.politicaPago || 'N/A'}

Pedido en riesgo:
${orderContext || 'Sin pedido asociado — usa el historial de la conversación.'}

Respuestas base configuradas para objeciones de duda/cancelación:
${objections.map(o => `- ${o.tipoObjecion}: "${o.respuestaBase}" (gatillo: ${o.gatilloMentalAsociado || 'N/A'})`).join('\n') || 'Sin guiones preconfigurados — aplica técnica general de retención.'}

Mensaje del cliente: "${ctx.message || 'Lo voy a pensar'}"`
  return { system, user }
}
