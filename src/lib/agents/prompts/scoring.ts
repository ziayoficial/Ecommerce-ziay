// ────────────────────────────────────────────────────────────────────
// 8 — Agente de scoring (scoring)
// Consolidación IA-3: merge de customer_score (§8.1) + carrier_score (§8.2)
// en un único agente con 2 targets.
// ────────────────────────────────────────────────────────────────────
// El contexto `ctx.target` discrimina el sujeto del scoring:
//   - 'customer' → scorea un cliente por LTV, churn, recompra, valor
//                  estratégico (reemplaza customer_score §8.1).
//   - 'carrier'  → scorea las transportadoras del tenant por on-time rate,
//                  novedades, devoluciones y tiempo de entrega (reemplaza
//                  carrier_score §8.2).
// Si `ctx.target` no viene, se infiere: si hay `customerId` → customer;
// si hay `carrierId` o no hay `customerId` → carrier.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildScoringPrompt(
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')

  type Target = 'customer' | 'carrier'
  const target: Target =
    (ctx.target as Target | undefined) ??
    (ctx.customerId ? 'customer' : 'carrier')

  if (target === 'customer') {
    return buildCustomerBranch(tenant, ctx)
  }
  return buildCarrierBranch(tenant, ctx)
}

// ────────────────────────────────────────────────────────────────────
// Target CUSTOMER (reemplaza customer_score §8.1)
// ────────────────────────────────────────────────────────────────────
async function buildCustomerBranch(
  tenant: { slug: string; planMonetizacion: string | null; comisionPctInicial: number | null },
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  const system = `Eres el motor de scoring de clientes de ${tenant.slug}. Recibes el historial completo de
un cliente y produces un score compuesto. Salida JSON estricta:
{"cliente_id": "...", "score_total": 0-100, "tier": "vip|alto|medio|bajo|riesgo", "ltv_proyectado": N,
"prob_recompra_30d": 0.0-1.0, "riesgo_churn": 0.0-1.0, "factores_clave": [...],
"recomendacion_accion": "priorizar|fidelizar|reactivar|depriorizar", "razon": "..."}.
Cálculo basado en: frecuencia de compra, ticket promedio, recencia, perfil detectado, tasa de
cancelación previa, novedades logísticas sufridas. No inventes datos que no estén en el contexto.`
  let customerData = ''
  if (ctx.customerId) {
    const c = await db.customer.findUnique({
      where: { id: ctx.customerId },
      include: {
        orders: { select: { total: true, status: true, createdAt: true, paymentMode: true } },
        conversations: { select: { status: true, createdAt: true, perfilConversacion: true } },
      },
    })
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

// ────────────────────────────────────────────────────────────────────
// Target CARRIER (reemplaza carrier_score §8.2)
// ────────────────────────────────────────────────────────────────────
async function buildCarrierBranch(
  tenant: { slug: string },
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  const system = `Eres el motor de scoring de transportadoras de ${tenant.slug}. Para cada transportadora
canónica configurada, calculas: on_time_rate (% entregadas dentro del ETA), novedad_rate
(% envíos con novedad), devolucion_rate (% devueltas), tiempo_promedio_dias. Salida JSON:
{"carriers": [{"nombre_canonico": "...", "score": 0-100, "tier": "preferida|aceptable|evitar",
"on_time_rate": 0-1, "novedad_rate": 0-1, "devolucion_rate": 0-1, "tiempo_promedio_dias": N,
"volumen_envios": N, "recomendacion": "mantener|aumentar_volumen|reducir|suspender"}]}.
Solo puntúas transportadoras con mínimo 5 envíos; con menos, marca "datos_insuficientes".`
  const carriers = await db.carrier.findMany({ where: { tenantId: ctx.tenantId } })
  const shipments = await db.shipment.findMany({
    where: { tenantId: ctx.tenantId, transportadoraCanonica: { not: null } },
    select: { transportadoraCanonica: true, estado: true, novedad: true, tiempoEstimadoDias: true, createdAt: true, updatedAt: true },
  })
  const byCarrier = new Map<string, typeof shipments>()
  for (const s of shipments) {
    if (!s.transportadoraCanonica) continue
    if (!byCarrier.has(s.transportadoraCanonica)) byCarrier.set(s.transportadoraCanonica, [])
    byCarrier.get(s.transportadoraCanonica)!.push(s)
  }
  const user = `Transportadoras canónicas configuradas para ${tenant.slug}:
${carriers.map(c => `- ${c.nombreCanonico} (${c.cobertura}) | variantes: ${c.variantes}`).join('\n') || 'Ninguna configurada — usa transportadoraCanonica de los envíos.'}

Envíos históricos agrupados por transportadora:
${[...byCarrier.entries()].map(([name, list]) => `- ${name}: ${list.length} envíos | entregados: ${list.filter(s => s.estado === 'entregada').length} | novedad: ${list.filter(s => s.estado === 'novedad' || s.novedad).length} | devueltos: ${list.filter(s => s.estado === 'devuelta').length}`).join('\n') || 'Sin envíos históricos.'}

Foco solicitado: ${ctx.carrierId ? `carrier ${ctx.carrierId}` : 'todas las transportadoras'}`
  return { system, user }
}
