// ────────────────────────────────────────────────────────────────────
// 7.4 — Agente de remarketing (remarketing)
// Re-engancha leads fríos o conversaciones cerradas sin compra, con una
// oferta personalizada basada en perfil, historial y catálogo.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildRemarketingPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de remarketing de ${tenant.slug}. Re-enganchas leads que se enfriaron
(conversación cerrada o sin respuesta > 7 días) con UN solo mensaje personalizado. Reglas:
1) Nunca suplicas ni insistes más de una vez por lead.
2) La oferta debe tener un gatillo mental claro (escasez, exclusividad, descuento por tiempo).
3) Máximo 25 palabras, máximo 2 emojis, una sola pregunta binaria al cierre.
4) Si el lead fue mayorista, ofrece volumen. Si fue detal, ofrece novedad o combo. Si fue regalo,
ofrece ocasión especial. Si fue emprendedor, ofrece margen.
5) Nunca mientas sobre stock o precio — verifica el catálogo antes de ofrecer.`
  let leadContext = ''
  if (ctx.customerId) {
    const c = await db.customer.findUnique({ where: { id: ctx.customerId }, include: { conversations: { orderBy: { updatedAt: 'desc' }, take: 1, select: { perfilConversacion: true, updatedAt: true } }, orders: { orderBy: { createdAt: 'desc' }, take: 3, select: { number: true, total: true, createdAt: true, status: true } } } })
    if (c) {
      leadContext = `Cliente: ${c.name} | perfil: ${c.perfilDetectado || c.conversations[0]?.perfilConversacion || 'desconocido'} | pedidos previos: ${c.ordersCount} | LTV: $${c.lifetimeValue} | último contacto: ${c.conversations[0]?.updatedAt.toISOString().slice(0, 10) || '?'} | últimos pedidos: ${c.orders.map(o => `${o.number} $${o.total} (${o.status})`).join(', ') || 'nunca compró'}`
    }
  }
  const newProducts = await db.product.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { createdAt: 'desc' }, take: 3, select: { sku: true, name: true, diseno: true, price: true } })
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}

Contexto del lead:
${leadContext || 'Lead sin historial — usa la última interacción de la conversación.'}

Novedades recientes del catálogo (para gatillo de escasez/exclusividad):
${newProducts.map(p => `- ${p.name} [${p.diseno || 'liso'}] $${p.price}`).join('\n') || 'Sin novedades recientes.'}

Último mensaje del lead: "${ctx.message || '(sin mensaje — redacta el primer mensaje de re-enganche)'}"`
  return { system, user }
}
