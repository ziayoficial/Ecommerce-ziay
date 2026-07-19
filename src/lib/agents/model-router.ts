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
//
// IA-6A (Gap 2) — added `MODEL_FALLBACKS` + `callLLMWithFallback()`.
// When a primary model fails after retries, the call is re-attempted
// with the next-cheaper model in the fallback chain (frontier → standard
// → cheap). Ensures a single transient provider issue with glm-4.6-plus
// doesn't take down the quote/objection/checkout pipeline.
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

// ───────────────────────────────────────────────────────────────────────────
// IA-6A (Gap 2) — Model fallback chain
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-model fallback chain. When a primary model fails after retries,
 * `callLLMWithFallback` walks this chain left-to-right until one succeeds.
 *
 *   - frontier (glm-4.6-plus) → standard (glm-4.6)
 *   - standard (glm-4.6)      → cheap (glm-4.6-flash)
 *   - cheap (glm-4.6-flash)   → itself (no fallback — last resort)
 *
 * The chain is intentionally "step-down" (frontier → standard → cheap)
 * rather than "swap-provider" — switching providers mid-conversation
 * would change the model's behaviour (different training data,
 * different prompt-following style) and could confuse the agent.
 * Stepping down within the same provider family preserves behavioural
 * consistency while trading off some quality for availability.
 *
 * The chain is the SAME for every tenant regardless of `proveedorIa`
 * because the ZAI adapter is the only one with all three tiers
 * available. OpenAI/xAI/Ollama callers that don't define a chain
 * entry for their model get `model` as their own fallback (no
 * fallback) — `callLLMWithFallback` handles that gracefully.
 */
export const MODEL_FALLBACKS: Record<string, string> = {
  'glm-4.6-plus': 'glm-4.6',
  'glm-4.6': 'glm-4.6-flash',
  'glm-4.6-flash': 'glm-4.6-flash', // cheap has no fallback (last resort)
}

/**
 * Resolve the fallback chain for a primary model — returns the ordered
 * list of models to try, including the primary. De-duplicates so a
 * self-referential fallback (like `glm-4.6-flash → glm-4.6-flash`)
 * doesn't produce duplicate attempts.
 *
 * @example
 *   resolveFallbackChain('glm-4.6-plus')
 *   // → ['glm-4.6-plus', 'glm-4.6', 'glm-4.6-flash']
 */
export function resolveFallbackChain(primaryModel: string): string[] {
  const chain: string[] = [primaryModel]
  let current = primaryModel
  // Guard against circular fallback definitions (defensive — the default
  // map is acyclic, but third-party overrides could introduce cycles).
  const seen = new Set<string>([primaryModel])
  for (let i = 0; i < 5; i++) {
    const next = MODEL_FALLBACKS[current]
    if (!next || next === current || seen.has(next)) break
    chain.push(next)
    seen.add(next)
    current = next
  }
  return chain
}

/**
 * Result of `callLLMWithFallback` — carries the model that actually
 * served the call (may differ from the primary when a fallback was
 * used) plus a `fellBack` flag for observability.
 */
export interface LLMWithFallbackResult {
  /** The assistant's reply text. */
  content: string
  /** The model that actually served the call (primary or a fallback). */
  model: string
  /** Provider name from the adapter result. */
  provider: string
  /** Token usage if reported by the provider. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  /** True when a fallback model was used (the primary failed after retries). */
  fellBack: boolean
  /** The primary model that was attempted first. */
  primaryModel: string
  /** The error from the primary model (when fellBack=true). Undefined
   *  when the primary succeeded. */
  primaryError?: string
  /** Number of fallback attempts (0 when the primary succeeded). */
  fallbackAttempts: number
}

/**
 * Call the LLM with a fallback chain: try the primary model first, and
 * if it fails after retries, walk down the fallback chain until one
 * succeeds (or all fail).
 *
 * Each individual model attempt is wrapped in `withRetry` (Gap 1) — so
 * transient failures get 3 retries with exponential backoff BEFORE the
 * fallback kicks in. The fallback only fires when retries are exhausted.
 *
 * Behaviour:
 *   - Try primary. If it succeeds → return (fellBack=false).
 *   - If primary fails after retries → log + try the next model in the
 *     chain.
 *   - If ALL models in the chain fail → throw the LAST error (caller
 *     handles fallback reply / DecisionLog / escalation).
 *
 * The `agentName` argument is used for logging context only — the model
 * is resolved by the caller via `getModelForAgent(agentName).model`
 * before calling this function (so the function stays model-agnostic).
 *
 * @example
 * ```ts
 * const { model, tier } = getModelForAgent('quote')
 * const result = await callLLMWithFallback('quote', messages, { provider, primaryModel: model })
 * if (result.fellBack) {
 *   log.warn({ agent: 'quote', primary: model, actual: result.model }, 'LLM fell back to cheaper model')
 * }
 * ```
 */
export async function callLLMWithFallback(
  agentName: string,
  messages: Array<{ role: string; content: string }>,
  options: {
    primaryModel: string
    provider?: string
    timeout?: number
    thinking?: 'disabled' | 'enabled'
  },
): Promise<LLMWithFallbackResult> {
  // Lazy import to avoid a circular dependency at module-load time:
  // `retry.ts` imports `getLogger` + `captureError` only (no agent-internal
  // imports), but pulling it in at the top of `model-router.ts` would
  // create a load-order edge case where the logger isn't yet initialised
  // when `model-router.ts` is imported by `tracing.ts`. The lazy import
  // defers the resolution to call-time (after the logger is wired).
  const { withRetry } = await import('./retry')
  const { chat } = await import('@/lib/llm/adapter')
  const { getLogger } = await import('@/lib/logger')
  const fallbackLog = getLogger('agent:model-fallback')

  const chain = resolveFallbackChain(options.primaryModel)
  let primaryError: string | undefined
  let fallbackAttempts = 0

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]
    const isPrimary = i === 0
    if (!isPrimary) {
      fallbackLog.warn(
        {
          agentName,
          primaryModel: options.primaryModel,
          fallbackModel: model,
          attempt: i,
          primaryError,
        },
        'LLM primary failed — falling back to cheaper model',
      )
    }
    try {
      // Wrap each individual model attempt in `withRetry` — transient
      // failures get 3 retries with exponential backoff before we
      // escalate to the fallback. This two-layer recovery (retry within
      // a model, then fallback across models) gives the highest chance
      // of recovery without burning the budget on a permanently-broken
      // primary.
      const timeoutMs = options.timeout ?? 15_000
      const result = await withRetry(
        () =>
          Promise.race([
            chat(messages as Parameters<typeof chat>[0], {
              provider: options.provider as never,
              model,
              thinking: options.thinking ?? 'disabled',
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`LLM timeout (${timeoutMs / 1000}s)`)),
                timeoutMs,
              ),
            ),
          ]),
        // The retry config defaults (3 retries, 500ms-5s backoff) are
        // tuned for LLM API calls — no override needed.
        undefined,
      )
      return {
        content: result.content || '',
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        fellBack: !isPrimary,
        primaryModel: options.primaryModel,
        primaryError: isPrimary ? undefined : primaryError,
        fallbackAttempts,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (isPrimary) {
        primaryError = errMsg
      }
      fallbackAttempts++
      // Continue to the next model in the chain (if any).
      if (i === chain.length - 1) {
        // Last model in the chain failed — rethrow so the caller can
        // run its own fallback reply logic + DecisionLog persistence.
        fallbackLog.error(
          {
            agentName,
            primaryModel: options.primaryModel,
            attemptedModels: chain,
            lastError: errMsg,
          },
          'LLM all fallback models exhausted — surfacing error to caller',
        )
        throw err
      }
    }
  }
  // Unreachable — the for loop either returns on success or throws on
  // the last failure. The cast keeps TS happy without a `never` assertion.
  throw new Error(`callLLMWithFallback: unreachable state for agent ${agentName}`)
}
