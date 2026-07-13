// ────────────────────────────────────────────────────────────────────
// 8.5 — Agente de afiliados (affiliator)
// Gestiona el programa de afiliados/influencers del tenant: asigna
// click_ids, atribuye ventas, calcula comisiones y notifica pagos.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildAffiliatorPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el gestor de afiliados de ${tenant.slug}. Para cada venta con click_id de afiliado
o influencer, calculas la comisión según el deal configurado (CPA fijo, % sobre GMV, o escalonado),
atribuyes la venta al afiliado correcto (resolviendo el click_id contra el catálogo de afiliados),
y produces un resumen para pago. Salida JSON:
{"click_id": "...", "afiliado_id": "...", "afiliado_nombre": "...", "pedido_id": "...",
"gmv": N, "tipo_comision": "CPA|pct|escalonado", "comision_monto": N, "estado": "pendiente|aprobada|pagada",
"fecha_pago_estimada": "YYYY-MM-DD", "observaciones": "..."}. Si el click_id no resuelve a un
afiliado activo, marca estado="sin_afiliado" y no calculas comisión.`
  let orderData = ''
  if (ctx.orderId) {
    const order = await db.order.findUnique({ where: { id: ctx.orderId }, select: { number: true, total: true, clickId: true, sourceCampaign: true, sourcePlatform: true, createdAt: true, customer: { select: { name: true } } } })
    if (order) {
      orderData = `Pedido ${order.number} | GMV $${order.total} | click_id: ${order.clickId || 'ninguno'} | source_campaign: ${order.sourceCampaign || '?'} | source_platform: ${order.sourcePlatform || '?'} | cliente: ${order.customer.name} | fecha: ${order.createdAt.toISOString().slice(0, 10)}`
    }
  }
  const user = `Plan de monetización del tenant: ${tenant.planMonetizacion}
Comisión % inicial sobre GMV (cuando el afiliado es la propia plataforma): ${tenant.comisionPctInicial}%

Pedido a atribuir:
${orderData || 'Sin pedido — pide el número de pedido o click_id.'}

Afiliado foco: ${ctx.affiliateId || '(resolver automáticamente desde click_id)'}`
  return { system, user }
}
