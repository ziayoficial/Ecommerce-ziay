// ────────────────────────────────────────────────────────────────────
// 9.1 — Agente de análisis de dirección (address_analysis)
// Analiza la calidad y entregabilidad de una dirección antes de despachar,
// cruzando con historial de entregas y coberturas de transportadoras.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildAddressAnalysisPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el analista de direcciones de ${tenant.slug} (Colombia-focused). Antes de despachar,
evalúas la dirección del cliente contra: (1) completitud de los 10 campos Saramantha, (2) coberturas
de las transportadoras configuradas para este tenant, (3) historial de entrega de esa dirección
para este tenant (¿hubo rechazo, novedad, devolución?), (4) normalización (barrio, vía, número,
interior, referencias). Salida JSON:
{"direccion_completa": bool, "campos_faltantes": [...], "cobertura": "nacional|internacional|sin_cobertura",
"transportadoras_disponibles": [...], "riesgo_entrega": "bajo|medio|alto", "historial_previo": "ok|rechazo|novedad|sin_registro",
"accion_recomendada": "despachar|confirmar_direccion|pedir_referencia|rechazar_envio",
"pregunta_cliente": "..."}. Nunca inventes un resultado de entrega que no esté en el historial.`
  let history = ''
  let partialAddress = ctx.partialAddress || {}
  if (ctx.customerId) {
    const h = await db.deliveryHistory.findMany({ where: { tenantId: ctx.tenantId, contactoId: ctx.customerId }, take: 5 })
    history = h.map(d => `- ${d.direccionNormalizada}, ${d.ciudad}: ${d.resultadoEntregaAnterior || 'sin registro'}`).join('\n')
  }
  if (ctx.orderId && Object.keys(partialAddress).length === 0) {
    const order = await db.order.findUnique({ where: { id: ctx.orderId }, select: { address: true, city: true, country: true } })
    if (order) partialAddress = { direccion: order.address || '', ciudad: order.city || '', pais: order.country || 'CO' }
  }
  const carriers = await db.carrier.findMany({ where: { tenantId: ctx.tenantId }, select: { nombreCanonico: true, cobertura: true } })
  const user = `Proveedor logístico principal: ${tenant.proveedorLogistico}
Transportadoras canónicas: ${carriers.map(c => `${c.nombreCanonico} (${c.cobertura})`).join(', ') || 'ninguna configurada'}

Dirección a analizar: ${JSON.stringify(partialAddress)}

Historial de entrega de este contacto:
${history || 'Sin historial previo.'}

Mensaje del cliente: "${ctx.message || '(sin mensaje — solo análisis estructural)'}"`
  return { system, user }
}
