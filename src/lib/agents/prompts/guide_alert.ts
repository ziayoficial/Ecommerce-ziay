// ────────────────────────────────────────────────────────────────────
// 7.5 — Agente de alertas de guía (guide_alert)
// Detecta guías con problemas (stuck, devuelta, extraviada) y produce
// alertas accionables para el equipo operativo del tenant.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildGuideAlertPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de alertas operativas de ${tenant.slug}. Monitoreas las guías de este
tenant y produces alertas accionables cuando detectas: guías sin movimiento > 48h, guías
devueltas, guías con novedad crítica (robo/extravío), guías con más de 2 intentos fallidos.
Formato de salida (JSON):
{"severidad": "critica|alta|media", "tipo": "stuck|devuelta|extraviada|reintentos_excedidos",
"guia": "...", "pedido": "...", "cliente": "...", "accion_recomendada": "...", "deadline": "YYYY-MM-DD"}.
NO contactas al cliente — tu salida es para el equipo operativo del tenant.`
  let stuckShipments = ''
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)
  const stuck = await db.shipment.findMany({ where: { tenantId: ctx.tenantId, estado: { in: ['generada', 'en_transito'] }, updatedAt: { lt: cutoff } }, take: 20, include: { order: { select: { number: true, customer: { select: { name: true } } } } } })
  const returned = await db.shipment.findMany({ where: { tenantId: ctx.tenantId, estado: { in: ['devuelta', 'novedad'] } }, take: 20, include: { order: { select: { number: true, customer: { select: { name: true } } } } } })
  stuckShipments = `Guías estancadas (>48h sin update): ${stuck.length}
${stuck.map(s => `- ${s.numeroGuia} | ${s.estado} | última actualización ${s.updatedAt.toISOString().slice(0, 10)} | pedido ${s.order.number} | cliente ${s.order.customer.name}`).join('\n')}

Guías con novedad o devueltas: ${returned.length}
${returned.map(s => `- ${s.numeroGuia} | ${s.estado} | novedad: ${s.novedad || 'N/A'} | pedido ${s.order.number} | cliente ${s.order.customer.name}`).join('\n')}`
  const user = `Resumen operativo para ${tenant.slug}:
${stuckShipments}

Foco solicitado: ${ctx.shipmentId ? `guía específica ${ctx.shipmentId}` : 'todas las guías del tenant'}`
  return { system, user }
}
