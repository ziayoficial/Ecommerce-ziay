// ────────────────────────────────────────────────────────────────────
// 8.2 — Agente de scoring de transportadoras (carrier_score)
// Calcula score por transportadora para un tenant: on-time rate, tasa de
// novedades, tasa de devolución, tiempo promedio de entrega.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildCarrierScorePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el motor de scoring de transportadoras de ${tenant.slug}. Para cada transportadora
canónica configurada, calculas: on_time_rate (% entregadas dentro del ETA), novedad_rate
(% envíos con novedad), devolucion_rate (% devueltas), tiempo_promedio_dias. Salida JSON:
{"carriers": [{"nombre_canonico": "...", "score": 0-100, "tier": "preferida|aceptable|evitar",
"on_time_rate": 0-1, "novedad_rate": 0-1, "devolucion_rate": 0-1, "tiempo_promedio_dias": N,
"volumen_envios": N, "recomendacion": "mantener|aumentar_volumen|reducir|suspender"}]}.
Solo puntúas transportadoras con mínimo 5 envíos; con menos, marca "datos_insuficientes".`
  const carriers = await db.carrier.findMany({ where: { tenantId: ctx.tenantId } })
  const shipments = await db.shipment.findMany({ where: { tenantId: ctx.tenantId, transportadoraCanonica: { not: null } }, select: { transportadoraCanonica: true, estado: true, novedad: true, tiempoEstimadoDias: true, createdAt: true, updatedAt: true } })
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
