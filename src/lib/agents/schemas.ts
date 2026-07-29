// ZIAY — Esquemas de salida Zod para agentes que retornan JSON.
//
// FIX-AI-AGENTS-001 · §A-2 — Document AUDIT-AI-AGENTS-001 P0-2:
// 11 agentes piden "Salida JSON estricta" pero ninguna call-site validaba
// el output. Este archivo define el contrato de cada agente JSON y expone
// `parseAgentOutput()` para que las 3 rutas LLM puedan validar antes de
// persistir el DecisionLog y antes de devolver la respuesta al cliente.
//
// Si la salida del LLM no valida, la ruta caerá al fallback existente
// (FALLBACKS) y registrará `confidence: 0.3` (§A-3), de forma que la
// trazabilidad siga siendo honesta sin romper el flujo del usuario.
//
// v0.4.1 · Consolidación IA-3:
//   - `guide_tracking` → `postventa_logistics` (mismo schema GuideTrackingSchema).
//   - `customer_score` + `carrier_score` → `scoring` (ScoringSchema = union).
//   - `address_analysis` no va a AGENT_OUTPUT_SCHEMAS porque `address` ahora
//     tiene 2 modos (collect=texto, analyze=JSON). El modo analyze no
//     valida con schema aquí — el caller del /api/address-analysis hace
//     su propio manejo. (La confianza del agent route para modo analyze
//     queda en 0.6 — texto libre — lo cual es conservadoramente seguro.)
//   - `cart_builder` no va a AGENT_OUTPUT_SCHEMAS porque `quote` ahora tiene
//     2 modos (quote=JSON, cart=JSON con shape distinto). Similar al caso
//     anterior, modo cart queda en confianza 0.6.
//   Net: 11 → 8 esquemas registrados.

import { z } from 'zod'

/**
 * Esquemas de salida por agente. Espejan el formato JSON documentado en
 * cada system prompt (src/lib/agents/prompts/<agent>.ts).
 */
export const ProfileSchema = z.object({
  tipo: z.enum(['mayorista', 'emprendedor', 'detal']),
  confianza: z.number().min(0).max(1),
  razon: z.string(),
})

export const QuoteSchema = z.object({
  total: z.number(),
  moneda: z.string(),
  items: z.array(z.object({
    sku: z.string(),
    nombre: z.string(),
    precio: z.number(),
    cantidad: z.number(),
    subtotal: z.number(),
  })),
  envio: z.number().optional(),
})

export const CartBuilderSchema = z.object({
  items: z.array(z.object({
    sku: z.string(),
    cantidad: z.number().int().positive(),
  })),
  total: z.number(),
})

export const BuyerBehaviorSchema = z.object({
  intencion: z.enum(['compra', 'compara', 'navega', 'abandona']),
  signals: z.array(z.string()),
  recomendacion: z.string(),
})

// ── Consolidación IA-3: postventa_logistics ──────────────────────────────
// Reemplaza GuideTrackingSchema. Mismo shape — el agente postventa_logistics
// en modo 'tracking' produce el mismo JSON que el antiguo guide_tracking.
// Los modos 'alert' y 'notification' son texto libre (sin schema).
export const GuideTrackingSchema = z.object({
  estado: z.enum(['en_transito', 'entregado', 'devuelto', 'perdido', 'desconocido']),
  fechaEstimada: z.string().optional(),
  ultimaActualizacion: z.string().optional(),
})
export const PostventaLogisticsSchema = GuideTrackingSchema

// ── Consolidación IA-3: scoring ───────────────────────────────────────────
// Reemplaza CustomerScoreSchema + CarrierScoreSchema. El agente `scoring`
// tiene 2 targets con shapes distintas — usamos una unión discriminada
// (sin tag explícito, Zod hace unión simple: parsea con la primera que
// pase). CustomerScoreSchema = { score, nivel, razon };
// CarrierScoreSchema = { carrier, score, onTimeRate, issues }.
export const CustomerScoreSchema = z.object({
  score: z.number().min(0).max(100),
  nivel: z.enum(['vip', 'regular', 'en_riesgo', 'nuevo']),
  razon: z.string(),
})

export const CarrierScoreSchema = z.object({
  carrier: z.string(),
  score: z.number().min(0).max(100),
  onTimeRate: z.number().min(0).max(1),
  issues: z.array(z.string()),
})

export const ScoringSchema = z.union([CustomerScoreSchema, CarrierScoreSchema])

export const AddressAnalysisSchema = z.object({
  valid: z.boolean(),
  ciudad: z.string().optional(),
  barrio: z.string().optional(),
  sugerencia: z.string().optional(),
})

export const VisionSchema = z.object({
  producto: z.string(),
  categoria: z.string().optional(),
  // Zod v4 requiere z.record(keySchema, valueSchema) — usamos string/string
  // para atributos libres (color, talla, marca, etc.).
  atributos: z.record(z.string(), z.string()).optional(),
  altText: z.string().optional(),
})

export const NovedadesSchema = z.object({
  tipo: z.string(),
  severidad: z.enum(['baja', 'media', 'alta']),
  accion: z.string(),
})

export const RemarketingSchema = z.object({
  mensaje: z.string(),
  canal: z.enum(['whatsapp', 'messenger', 'instagram']),
  momento: z.string(),
})

// ── IA-1 (agent-builder) — control-plane agent schemas ──────────────────
// Governor / QA Reviewer / Memory Curator / Sentiment all return strict JSON
// (no prose). These schemas let the service layer validate the LLM output
// before acting on it — if validation fails, the service falls back to the
// safe default in FALLBACKS (fail-open for governor/sentiment = allow +
// neutral; fail-closed for qa_reviewer = approve original; no-op for
// memory_curator = empty facts array).

export const GovernorSchema = z.object({
  allow: z.boolean(),
  reason: z.string().max(200).default(''),
  // `redirect` is the agent name to route to instead of the orchestrator's
  // default choice (e.g. 'remarketing' for RETRACTO, 'sales_retainer' for
  // frustrated customers). null/undefined/empty string all mean "no redirect".
  redirect: z.union([z.string(), z.null()]).optional().default(null),
})

export const QAReviewerSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()).default([]),
  // `revisedOutput` is required when approved=false, optional otherwise.
  // We accept empty string too (some LLMs return "" instead of omitting).
  revisedOutput: z.string().default(''),
})

export const MemoryCuratorFactSchema = z.object({
  type: z.enum([
    'preference',
    'purchase_history',
    'objection',
    'budget',
    'brand',
    'style',
    'other',
  ]),
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(1000),
  confidence: z.number().min(0).max(1).default(0.8),
})

export const MemoryCuratorSchema = z.object({
  facts: z.array(MemoryCuratorFactSchema).default([]),
})

export const SentimentSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative', 'frustrated', 'excited']),
  score: z.number().min(-1).max(1),
  urgency: z.enum(['low', 'medium', 'high']),
  buyingIntent: z.enum(['low', 'medium', 'high']),
  churnRisk: z.enum(['low', 'medium', 'high']),
})

/**
 * Registro: nombre del agente → esquema Zod de su salida JSON.
 *
 * v0.4.1 · IA-3: 8 agentes con esquema (era 11). Los agentes que NO están
 * aquí (speech, catalog, objection, address, logistics, checkout,
 * sales_retainer, product_enrichment, marketplace, affiliator,
 * traffic_orchestrator) devuelven texto libre — no hay contrato JSON
 * que validar, por lo que `parseAgentOutput` los salta y la ruta les
 * asigna `confidence: 0.6` (§A-3).
 *
 * IA-1 (agent-builder) — +4 control-plane agents (governor, qa_reviewer,
 * memory_curator, sentiment) con esquema JSON estricto.
 */
export const AGENT_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  profile: ProfileSchema,
  quote: QuoteSchema,
  buyer_behavior: BuyerBehaviorSchema,
  postventa_logistics: PostventaLogisticsSchema,
  scoring: ScoringSchema,
  vision: VisionSchema,
  novedades: NovedadesSchema,
  remarketing: RemarketingSchema,
  // IA-1 (agent-builder) — control-plane agents
  governor: GovernorSchema,
  qa_reviewer: QAReviewerSchema,
  memory_curator: MemoryCuratorSchema,
  sentiment: SentimentSchema,
}

/**
 * Parsea y valida la salida de un agente.
 *
 * Estrategia tolerante: el LLM puede envolver el JSON en texto/prose o
 * markdown. Extraemos el primer bloque `{...}` y lo parseamos. Si el JSON
 * es válido Y pasa el schema → devolvemos el dato tipado. Si no, devolvemos
 * `null` para que la ruta decida el fallback (§A-3 confidence 0.3).
 *
 * Nunca lanza — los errores se loguean como `warn` no-blocking y la ruta
 * sigue sirviendo al usuario con la respuesta en crudo o el fallback.
 */
export function parseAgentOutput<T = unknown>(agentName: string, raw: string): T | null {
  const schema = AGENT_OUTPUT_SCHEMAS[agentName]
  if (!schema) return null // No hay esquema definido — agente de texto libre

  try {
    // Extraer el primer bloque JSON `{...}` del reply del LLM. Algunos
    // modelos envuelven el JSON en ```json ... ``` o prosa corta.
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(`Agent ${agentName} output sin bloque JSON detectable`, { rawLen: raw.length })
      return null
    }
    const parsed = JSON.parse(jsonMatch[0])
    const result = schema.safeParse(parsed)
    if (!result.success) {
      console.warn(`Agent ${agentName} output validation failed`, {
        issues: result.error.issues,
      })
      return null
    }
    return result.data as T
  } catch (e) {
    console.warn(`Agent ${agentName} output JSON parse failed`, e)
    return null
  }
}

/**
 * Indica si un agente tiene esquema de salida JSON definido.
 * Útil para que las rutas decidan el valor de `confidence` (§A-3):
 * agentes con esquema válidan a 0.8, agentes de texto libre van a 0.6.
 */
export function hasOutputSchema(agentName: string): boolean {
  return agentName in AGENT_OUTPUT_SCHEMAS
}
