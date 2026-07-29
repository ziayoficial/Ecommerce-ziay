// ────────────────────────────────────────────────────────────────────
// 6.3 / 6.12 — Agente de cotización (quote) + constructor de carrito
// Consolidación IA-3: merge de quote (§6.3) + cart_builder (§6.12) en un
// único agente que hace las dos cosas.
// ────────────────────────────────────────────────────────────────────
// El contexto `ctx.mode` discrimina entre las 2 responsabilidades que
// antes tenían 2 agentes distintos:
//   - 'quote' (default) → recibe SKUs + cantidades y cotiza precio por
//                          volumen + margen (§6.3).
//   - 'cart'             → convierte lenguaje natural del lead en un
//                          carrito estructurado, resolviendo SKUs contra
//                          el catálogo real del tenant (§6.12).
// Si `ctx.mode` no viene, se infiere: si hay `ctx.items` con SKUs ya
// resueltos, va a 'quote'; si solo hay `ctx.message` o `ctx.cartItems`
// (lenguaje natural), va a 'cart'.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildQuotePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')

  type Mode = 'quote' | 'cart'
  const mode: Mode =
    (ctx.mode as Mode | undefined) ??
    (ctx.items && ctx.items.length > 0 ? 'quote' : 'cart')

  if (mode === 'cart') {
    return buildCartBranch(tenant, ctx)
  }
  return buildQuoteBranch(tenant, ctx)
}

// ────────────────────────────────────────────────────────────────────
// Modo QUOTE (reemplaza quote §6.3)
// ────────────────────────────────────────────────────────────────────
async function buildQuoteBranch(
  tenant: { slug: string },
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  // IA-4 (P1-2) — recalled long-term memory of this customer (past
  // purchases, budget, brand affinity). Injected into the prompt so the
  // quote can reference "lo que ya sabemos" instead of asking again.
  const memoryBlock = formatMemoryBlock(ctx.customerMemories)
  // IA-4 (P1-4) — sentiment-aware tone. If the customer shows high
  // buying intent, the quote agent moves toward closing; if frustrated,
  // uses an empathetic tone.
  const sentimentBlock = formatSentimentBlock(ctx.sentiment)
  const system = `Eres el motor de cotización de ${tenant.slug}. Recibes uno o más SKU de
interés y la cantidad de cada uno. Consulta precios_por_volumen (filtrado
por tenant_id) por cada SKU según tipo_cliente=${ctx.perfil || 'detal'} y cantidad. Suma
el total a pagar, la venta estimada usando precio_ref_mercado, y el
margen total. Responde en el formato: "[cantidad] [producto] + [cantidad]
[producto]: pagas $[total] → vendes $[venta] → te sobran $[margen]
limpios". Nunca inventes un precio que no exista en la tabla. Si el SKU
no existe para este tenant, dilo explícitamente.${memoryBlock ? '\n\n' + memoryBlock : ''}${sentimentBlock ? '\n\n' + sentimentBlock : ''}`
  const itemsInfo: string[] = []
  if (ctx.items && ctx.items.length > 0) {
    for (const it of ctx.items) {
      const product = await db.product.findUnique({ where: { tenantId_sku: { tenantId: ctx.tenantId, sku: it.sku } } })
      if (product) {
        const vols = await db.volumePrice.findMany({ where: { tenantId: ctx.tenantId, productId: product.id, tipoCliente: ctx.perfil || 'detal' }, orderBy: { cantidadMinima: 'asc' }})
        const vol = vols.find(v => it.cantidad >= v.cantidadMinima && it.cantidad <= v.cantidadMaxima)
        itemsInfo.push(`SKU ${it.sku} (${product.name}) × ${it.cantidad}: precio base ${product.price}, ${vol ? `precio volumen ${vol.precioUnitario} (tramo ${vol.cantidadMinima}-${vol.cantidadMaxima})` : 'sin tramo de volumen aplicable'}`)
      } else {
        itemsInfo.push(`SKU ${it.sku}: NO EXISTE en el catálogo de este tenant`)
      }
    }
  }
  const user = `Items a cotizar:
${itemsInfo.join('\n') || 'Sin items especificados — pide al cliente qué quiere cotizar.'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// Modo CART (reemplaza cart_builder §6.12)
// ────────────────────────────────────────────────────────────────────
async function buildCartBranch(
  tenant: { slug: string },
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  // IA-4 (P1-2 / P1-4) — same memory + sentiment injection as the quote
  // branch. For cart mode, memory helps disambiguate ("el cliente siempre
  // pide talla M, no S") and sentiment guides urgency.
  const memoryBlock = formatMemoryBlock(ctx.customerMemories)
  const sentimentBlock = formatSentimentBlock(ctx.sentiment)
  const system = `Eres el constructor de carrito de ${tenant.slug}. Recibes el mensaje del lead donde pide
productos en lenguaje natural (ej. "5 camisetas de Stitch talla M y 3 pantalones lisos") y devuelves
un carrito JSON resuelto contra el catálogo real de este tenant. Formato de salida:
{"items": [{"sku": "...", "cantidad": N, "diseno": "...", "talla": "...", "nombre": "...",
"precio_unitario": N, "subtotal": N}], "subtotal_carrito": N, "items_no_resueltos": ["texto que
no pudiste mapear"]}. Si no puedes identificar un SKU con confianza > 0.7, ponlo en items_no_resueltos
y devuelve la pregunta binaria de aclaración. Nunca inventes un SKU que no exista en el catálogo
de este tenant.${memoryBlock ? '\n\n' + memoryBlock : ''}${sentimentBlock ? '\n\n' + sentimentBlock : ''}`
  const products = await db.product.findMany({
    where: { tenantId: ctx.tenantId, active: true },
    take: 60,
    select: { sku: true, name: true, diseno: true, categoria: true, price: true, stock: true },
  })
  const user = `Catálogo disponible (${products.length} productos activos):
${products.map(p => `- ${p.sku}: ${p.name} [${p.diseno || 'liso'}] cat:${p.categoria || '?'} $${p.price} stock:${p.stock}`).join('\n') || 'Catálogo vacío — informa al lead.'}

Carrito parcial actual: ${JSON.stringify(ctx.cartItems || [])}

Mensaje del lead: "${ctx.message || '(sin mensaje — pide al lead qué quiere agregar)'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// IA-4 (P1-2) — helpers shared by quote/objection/address/checkout to
// format the recalled customer memory + sentiment into prompt sections.
// Centralised so the format is consistent across agents and any future
// tweak (e.g. showing confidence, capping length) lives in one place.
// ────────────────────────────────────────────────────────────────────

/** Render the recalled CustomerMemory facts as a prompt section. Returns
 *  an empty string when there are no memories (so the caller can skip the
 *  section). Caps at 8 facts × 200 chars to bound the prompt size. */
export function formatMemoryBlock(
  memories: { type: string; key: string; value: string; confidence: number; score: number }[] | undefined,
): string {
  if (!memories || memories.length === 0) return ''
  const capped = memories.slice(0, 8)
  const lines = capped.map((m) => {
    // Truncate value at 200 chars to bound the prompt size.
    const v = m.value.length > 200 ? m.value.slice(0, 200) + '…' : m.value
    return `- ${m.type} · ${m.key}: ${v} (confianza ${m.confidence.toFixed(2)})`
  })
  return `Contexto conocido del cliente (recuperado de memoria a largo plazo — úsalo SI es relevante, NO lo repitas textualmente al cliente):\n${lines.join('\n')}`
}

/** Render the sentiment classification as a tone-adjustment instruction.
 *  Empty when sentiment is neutral/low-urgency/low-intent/low-churn or
 *  when sentiment hasn't been classified yet. */
export function formatSentimentBlock(
  sentiment: { sentiment: string; urgency: string; buyingIntent: string; churnRisk: string; decisionSource: string } | undefined,
): string {
  if (!sentiment) return ''
  // Skip when the classification is the neutral fallback (timeout/error)
  // or when there's nothing actionable.
  if (sentiment.decisionSource !== 'llm') return ''
  const parts: string[] = []
  if (sentiment.sentiment === 'frustrated') {
    parts.push('El cliente parece frustrado — usa un tono calmado y empático, reconoce su molestia antes de cotizar.')
  }
  if (sentiment.sentiment === 'excited') {
    parts.push('El cliente está entusiasmado — refuerza la energía y avanza rápido hacia el cierre.')
  }
  if (sentiment.urgency === 'high') {
    parts.push('El cliente muestra urgencia — responde sin demora y prioriza la información esencial.')
  }
  if (sentiment.buyingIntent === 'high') {
    parts.push('El cliente muestra fuerte intención de compra — mueve la conversación hacia el cierre (cantidades, dirección, pago).')
  }
  if (sentiment.churnRisk === 'high') {
    parts.push('El cliente podría estar por abandonar — ofrece un incentivo de retención (contra entrega, bono pequeño).')
  }
  if (parts.length === 0) return ''
  return `Ajuste de tono según sentimiento detectado:\n${parts.map((p) => `- ${p}`).join('\n')}`
}
