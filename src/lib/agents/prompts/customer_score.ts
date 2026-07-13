// ────────────────────────────────────────────────────────────────────
// 8.1 — Agente de scoring de clientes (customer_score)
// Calcula un score de cliente: potencial LTV, riesgo de churn, probabilidad
// de recompra, valor estratégico para el tenant.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildCustomerScorePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el motor de scoring de clientes de ${tenant.slug}. Recibes el historial completo de
un cliente y produces un score compuesto. Salida JSON estricta:
{"cliente_id": "...", "score_total": 0-100, "tier": "vip|alto|medio|bajo|riesgo", "ltv_proyectado": N,
"prob_recompra_30d": 0.0-1.0, "riesgo_churn": 0.0-1.0, "factores_clave": [...],
"recomendacion_accion": "priorizar|fidelizar|reactivar|depriorizar", "razon": "..."}.
Cálculo basado en: frecuencia de compra, ticket promedio, recencia, perfil detectado, tasa de
cancelación previa, novedades logísticas sufridas. No inventes datos que no estén en el contexto.`
  let customerData = ''
  if (ctx.customerId) {
    const c = await db.customer.findUnique({ where: { id: ctx.customerId }, include: { orders: { select: { total: true, status: true, createdAt: true, paymentMode: true } }, conversations: { select: { status: true, createdAt: true, perfilConversacion: true } } } })
    if (c) {
      const total = c.orders.reduce((s, o) => s + o.total, 0)
      const cancelled = c.orders.filter(o => o.status === 'cancelled').length
      customerData = `ID: ${c.id} | perfil: ${c.perfilDetectado || '?'} | pedidos: ${c.ordersCount} | LTV real: $${c.lifetimeValue} (suma pedidos: $${total.toFixed(0)}) | cancelados: ${cancelled} | conversaciones: ${c.conversations.length} | creado: ${c.createdAt.toISOString().slice(0, 10)}`
    }
  }
  const user = `Tenant: ${tenant.slug} (${tenant.planMonetizacion})
Comisión % inicial: ${tenant.comisionPctInicial}

Datos del cliente a scorar:
${customerData || 'Cliente sin historial — score bajo por defecto.'}`
  return { system, user }
}
