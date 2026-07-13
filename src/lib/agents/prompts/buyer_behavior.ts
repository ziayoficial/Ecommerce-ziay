// ────────────────────────────────────────────────────────────────────
// 6.11 — Agente de comportamiento de compra (buyer_behavior)
// Analiza señales de comportamiento del lead para predecir intención
// de compra y recomendar la siguiente acción del orquestador.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildBuyerBehaviorPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el analista de comportamiento de compra de ${tenant.slug} (plataforma ZIAY,
contexto Saramantha / Indisutex). Recibes el historial de mensajes y eventos del lead y produces un
diagnóstico estructurado. Tu única salida es JSON con esta forma:
{"intencion": "alta|media|baja|fraude_potencial", "signals": [...], "siguiente_accion":
"cotizar|enviar_catalogo|pedir_datos|escalar_humano|esperar", "confianza": 0.0-1.0,
"razon": "texto breve en español"}. No inventes señales que no estén en el historial. Si el lead es
reincidente (mismo teléfono o psid), prioriza el patrón de compra anterior.`
  let messagesSummary = ''
  if (ctx.conversationId) {
    const msgs = await db.message.findMany({ where: { conversationId: ctx.conversationId }, orderBy: { createdAt: 'asc' }, take: 30, select: { direction: true, body: true, type: true, createdAt: true } })
    messagesSummary = msgs.map(m => `[${m.direction}/${m.type}] ${m.body.slice(0, 200)}`).join('\n')
  }
  let customerInfo = ''
  if (ctx.customerId) {
    const c = await db.customer.findUnique({ where: { id: ctx.customerId }, select: { name: true, perfilDetectado: true, lifetimeValue: true, ordersCount: true, city: true, country: true } })
    if (c) customerInfo = `Cliente: ${c.name} | perfil: ${c.perfilDetectado || '?'} | LTV: $${c.lifetimeValue} | pedidos previos: ${c.ordersCount} | ciudad: ${c.city || '?'}, ${c.country || 'CO'}`
  }
  const user = `Contexto del lead para ${tenant.slug}:
${customerInfo || 'Cliente nuevo, sin historial previo.'}

Últimos mensajes de la conversación:
${messagesSummary || 'Sin mensajes — solo responde con siguiente_accion="esperar" y confianza baja.'}

Mensaje actual del lead: "${ctx.message || '(sin mensaje nuevo)'}"`
  return { system, user }
}
