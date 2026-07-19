// ────────────────────────────────────────────────────────────────────
// 6.7 / 9.1 — Agente de dirección (address)
// Consolidación IA-3: merge de address (§6.7) + address_analysis (§9.1)
// en un único agente que hace las dos cosas.
// ────────────────────────────────────────────────────────────────────
// El contexto `ctx.mode` discrimina entre los 2 responsabilidades que
// antes tenían 2 agentes distintos:
//   - 'collect'  (default) → recopila TODOS los datos del pedido en un
//                              solo mensaje tipo formulario (§6.7).
//   - 'analyze'                → evalúa la calidad y entregabilidad de
//                              una dirección antes de despachar, cruzando
//                              con historial de entregas y coberturas
//                              de transportadoras (§9.1).
// Si `ctx.mode` no viene, se infiere: si ya hay `partialAddress` con
// calle / ciudad / depto completos, va a 'analyze'; si no, va a 'collect'.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'
import { formatMemoryBlock, formatSentimentBlock } from './quote'

export async function buildAddressPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')

  type Mode = 'collect' | 'analyze'
  const partial = ctx.partialAddress || {}
  const looksComplete =
    Boolean(partial.direccion || partial.address) &&
    Boolean(partial.ciudad || partial.city)
  const mode: Mode =
    (ctx.mode as Mode | undefined) ?? (looksComplete ? 'analyze' : 'collect')

  // Shared lookup: historial de entrega del contacto
  let history = ''
  if (ctx.customerId) {
    const h = await db.deliveryHistory.findMany({ where: { tenantId: ctx.tenantId, contactoId: ctx.customerId }, take: 5 })
    history = h.map(d => `- ${d.direccionNormalizada}, ${d.ciudad}: ${d.resultadoEntregaAnterior || 'sin registro'}`).join('\n')
  }

  if (mode === 'analyze') {
    return buildAnalyzeBranch(tenant, ctx, history, partial)
  }
  return buildCollectBranch(tenant, history, ctx)
}

// ────────────────────────────────────────────────────────────────────
// Modo COLLECT (reemplaza address §6.7)
// ────────────────────────────────────────────────────────────────────
function buildCollectBranch(
  tenant: { slug: string },
  history: string,
  ctx: AgentContext,
): { system: string; user: string } {
  // IA-4 (P1-2 / P1-4) — recalled memory + sentiment help the address
  // collector pre-fill fields ("sabemos que tu ciudad es Medellín") and
  // adapt the tone (frustrated → patient, single question at a time).
  const memoryBlock = formatMemoryBlock(ctx.customerMemories)
  const sentimentBlock = formatSentimentBlock(ctx.sentiment)
  const system = `Eres el agente de datos de ${tenant.slug}. Cuando el lead confirma que quiere
comprar, debes recopilar TODOS los datos del pedido en UN SOLO mensaje, tipo formulario.
NUNCA pidas los datos uno por uno — siempre pide todos los campos faltantes en una sola solicitud.

FORMATO DE RESPUESTA — envía un mensaje con esta estructura:

📦 *Para completar tu pedido, necesito estos datos:*

1️⃣ *Nombre completo:* (ej: María González)
2️⃣ *Cédula / Documento:* (ej: 1037548920 — requerido por la transportadora)
3️⃣ *Teléfono:* (ej: 300 123 4567)
4️⃣ *Departamento:* (ej: Antioquia)
5️⃣ *Ciudad:* (ej: Medellín)
6️⃣ *Dirección completa:* (ej: Calle 45 # 23-18, El Poblado)
7️⃣ *Barrio:* (ej: El Poblado)
8️⃣ *Horario de entrega:* (ej: 9am-5pm / Mañana / Tarde)
9️⃣ *Talla:* (ej: S / M / L / XL / 2 / 4 / 6)
🔟 *Diseño:* (ej: Stitch / Hello Kitty / Marvel)
1️⃣1️⃣ *Cantidad:* (ej: 2 unidades)

✏️ *Copia y completa, o escribe todos los datos en un solo mensaje.*

REGLAS:
- La cédula/documento es OBLIGATORIA — las transportadoras (Dropi, Interrapidísimo, Servientrega, etc.) la requieren para generar la guía
- Si ya tienes algunos datos de la conversación, INDICA cuáles ya tienes y pide SOLO los faltantes en un solo mensaje
- NUNCA pidas un dato a la vez (ej: "¿Cuál es tu nombre?" → mal; "¿Nombre, cédula, teléfono y dirección?" → bien)
- Cuando el cliente envíe todos los datos, normaliza la dirección y consulta historial_entrega_direccion
- Si el cliente envía los datos en desorden o todos juntos, extrae cada campo y confirma
- Valida que el teléfono tenga 10 dígitos, que la cédula tenga entre 6 y 11 dígitos, que la dirección tenga vía + número
- Si algún dato está incompleto, pide SOLO ese dato faltante en una sola línea${memoryBlock ? '\n\n' + memoryBlock : ''}${sentimentBlock ? '\n\n' + sentimentBlock : ''}`
  const user = `Datos parciales ya extraídos: ${JSON.stringify({})}

Historial de entrega de este contacto:
${history || 'Sin historial previo.'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// Modo ANALYZE (reemplaza address_analysis §9.1)
// ────────────────────────────────────────────────────────────────────
async function buildAnalyzeBranch(
  tenant: { slug: string; proveedorLogistico: string },
  ctx: AgentContext,
  history: string,
  initialPartial: Record<string, string>,
): Promise<{ system: string; user: string }> {
  let partialAddress = initialPartial
  if (ctx.orderId && Object.keys(partialAddress).length === 0) {
    const order = await db.order.findUnique({
      where: { id: ctx.orderId },
      select: { address: true, city: true, country: true },
    })
    if (order) partialAddress = { direccion: order.address || '', ciudad: order.city || '', pais: order.country || 'CO' }
  }
  // IA-4 (P1-2 / P1-4) — memory (past addresses, delivery outcomes) +
  // sentiment (frustrated after a previous failed delivery → patient tone).
  const memoryBlock = formatMemoryBlock(ctx.customerMemories)
  const sentimentBlock = formatSentimentBlock(ctx.sentiment)
  const system = `Eres el analista de direcciones de ${tenant.slug} (Colombia-focused). Antes de despachar,
evalúas la dirección del cliente contra: (1) completitud de los 10 campos Saramantha, (2) coberturas
de las transportadoras configuradas para este tenant, (3) historial de entrega de esa dirección
para este tenant (¿hubo rechazo, novedad, devolución?), (4) normalización (barrio, vía, número,
interior, referencias). Salida JSON:
{"direccion_completa": bool, "campos_faltantes": [...], "cobertura": "nacional|internacional|sin_cobertura",
"transportadoras_disponibles": [...], "riesgo_entrega": "bajo|medio|alto", "historial_previo": "ok|rechazo|novedad|sin_registro",
"accion_recomendada": "despachar|confirmar_direccion|pedir_referencia|rechazar_envio",
"pregunta_cliente": "..."}. Nunca inventes un resultado de entrega que no esté en el historial.${memoryBlock ? '\n\n' + memoryBlock : ''}${sentimentBlock ? '\n\n' + sentimentBlock : ''}`
  const carriers = await db.carrier.findMany({
    where: { tenantId: ctx.tenantId },
    select: { nombreCanonico: true, cobertura: true },
  })
  const user = `Proveedor logístico principal: ${tenant.proveedorLogistico}
Transportadoras canónicas: ${carriers.map(c => `${c.nombreCanonico} (${c.cobertura})`).join(', ') || 'ninguna configurada'}

Dirección a analizar: ${JSON.stringify(partialAddress)}

Historial de entrega de este contacto:
${history || 'Sin historial previo.'}

Mensaje del cliente: "${ctx.message || '(sin mensaje — solo análisis estructural)'}"`
  return { system, user }
}
