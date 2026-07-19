// ZIAY — Model Router (IA-2 · agent-hardening)
//
// Splits the 24-agent fleet across three LLM tiers based on the task's
// accuracy requirement:
//
//   cheap    → glm-4.6-flash  — classification, extraction, fast triage
//   standard → glm-4.6        — reasoning, formatting, search
//   frontier → glm-4.6-plus   — revenue-critical calls (quote, objection,
//                               checkout, qa_reviewer) where bad output
//                               directly costs us a sale or a refund.
//
// The split mirrors the production cost-control strategy documented in
// `public/presentaciones/INVESTIGACION-AGENTES-IA.md` §7.2 (model routing
// delivers a 55-65% saving vs routing every call through the frontier model).
//
// The pricing table is the single source of truth consumed by both
// `BudgetManager` (cost ledger per call) and `AgentTracer` (cost attribution
// on each span). When the underlying provider changes prices, update the
// numbers here and every downstream cost calculation picks them up.
//
// NOTE: the per-1K prices below are conservative USD estimates — they map
// cleanly onto the existing `src/lib/llm/costs.ts` table (which is keyed by
// model string). The router is intentionally provider-agnostic: a tenant's
// `proveedorIa` still selects the adapter; this layer only picks the model
// tier within that provider. For ZAI (default), the three tiers map onto
// `glm-4.6-flash` / `glm-4.6` / `glm-4.6-plus`. For OpenAI the equivalent
// tiers would be `gpt-4o-mini` / `gpt-4o` / `gpt-4.1` — when that becomes
// relevant, add a `MODEL_TIERS_BY_PROVIDER` map and resolve at call time.
//
// IA-4 (P2-7) — removed 7 stale entries for agents retired in IA-3
// (cart_builder, guide_tracking, guide_alert, customer_score,
// carrier_score, logistics_notifier, address_analysis, theme). Added
// explicit entries for the new IA-1 control-plane agents
// (postventa_logistics, scoring) so the router is in sync with the
// 24-agent fleet in `AGENT_NAMES`.
// ───────────────────────────────────────────────────────────────────────────

export type ModelTier = 'cheap' | 'standard' | 'frontier'

export interface ModelTierPricing {
  /** Model identifier passed to the LLM adapter. */
  model: string
  /** USD cost per 1K prompt (input) tokens. */
  costPer1kIn: number
  /** USD cost per 1K completion (output) tokens. */
  costPer1kOut: number
}

/**
 * Tier → model + pricing. The model strings match ZAI's GLM-4.6 family
 * (default provider). `costPer1kIn`/`costPer1kOut` are USD estimates based
 * on public ZAI / BigModel pricing as of 2026-Q3 — kept conservative so the
 * budget ledger doesn't under-count spend.
 */
export const MODEL_TIERS: Record<ModelTier, ModelTierPricing> = {
  cheap: { model: 'glm-4.6-flash', costPer1kIn: 0.0001, costPer1kOut: 0.0002 },
  standard: { model: 'glm-4.6', costPer1kIn: 0.0005, costPer1kOut: 0.0015 },
  frontier: { model: 'glm-4.6-plus', costPer1kIn: 0.003, costPer1kOut: 0.015 },
}

/**
 * Per-agent tier assignment. Agents that touch revenue (quote, objection,
 * checkout, qa_reviewer) run on the frontier tier — a wrong quote loses a
 * sale or exposes us to a refund dispute. Agents that just classify or
 * extract (governor, sentiment, memory_curator) run on the cheap tier —
 * the task is binary enough that a flash model handles it reliably.
 *
 * Agents NOT in this map default to `'standard'` (see `getModelForAgent`).
 * That's the right default for the long tail of post-venta + intelligence
 * agents where the task is neither trivial nor revenue-critical.
 *
 * IA-4 (P2-7) — kept in sync with the 24-agent `AGENT_NAMES` list:
 *   - 4 cheap: governor, sentiment, memory_curator, profile.
 *   - 16 standard: speech, catalog, address, logistics, buyer_behavior,
 *     redelivery, remarketing, sales_retainer, postventa_logistics,
 *     product_enrichment, marketplace, affiliator, traffic_orchestrator,
 *     vision, novedades, scoring.
 *   - 4 frontier: quote, objection, checkout, qa_reviewer.
 */
export const AGENT_MODEL_TIER: Record<string, ModelTier> = {
  // ── Cheap: classification / triage ──
  governor: 'cheap',
  sentiment: 'cheap',
  memory_curator: 'cheap',
  profile: 'cheap',

  // ── Standard: reasoning / formatting ──
  speech: 'standard',
  catalog: 'standard',
  address: 'standard',
  logistics: 'standard',
  buyer_behavior: 'standard',
  redelivery: 'standard',
  remarketing: 'standard',
  sales_retainer: 'standard',
  postventa_logistics: 'standard',
  scoring: 'standard',
  product_enrichment: 'standard',
  marketplace: 'standard',
  affiliator: 'standard',
  traffic_orchestrator: 'standard',
  vision: 'standard',
  novedades: 'standard',

  // ── Frontier: revenue-critical ──
  quote: 'frontier',
  objection: 'frontier',
  checkout: 'frontier',
  qa_reviewer: 'frontier',
}

/**
 * Resolve the model + tier for an agent. Unknown agent names fall back to
 * the `standard` tier (glm-4.6) — a safe middle ground that won't blow the
 * budget on a misconfigured agent name but also won't under-power a real
 * reasoning task.
 */
export function getModelForAgent(agentName: string): { model: string; tier: ModelTier } {
  const tier = AGENT_MODEL_TIER[agentName] ?? 'standard'
  return { model: MODEL_TIERS[tier].model, tier }
}

/**
 * Estimate the USD cost of an agent call given the actual token usage.
 *
 * Used by:
 *   - `AgentTracer.endSpan()` — attributes cost to the trace.
 *   - `BudgetManager.recordUsage()` — debits the tenant's ledger.
 *   - `BudgetManager.checkBudget()` — pre-flight estimate using
 *     `estimatedTokens` before the call (worst-case cap).
 *
 * Returns 0 when both token counts are 0 (e.g. a cached / fallback path
 * that never hit the LLM) — keeps the ledger honest without throwing.
 */
export function estimateCost(agentName: string, tokensIn: number, tokensOut: number): number {
  const tier = AGENT_MODEL_TIER[agentName] ?? 'standard'
  const pricing = MODEL_TIERS[tier]
  const cost = (tokensIn / 1000) * pricing.costPer1kIn + (tokensOut / 1000) * pricing.costPer1kOut
  // 6-decimal precision — matches `src/lib/llm/costs.ts::calculateCost`.
  return Math.round(cost * 1_000_000) / 1_000_000
}

/**
 * Convenience: resolve the full pricing block for an agent. Useful for the
 * `/api/agents/budget` admin endpoint so operators can see the implied
 * per-call cost ceiling before limits are applied.
 */
export function getPricingForAgent(agentName: string): ModelTierPricing & { tier: ModelTier } {
  const { model, tier } = getModelForAgent(agentName)
  return { ...MODEL_TIERS[tier], model, tier }
}
