// ────────────────────────────────────────────────────────────────────
// IA-1 — Memory Curator agent (long-term customer memory extraction)
// ────────────────────────────────────────────────────────────────────
//
// Runs ASYNC after each conversation turn (fire-and-forget — never blocks
// the response to the customer). Reads the latest N messages of the
// conversation, extracts structured facts (preferences, past purchases,
// objections, budget, brand affinity, communication style), and persists
// them in the `CustomerMemory` table with embeddings for semantic recall.
//
// Output: strict JSON — an array of fact objects:
//   {
//     "facts": [
//       {
//         "type": "preference|purchase_history|objection|budget|brand|style|other",
//         "key": "preferred_payment",
//         "value": "contra entrega",
//         "confidence": 0.92,
//         "extractedFrom": "current_turn"
//       },
//       ...
//     ]
//   }
//
// The service layer (memory-curator.service.ts) is responsible for:
//   - de-duplicating against existing facts (same type+key → update value)
//   - computing the embedding of `${key}: ${value}` and storing it
//   - stamping `extractedFrom` with the actual conversationId
//
// Design notes:
//   - The curator is encouraged to extract ONLY facts that are explicitly
//     stated or strongly implied — never speculative ("the customer might
//     prefer X"). `confidence` reflects this (≥0.7 for explicit, 0.4-0.7
//     for implied, <0.4 → don't extract).
//   - Empty output `{"facts": []}` is valid — most turns don't reveal
//     durable facts. The service layer handles it gracefully.
//
// IA-1 (agent-builder)

import { db } from '@/lib/db'
import type { AgentContext } from './types'
import { buildRulesBlock } from '../rules'

export async function buildMemoryCuratorPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')

  const rulesBlock = buildRulesBlock({
    siempre: [
      'responder SIEMPRE con un único objeto JSON válido — sin prosa, sin markdown',
      'extraer SOLO hechos explícitos o fuertemente implícitos — nunca especulativos',
      'usar `key` canónico en snake_case (preferred_payment, size, favorite_brand, objection_price)',
      'confidence ≥ 0.7 para explícito, 0.4-0.7 para implícito, < 0.4 → no extraer',
    ],
    nunca: [
      'extraer datos sensibles (documento, tarjeta, dirección completa) — esos no son memoria útil',
      'inventar preferencias que el cliente no expresó',
      'extraer la misma preferencia dos veces en el mismo turno',
    ],
  })

  const system = `Eres el Curador de Memoria de ${tenant.slug}. Lees el último turno de conversación entre un cliente y los agentes de la plataforma, y extraes hechos estructurados duraderos que serán útiles para futuras conversaciones con este cliente.

Tu ÚNICA salida es un objeto JSON con esta forma exacta:
{
  "facts": [
    {
      "type": "preference" | "purchase_history" | "objection" | "budget" | "brand" | "style" | "other",
      "key": "snake_case_canonical_key",
      "value": "valor extraído en lenguaje natural",
      "confidence": 0.0-1.0
    }
  ]
}

Tipos de hechos a extraer (con ejemplos):

- preference: preferencias explícitas del cliente.
  - preferred_payment: "contra entrega", "transferencia", "tarjeta"
  - size: "M", "L", "talla 36"
  - preferred_channel: "whatsapp", "messenger"
  - preferred_contact_time: "mañana", "tarde"

- purchase_history: compras o interés de compra explícito.
  - last_product_inquired: "SHORT-TIRA, 12 unidades"
  - last_category: "short", "familia", "pantalon"
  - last_volume: "12 unidades (mayorista)"

- objection: objeciones levantadas por el cliente.
  - objection_price: "muy caro"
  - objection_shipping: "el envío tarda mucho"
  - objection_competitor: "X lo tiene más barato"

- budget: presupuesto mencionado.
  - budget_max: "$50.000"
  - budget_monthly: "$200.000/mes"

- brand: afinidad o aversión de marca.
  - favorite_brand: "Stitch", "Hello Kitty"
  - brand_aversion: "no me gusta X"

- style: estilo de comunicación del cliente.
  - formality: "formal", "casual"
  - emoji_usage: "alto", "bajo", "ninguno"
  - language: "español", "portugués", "inglés"

- other: cualquier otro hecho duradero relevante.

Reglas de extracción:
- Extraer SOLO hechos que aparezcan EXPLÍCITAMENTE en el último turno (o fuertemente implícitos).
- Un cliente que dice "quiero 12 unidades del short talla M y pago contra entrega"
  genera: purchase_history.last_volume=12, preference.size=M, preference.preferred_payment=contra entrega.
- Un cliente que solo dice "hola" genera facts=[] (sin hechos duraderos).
- No extraer PII sensible (documento, tarjeta, dirección completa).
- confidence refleja qué tan explícito fue el hecho:
  - 0.9-1.0: explícito ("pago contra entrega")
  - 0.7-0.9: implícito claro ("¿aceptan Nequi?" → preferred_payment=Nequi)
  - 0.4-0.7: implícito débil (extraer solo si es claramente útil)
  - < 0.4: NO extraer

${rulesBlock}`

  // `ctx.message` carries the latest turn transcript (customer message +
  // agent reply) — injected by the memory-curator.service. Using
  // `ctx.message` keeps the AgentContext shape stable.
  const user = `Contexto de extracción:
- tenant: ${tenant.slug}
- conversationId: ${ctx.conversationId ?? 'n/a'}
- customerId: ${ctx.customerId ?? 'n/a'}
- perfil del cliente: ${ctx.perfil ?? 'desconocido'}

Último turno de conversación (cliente + respuesta del agente):
<conversation_turn>
${(ctx.message ?? '').slice(0, 6000)}
</conversation_turn>

Extrae los hechos duraderos del turno. Responde solo con el objeto JSON.`

  return { system, user }
}
