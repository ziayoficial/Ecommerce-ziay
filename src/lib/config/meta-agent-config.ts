// ZIAY — Meta Business Agent vs. own-stack decision framework.
//
// Study §13.1: "decisión explícita sobre usar Meta Business Agent vs.
// una capa propia sobre Cloud API".
//
// Meta launched the Meta Business Agent globally on 2026-06-03 (WhatsApp +
// Messenger + Instagram). It recommends products from the catalog, schedules
// appointments, qualifies leads, and escalates to a human — all inside the
// Meta app, no code required. From August 2026 Meta charges per token for
// the agent's LLM usage, and the conversations + sales-pattern data flow
// back to Meta.
//
// This module is the SINGLE source of truth for which strategy ZIAY uses
// per deployment. The default is `own_stack` (see `META-AGENT-DECISION.md`
// for the full rationale): ZIAY's 26 specialized agents already cover the
// 6 stages of the agentic flow, the per-conversation cost is ~100x lower
// than Meta's per-token fee, and AP2/UCP compliance requires ZIAY to own
// the signing service (impossible with Meta Native).
//
// Switching strategy is a deploy-time decision (env var) — not a runtime
// toggle — because the routing logic + agent wiring are different per mode.
//
// SPRINT-FINANCE-META-001

export type MetaAgentStrategy = 'meta_native' | 'own_stack' | 'hybrid'

export interface MetaAgentConfig {
  strategy: MetaAgentStrategy
  /** Rationale — surfaced in the admin UI + decision doc for auditability. */
  rationale: string
  // ── Feature flags ──────────────────────────────────────────────
  useMetaCatalog: boolean // Meta's product catalog in WA
  useMetaAgent: boolean // Meta Business Agent (no-code)
  useOwnAgents: boolean // ZIAY's 24 agents (20 consolidated + 4 control-plane)
  useOwnSocket: boolean // ZIAY real-time via Socket.io
  // ── Cost model (USD per conversation) ──────────────────────────
  metaAgentPerTokenCost?: number // Meta charges per token from Aug 2026
  ownAgentLLMCost: number // ZIAY LLM cost per conversation
  // ── Data sharing ───────────────────────────────────────────────
  shareConversationData: boolean // Meta gets conversation data
  shareSalesPatterns: boolean // Meta gets sales patterns
}

/**
 * The three strategic options evaluated in `META-AGENT-DECISION.md`.
 * Surfaced here so the admin UI can render the trade-offs next to the
 * current selection.
 */
export const META_AGENT_STRATEGIES: Record<MetaAgentStrategy, MetaAgentConfig> = {
  meta_native: {
    strategy: 'meta_native',
    rationale:
      'Use Meta Business Agent. Lowest dev cost, but cedes data and conversation control to Meta. Meta charges per token from Aug 2026.',
    useMetaCatalog: true,
    useMetaAgent: true,
    useOwnAgents: false,
    useOwnSocket: false,
    metaAgentPerTokenCost: 0.002, // estimated — Meta has not published the rate
    ownAgentLLMCost: 0,
    shareConversationData: true,
    shareSalesPatterns: true,
  },
  own_stack: {
    strategy: 'own_stack',
    rationale:
      'Build on WhatsApp Cloud API directly. Full control of data, conversations, and agent logic. Higher dev cost but no per-token fee to Meta and no data sharing.',
    useMetaCatalog: false,
    useMetaAgent: false,
    useOwnAgents: true,
    useOwnSocket: true,
    ownAgentLLMCost: 0.015, // per conversation
    shareConversationData: false,
    shareSalesPatterns: false,
  },
  hybrid: {
    strategy: 'hybrid',
    rationale:
      'Use Meta Business Agent for simple FAQ/catalog queries (saves dev time on low-value interactions), escalate to ZIAY own agents for checkout/novedades/complex flows. Best of both worlds.',
    useMetaCatalog: true,
    useMetaAgent: true,
    useOwnAgents: true,
    useOwnSocket: true,
    metaAgentPerTokenCost: 0.002,
    ownAgentLLMCost: 0.015,
    shareConversationData: true, // Meta sees the simple queries
    shareSalesPatterns: false, // but NOT the complex flows
  },
}

/**
 * Resolve the active strategy from the `META_AGENT_STRATEGY` env var.
 *
 * Falls back to `own_stack` when the env var is missing or invalid — this
 * matches the documented decision (see `META-AGENT-DECISION.md`). An
 * invalid value is logged but never throws: the conversation flow must not
 * crash because of a config typo.
 */
export function getMetaAgentStrategy(): MetaAgentConfig {
  const raw = process.env.META_AGENT_STRATEGY as MetaAgentStrategy | undefined
  if (raw && raw in META_AGENT_STRATEGIES) {
    return META_AGENT_STRATEGIES[raw]
  }
  if (raw && !(raw in META_AGENT_STRATEGIES)) {
    console.warn(
      `[meta-agent-config] META_AGENT_STRATEGY="${raw}" is invalid — falling back to "own_stack". Valid values: meta_native | own_stack | hybrid`,
    )
  }
  return META_AGENT_STRATEGIES.own_stack
}

/**
 * Routing decision: should the current message be handled by ZIAY's own
 * agents, or can it stay with the Meta Business Agent?
 *
 * Used in `hybrid` mode to escalate complex / high-value / VIP conversations
 * to the own-stack agents. In `meta_native` mode this always returns `false`
 * (everything stays with Meta); in `own_stack` mode it always returns `true`
 * (everything handled by ZIAY).
 *
 * @param context.intent        Conversation intent (FAQ / catalog_query /
 *                              checkout / novedad / complaint).
 * @param context.orderValue    Optional order value in COP — high-value
 *                              orders are escalated to own agents.
 * @param context.customerTier  Optional customer tier — VIP customers are
 *                              escalated to own agents.
 */
export function shouldEscalateToOwnAgent(context: {
  intent: string // 'faq' | 'catalog_query' | 'checkout' | 'novedad' | 'complaint'
  orderValue?: number
  customerTier?: string
}): boolean {
  const config = getMetaAgentStrategy()

  if (config.strategy === 'own_stack') return true
  if (config.strategy === 'meta_native') return false

  // ── hybrid ───────────────────────────────────────────────────────
  // Escalate complex / high-value / VIP flows to ZIAY's own agents.
  // Simple FAQ + catalog queries stay with Meta (saves LLM cost).
  if (
    context.intent === 'checkout' ||
    context.intent === 'novedad' ||
    context.intent === 'complaint'
  ) {
    return true
  }
  if (context.orderValue && context.orderValue > 500_000) {
    return true // high-value orders handled by own agents
  }
  if (context.customerTier === 'vip') {
    return true
  }
  return false // simple FAQ / catalog handled by Meta
}
