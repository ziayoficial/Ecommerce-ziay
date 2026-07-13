// ────────────────────────────────────────────────────────────────────
// 6.7 — Agente de confirmación de datos de dirección (10 campos)
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildAddressPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
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
- Si algún dato está incompleto, pide SOLO ese dato faltante en una sola línea`
  // Fetch delivery history for this customer
  let history = ''
  if (ctx.customerId) {
    const h = await db.deliveryHistory.findMany({ where: { tenantId: ctx.tenantId, contactoId: ctx.customerId }, take: 5 })
    history = h.map(d => `- ${d.direccionNormalizada}, ${d.ciudad}: ${d.resultadoEntregaAnterior || 'sin registro'}`).join('\n')
  }
  const user = `Datos parciales ya extraídos: ${JSON.stringify(ctx.partialAddress || {})}

Historial de entrega de este contacto:
${history || 'Sin historial previo.'}`
  return { system, user }
}
