// ZIAY — Token Budget Manager (IA-2 · agent-hardening)
//
// Per-tenant token + USD cost control. Closes the gap surfaced by the
// production-hardening audit: ZIAY had `src/lib/llm/budget.ts` for USD-only
// daily/monthly caps, but no token-level budget and no per-conversation
// cap. This module adds:
//
//   - Three budget windows: `daily`, `monthly`, `conversation`.
//   - Plan-based defaults (Starter / Business / Enterprise) mapped onto
//     `Tenant.planMonetizacion` (conecta / catalogo_incluido / completo).
//   - Token + USD caps (whichever hits first blocks the call).
//   - `checkBudget()` pre-flight before the LLM call.
//   - `recordUsage()` post-call debit on `TokenUsage` (audit ledger).
//   - `setLimits()` admin override persisted in the `Setting` table.
//
// The existing `src/lib/llm/budget.ts` is left untouched — it covers the
// /api/agents/[agentName] route and the /api/llm/budget admin endpoint.
// This module is the parallel implementation used by the orchestrator
// (`src/lib/orchestrator/orchestrator.ts`) and the new
// `/api/agents/budget` admin endpoint. The two coexist because:
//
//   - llm/budget.ts is USD-only and keyed off `DecisionLog.costUsd`.
//   - agents/budget.ts adds token-level caps + per-conversation caps +
//     a dedicated `TokenUsage` ledger (normalized for fast aggregates).
//
// Migration path: once the new module is stable, the old one's
// `checkBudgetBeforeCall` can delegate here (token+USD check) and the
// `DecisionLog.costUsd` aggregation can be replaced by `TokenUsage`
// queries. That's a follow-up — IA-2 ships the new layer alongside the
// old one to avoid a big-bang cutover.
//
// Persistence:
//
//   - In-memory: `Map<tenantId, { daily, monthly, conversation }>` with
//     window-based reset (daily at local midnight, monthly on the 1st,
//     conversation never resets — it lives until the conversation is
//     garbage-collected).
//
//   - DB: every `recordUsage()` call writes a `TokenUsage` row. The
//     in-memory counter is the source of truth for `checkBudget()` (fast,
//     no DB round-trip per call); `TokenUsage` is the audit ledger
//     (slow query, but durable + accurate).
//
//   - `Setting` table: admin overrides for daily/monthly token + USD caps
//     keyed `agent_budget::{tenantId}::{period}::{field}`. Read on first
//     access per tenant, then cached for 5 minutes.
// ───────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type BudgetPeriod = 'daily' | 'monthly' | 'conversation'

export interface TokenBudget {
  tenantId: string
  period: BudgetPeriod
  /** Period key — `YYYY-MM-DD` (daily), `YYYY-MM` (monthly), or conversationId. */
  periodKey: string
  tokensUsed: number
  tokensLimit: number
  costUsd: number
  costLimitUsd: number
  lastResetAt: Date
}

export interface BudgetStatus {
  daily: TokenBudget
  monthly: TokenBudget
  conversation: TokenBudget | null
}

export interface BudgetCheckResult {
  allowed: boolean
  reason?: string
  remaining: number
  resetAt?: Date
}

export interface BudgetLimits {
  dailyTokens?: number
  monthlyTokens?: number
  dailyCostUsd?: number
  monthlyCostUsd?: number
}

// ───────────────────────────────────────────────────────────────────────────
// Plan defaults
// ───────────────────────────────────────────────────────────────────────────

export type BudgetPlan = 'starter' | 'business' | 'enterprise'

export interface PlanLimits {
  dailyTokens: number
  monthlyTokens: number
  dailyCostUsd: number
  monthlyCostUsd: number
}

/**
 * Plan → default limits. Enterprise is unlimited (we use `Number.MAX_SAFE_INTEGER`
 * as a sentinel so the math still works — `used < limit` is always true).
 *
 * The mapping from `Tenant.planMonetizacion` → `BudgetPlan`:
 *   - conecta           → starter
 *   - catalogo_incluido → business
 *   - completo          → enterprise
 *
 * Operators can override per-tenant via `setLimits()` (admin endpoint).
 */
export const PLAN_LIMITS: Record<BudgetPlan, PlanLimits> = {
  starter: {
    dailyTokens: 50_000,
    monthlyTokens: 1_500_000,
    dailyCostUsd: 5,
    monthlyCostUsd: 100,
  },
  business: {
    dailyTokens: 250_000,
    monthlyTokens: 5_000_000,
    dailyCostUsd: 20,
    monthlyCostUsd: 400,
  },
  enterprise: {
    // Unlimited but tracked — the BudgetManager still records every call,
    // so admins can see usage even when no cap blocks anything.
    dailyTokens: Number.MAX_SAFE_INTEGER,
    monthlyTokens: Number.MAX_SAFE_INTEGER,
    dailyCostUsd: Number.MAX_SAFE_INTEGER,
    monthlyCostUsd: Number.MAX_SAFE_INTEGER,
  },
}

export const PLAN_BY_MONETIZATION: Record<string, BudgetPlan> = {
  conecta: 'starter',
  catalogo_incluido: 'business',
  completo: 'enterprise',
}

// ───────────────────────────────────────────────────────────────────────────
// Period key helpers
// ───────────────────────────────────────────────────────────────────────────

function dailyKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthlyKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function nextDailyReset(d = new Date()): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  return next
}

function nextMonthlyReset(d = new Date()): Date {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  return next
}

// ───────────────────────────────────────────────────────────────────────────
// In-memory store
// ───────────────────────────────────────────────────────────────────────────

interface BudgetEntry {
  tokensUsed: number
  costUsd: number
  lastResetAt: Date
  periodKey: string
}

interface TenantBudgetState {
  daily: BudgetEntry
  monthly: BudgetEntry
  conversation: Map<string, BudgetEntry> // conversationId → entry
  limits: PlanLimits // resolved (plan defaults + admin overrides)
  limitsResolvedAt: number // epoch ms — for the 5-min override cache
}

const budgetStore = new Map<string, TenantBudgetState>()
const LIMIT_CACHE_TTL_MS = 5 * 60 * 1000

// ───────────────────────────────────────────────────────────────────────────
// IA-4 (P2-5) — conversation Map cleanup.
//
// `TenantBudgetState.conversation` is a `Map<conversationId, BudgetEntry>`
// that grew without bound — every conversationId left a permanent entry
// (the old code's comment admitted "conversation never resets — it lives
// until the conversation is garbage-collected" but no GC was implemented).
// At ~1 KB per entry × 1000+ conversations/day per active tenant, this
// became a slow memory leak in long-running processes.
//
// Two-pronged fix:
//   1. A `cleanupConversations(maxAgeMs)` method that evicts entries
//      older than `maxAgeMs` (default 1 hour). Called automatically
//      every 10 minutes via `setInterval` (unref'd so it doesn't keep
//      the event loop alive). Mirrors the sweep pattern in `tracing.ts`.
//   2. A hard cap in `recordUsage()`: if a tenant's conversation Map
//      exceeds 1000 entries, evict the 100 oldest (by `lastResetAt`).
//      This is the safety net for a burst of conversations between
//      sweeps (e.g. a flash-sale traffic spike) — bounds the worst-case
//      memory footprint even if the sweep timer hasn't fired yet.
// ───────────────────────────────────────────────────────────────────────────

const CONVERSATION_SWEEP_INTERVAL_MS = 10 * 60 * 1000 // 10 min
const CONVERSATION_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour
const CONVERSATION_HARD_CAP = 1000
const CONVERSATION_HARD_CAP_EVICT_COUNT = 100

let conversationSweepTimer: NodeJS.Timeout | null = null

function ensureConversationSweepTimer(): void {
  if (conversationSweepTimer) return
  if (typeof process === 'undefined') return
  // Skip during build / lint (NEXT_RUNTIME is only set in the server runtime).
  if (process.env.NODE_ENV === 'production' && !process.env.NEXT_RUNTIME) return
  conversationSweepTimer = setInterval(() => {
    let evicted = 0
    const cutoff = Date.now() - CONVERSATION_MAX_AGE_MS
    for (const state of budgetStore.values()) {
      for (const [convoId, entry] of state.conversation) {
        if (entry.lastResetAt.getTime() < cutoff) {
          state.conversation.delete(convoId)
          evicted++
        }
      }
    }
    if (evicted > 0) {
      logger.debug({ evicted, tenants: budgetStore.size }, 'budget.conversation.sweep')
    }
  }, CONVERSATION_SWEEP_INTERVAL_MS)
  if (conversationSweepTimer && typeof conversationSweepTimer.unref === 'function') {
    conversationSweepTimer.unref()
  }
}

// ───────────────────────────────────────────────────────────────────────────
// BudgetManager
// ───────────────────────────────────────────────────────────────────────────

export class BudgetManager {
  /**
   * Pre-flight check: can this tenant afford `estimatedTokens` more tokens?
   *
   * Called by the orchestrator before `callAgentDirect()`. If `allowed`
   * is false, the orchestrator must short-circuit with a clear reason
   * (the Governor agent — IA-1 — surfaces this to the end user as
   * "El sistema está procesando muchas solicitudes ahora mismo, intenta
   * en unos minutos" so we don't leak internal budget mechanics).
   *
   * Fail-open: if the DB read for the tenant's plan fails, we allow the
   * call (matching `llm/budget.ts` semantics — prefer serving the user
   * over blocking on infra). The over-spend will be caught on the next
   * `recordUsage()` write.
   */
  async checkBudget(
    tenantId: string,
    estimatedTokens: number,
  ): Promise<BudgetCheckResult> {
    try {
      const state = await this.getOrCreateState(tenantId)
      const todayKey = dailyKey()
      const monthKey = monthlyKey()

      // Reset if we crossed into a new day / month since the last call.
      this.maybeResetDaily(state, todayKey)
      this.maybeResetMonthly(state, monthKey)

      const daily = state.daily
      const monthly = state.monthly

      // Daily token cap.
      if (daily.tokensUsed + estimatedTokens > state.limits.dailyTokens) {
        const reason = `Daily token budget exceeded (${daily.tokensUsed}/${state.limits.dailyTokens} tokens used). Resets at ${nextDailyReset().toISOString()}.`
        logger.warn({ tenantId, used: daily.tokensUsed, limit: state.limits.dailyTokens, estimatedTokens }, 'budget.daily.tokens.exceeded')
        return {
          allowed: false,
          reason,
          remaining: Math.max(0, state.limits.dailyTokens - daily.tokensUsed),
          resetAt: nextDailyReset(),
        }
      }

      // Daily USD cap.
      if (daily.costUsd > state.limits.dailyCostUsd) {
        const reason = `Daily cost budget exceeded ($${daily.costUsd.toFixed(4)}/$${state.limits.dailyCostUsd} USD). Resets at ${nextDailyReset().toISOString()}.`
        logger.warn({ tenantId, spent: daily.costUsd, limit: state.limits.dailyCostUsd }, 'budget.daily.cost.exceeded')
        return {
          allowed: false,
          reason,
          remaining: 0,
          resetAt: nextDailyReset(),
        }
      }

      // Monthly token cap.
      if (monthly.tokensUsed + estimatedTokens > state.limits.monthlyTokens) {
        const reason = `Monthly token budget exceeded (${monthly.tokensUsed}/${state.limits.monthlyTokens} tokens used). Resets at ${nextMonthlyReset().toISOString()}.`
        logger.warn({ tenantId, used: monthly.tokensUsed, limit: state.limits.monthlyTokens }, 'budget.monthly.tokens.exceeded')
        return {
          allowed: false,
          reason,
          remaining: Math.max(0, state.limits.monthlyTokens - monthly.tokensUsed),
          resetAt: nextMonthlyReset(),
        }
      }

      // Monthly USD cap.
      if (monthly.costUsd > state.limits.monthlyCostUsd) {
        const reason = `Monthly cost budget exceeded ($${monthly.costUsd.toFixed(4)}/$${state.limits.monthlyCostUsd} USD). Resets at ${nextMonthlyReset().toISOString()}.`
        logger.warn({ tenantId, spent: monthly.costUsd, limit: state.limits.monthlyCostUsd }, 'budget.monthly.cost.exceeded')
        return {
          allowed: false,
          reason,
          remaining: 0,
          resetAt: nextMonthlyReset(),
        }
      }

      const remainingDaily = Math.max(0, state.limits.dailyTokens - daily.tokensUsed)
      const remainingMonthly = Math.max(0, state.limits.monthlyTokens - monthly.tokensUsed)
      const remaining = Math.min(remainingDaily, remainingMonthly)

      return { allowed: true, remaining }
    } catch (err) {
      // Fail-open — see method doc.
      captureError(err, {
        service: 'agents',
        method: 'budget.checkBudget',
        tenantId,
      })
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER }
    }
  }

  /**
   * Post-call debit. Records the actual token usage + cost to:
   *   - The in-memory counters (for fast `checkBudget()` reads).
   *   - A new `TokenUsage` row (the durable audit ledger).
   *
   * `conversationId` is optional — when present, the per-conversation
   * counter is also debited (so the orchestrator can cap a single long
   * conversation from running away with tokens).
   *
   * IA-6B (Gap 7) — `customerId` is optional. When present, it's
   * persisted on the `TokenUsage` row so the per-customer cost
   * attribution (`getCustomerCosts()`) + the admin endpoint
   * `/api/agents/budget/[customerId]` can answer "how much does this
   * customer cost us per month, broken down by agent?".
   *
   * Fire-and-forget DB write — a slow DB must never block the next agent
   * call. The in-memory counter is updated synchronously so the very next
   * `checkBudget()` sees the new usage.
   */
  recordUsage(
    tenantId: string,
    conversationId: string | undefined,
    tokensIn: number,
    tokensOut: number,
    costUsd: number,
    agentName: string,
    model: string,
    customerId?: string,
  ): void {
    // IA-4 (P2-5) — ensure the periodic sweep timer is running. Cheap
    // (no-op if already started) — guards against the leak even on the
    // first call after a process restart.
    ensureConversationSweepTimer()

    const total = tokensIn + tokensOut

    // Sync in-memory debit.
    const state = this.getOrCreateStateSync(tenantId)
    state.daily.tokensUsed += total
    state.daily.costUsd += costUsd
    state.monthly.tokensUsed += total
    state.monthly.costUsd += costUsd
    if (conversationId) {
      let convo = state.conversation.get(conversationId)
      if (!convo) {
        convo = {
          tokensUsed: 0,
          costUsd: 0,
          lastResetAt: new Date(),
          periodKey: conversationId,
        }
        state.conversation.set(conversationId, convo)
      }
      convo.tokensUsed += total
      convo.costUsd += costUsd
      // IA-4 (P2-5) — bump `lastResetAt` on each debit so the sweep
      // timer's "older than 1 hour" check reflects the LAST activity,
      // not the conversation's creation time. A long-running active
      // conversation stays in the map; an idle one gets evicted.
      convo.lastResetAt = new Date()

      // IA-4 (P2-5) — hard cap safety net: if a tenant's conversation
      // Map exceeds the cap (burst of conversations between sweeps),
      // evict the oldest N by `lastResetAt`. Bounds the worst-case
      // memory footprint regardless of sweep timing.
      if (state.conversation.size > CONVERSATION_HARD_CAP) {
        const entries = Array.from(state.conversation.entries())
        entries.sort((a, b) => a[1].lastResetAt.getTime() - b[1].lastResetAt.getTime())
        const toEvict = entries.slice(0, CONVERSATION_HARD_CAP_EVICT_COUNT)
        for (const [id] of toEvict) {
          state.conversation.delete(id)
        }
        logger.warn(
          { tenantId, evicted: toEvict.length, remaining: state.conversation.size },
          'budget.conversation.hard_cap_evicted',
        )
      }
    }

    // Async DB ledger write.
    this.persistTokenUsage({
      tenantId,
      conversationId,
      customerId,
      tokensIn,
      tokensOut,
      costUsd,
      agentName,
      model,
    }).catch((err) => {
      captureError(err, {
        service: 'agents',
        method: 'budget.recordUsage',
        tenantId,
        agentName,
        customerId,
      })
    })
  }

  /**
   * Get the current budget status for a tenant (daily + monthly +
   * per-conversation if active). Used by the admin dashboard.
   */
  async getStatus(tenantId: string): Promise<BudgetStatus> {
    const state = await this.getOrCreateState(tenantId)
    const todayKey = dailyKey()
    const monthKey = monthlyKey()
    this.maybeResetDaily(state, todayKey)
    this.maybeResetMonthly(state, monthKey)

    const daily: TokenBudget = {
      tenantId,
      period: 'daily',
      periodKey: state.daily.periodKey,
      tokensUsed: state.daily.tokensUsed,
      tokensLimit: state.limits.dailyTokens,
      costUsd: state.daily.costUsd,
      costLimitUsd: state.limits.dailyCostUsd,
      lastResetAt: state.daily.lastResetAt,
    }

    const monthly: TokenBudget = {
      tenantId,
      period: 'monthly',
      periodKey: state.monthly.periodKey,
      tokensUsed: state.monthly.tokensUsed,
      tokensLimit: state.limits.monthlyTokens,
      costUsd: state.monthly.costUsd,
      costLimitUsd: state.limits.monthlyCostUsd,
      lastResetAt: state.monthly.lastResetAt,
    }

    // For the API response, surface the most-recent conversation budget
    // (the one the caller probably cares about). The full per-conversation
    // map stays in-memory — exposing it would require pagination.
    let conversation: TokenBudget | null = null
    if (state.conversation.size > 0) {
      const lastEntry = Array.from(state.conversation.entries()).pop()
      if (lastEntry) {
        const [convoId, entry] = lastEntry
        conversation = {
          tenantId,
          period: 'conversation',
          periodKey: convoId,
          tokensUsed: entry.tokensUsed,
          tokensLimit: Number.MAX_SAFE_INTEGER, // no per-conversation cap by default
          costUsd: entry.costUsd,
          costLimitUsd: Number.MAX_SAFE_INTEGER,
          lastResetAt: entry.lastResetAt,
        }
      }
    }

    return { daily, monthly, conversation }
  }

  /**
   * Admin override for a tenant's limits. Persists to the `Setting` table
   * (keys `agent_budget::{tenantId}::daily::tokens`, etc.) and refreshes
   * the in-memory cache immediately.
   *
   * Enterprise tenants can still set explicit caps if they want a hard
   * ceiling below the unlimited default (e.g. for a sandbox tenant).
   */
  async setLimits(tenantId: string, limits: BudgetLimits): Promise<void> {
    const ops: Promise<unknown>[] = []
    if (limits.dailyTokens !== undefined) {
      ops.push(
        db.setting.upsert({
          where: { key: `agent_budget::${tenantId}::daily::tokens` },
          update: { value: String(limits.dailyTokens) },
          create: { key: `agent_budget::${tenantId}::daily::tokens`, value: String(limits.dailyTokens) },
        }),
      )
    }
    if (limits.monthlyTokens !== undefined) {
      ops.push(
        db.setting.upsert({
          where: { key: `agent_budget::${tenantId}::monthly::tokens` },
          update: { value: String(limits.monthlyTokens) },
          create: { key: `agent_budget::${tenantId}::monthly::tokens`, value: String(limits.monthlyTokens) },
        }),
      )
    }
    if (limits.dailyCostUsd !== undefined) {
      ops.push(
        db.setting.upsert({
          where: { key: `agent_budget::${tenantId}::daily::cost_usd` },
          update: { value: String(limits.dailyCostUsd) },
          create: { key: `agent_budget::${tenantId}::daily::cost_usd`, value: String(limits.dailyCostUsd) },
        }),
      )
    }
    if (limits.monthlyCostUsd !== undefined) {
      ops.push(
        db.setting.upsert({
          where: { key: `agent_budget::${tenantId}::monthly::cost_usd` },
          update: { value: String(limits.monthlyCostUsd) },
          create: { key: `agent_budget::${tenantId}::monthly::cost_usd`, value: String(limits.monthlyCostUsd) },
        }),
      )
    }
    await Promise.all(ops)

    // Force a re-read on the next `getStatus()` / `checkBudget()` call.
    const state = this.getOrCreateStateSync(tenantId)
    state.limitsResolvedAt = 0

    logger.info({ tenantId, limits }, 'budget.limits.updated')
  }

  // ───────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────

  private async getOrCreateState(tenantId: string): Promise<TenantBudgetState> {
    let state = budgetStore.get(tenantId)
    if (!state) {
      state = this.freshState(tenantId)
      budgetStore.set(tenantId, state)
    }
    // Refresh limits if the cache is stale.
    if (Date.now() - state.limitsResolvedAt > LIMIT_CACHE_TTL_MS) {
      state.limits = await this.resolveLimits(tenantId)
      state.limitsResolvedAt = Date.now()
    }
    return state
  }

  private getOrCreateStateSync(tenantId: string): TenantBudgetState {
    let state = budgetStore.get(tenantId)
    if (!state) {
      state = this.freshState(tenantId)
      budgetStore.set(tenantId, state)
    }
    return state
  }

  private freshState(_tenantId: string): TenantBudgetState {
    const now = new Date()
    return {
      daily: { tokensUsed: 0, costUsd: 0, lastResetAt: now, periodKey: dailyKey(now) },
      monthly: { tokensUsed: 0, costUsd: 0, lastResetAt: now, periodKey: monthlyKey(now) },
      conversation: new Map(),
      // Until we resolve the actual limits, default to starter (safest).
      limits: PLAN_LIMITS.starter,
      limitsResolvedAt: 0,
    }
  }

  private maybeResetDaily(state: TenantBudgetState, todayKey: string): void {
    if (state.daily.periodKey !== todayKey) {
      state.daily = {
        tokensUsed: 0,
        costUsd: 0,
        lastResetAt: new Date(),
        periodKey: todayKey,
      }
    }
  }

  private maybeResetMonthly(state: TenantBudgetState, monthKey: string): void {
    if (state.monthly.periodKey !== monthKey) {
      state.monthly = {
        tokensUsed: 0,
        costUsd: 0,
        lastResetAt: new Date(),
        periodKey: monthKey,
      }
    }
  }

  /**
   * Resolve the effective limits for a tenant: admin overrides (from
   * `Setting`) win, else fall back to the plan defaults derived from
   * `Tenant.planMonetizacion`.
   *
   * Fail-safe: any DB error → starter limits (most restrictive) so a DB
   * outage doesn't accidentally grant unlimited spending.
   */
  private async resolveLimits(tenantId: string): Promise<PlanLimits> {
    try {
      // Look up the tenant's monetization plan.
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { planMonetizacion: true },
      })
      const plan = PLAN_BY_MONETIZATION[tenant?.planMonetizacion ?? 'conecta'] ?? 'starter'
      const defaults = PLAN_LIMITS[plan]

      // Look up admin overrides.
      const overrides = await db.setting.findMany({
        where: {
          key: { startsWith: `agent_budget::${tenantId}::` },
        },
      })
      const map = new Map(overrides.map((s) => [s.key, s.value]))

      const dailyTokens = this.parseOverride(map.get(`agent_budget::${tenantId}::daily::tokens`), defaults.dailyTokens)
      const monthlyTokens = this.parseOverride(map.get(`agent_budget::${tenantId}::monthly::tokens`), defaults.monthlyTokens)
      const dailyCostUsd = this.parseOverride(map.get(`agent_budget::${tenantId}::daily::cost_usd`), defaults.dailyCostUsd)
      const monthlyCostUsd = this.parseOverride(map.get(`agent_budget::${tenantId}::monthly::cost_usd`), defaults.monthlyCostUsd)

      return { dailyTokens, monthlyTokens, dailyCostUsd, monthlyCostUsd }
    } catch (err) {
      captureError(err, {
        service: 'agents',
        method: 'budget.resolveLimits',
        tenantId,
      })
      // Fail-safe: starter limits.
      return PLAN_LIMITS.starter
    }
  }

  private parseOverride(value: string | undefined, fallback: number): number {
    if (value == null) return fallback
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }

  private async persistTokenUsage(input: {
    tenantId: string
    conversationId: string | undefined
    customerId?: string
    tokensIn: number
    tokensOut: number
    costUsd: number
    agentName: string
    model: string
  }): Promise<void> {
    try {
      await db.tokenUsage.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId ?? null,
          // IA-6B (Gap 7) — per-customer attribution. Null when the
          // caller doesn't have a customer context (e.g. orchestrator
          // pre-customer-match turns). Indexed so the per-customer
          // roll-up is a single index range scan.
          customerId: input.customerId ?? null,
          agentName: input.agentName,
          model: input.model,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
          costUsd: input.costUsd,
        },
      })
    } catch (err) {
      // Non-blocking — captured + logged. The in-memory counter was
      // already debited, so `checkBudget()` still sees the usage.
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          tenantId: input.tenantId,
          agentName: input.agentName,
          customerId: input.customerId,
        },
        'budget.persistTokenUsage failed (non-blocking)',
      )
    }
  }

  /**
   * Test-only: clear the in-memory store. Exported so the evaluation
   * harness can isolate runs.
   */
  clearForTesting(): void {
    budgetStore.clear()
  }

  /**
   * IA-4 (P2-5) — Evict conversation entries older than `maxAgeMs` from
   * every tenant's conversation Map. Called automatically every 10 min
   * by the sweep timer (see `ensureConversationSweepTimer`), but also
   * exposed as a public method so tests + admin endpoints can trigger
   * a sweep on demand (e.g. after a load test, before measuring memory).
   *
   * Returns the number of entries evicted across all tenants.
   */
  cleanupConversations(maxAgeMs: number = CONVERSATION_MAX_AGE_MS): number {
    let evicted = 0
    const cutoff = Date.now() - maxAgeMs
    for (const state of budgetStore.values()) {
      for (const [convoId, entry] of state.conversation) {
        if (entry.lastResetAt.getTime() < cutoff) {
          state.conversation.delete(convoId)
          evicted++
        }
      }
    }
    if (evicted > 0) {
      logger.info({ evicted, tenants: budgetStore.size, maxAgeMs }, 'budget.conversation.cleanup')
    }
    return evicted
  }

  // ───────────────────────────────────────────────────────────────────────
  // IA-6B (Gap 7) — Per-customer cost attribution
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Aggregate token usage + cost for a single customer over an optional
   * date range. Used by the admin endpoint
   * `GET /api/agents/budget/[customerId]` to surface "which customers
   * are expensive" + "which agents are burning the most tokens for this
   * customer".
   *
   * The query hits the `TokenUsage` table (the durable ledger). The
   * in-memory `budgetStore` is per-tenant, not per-customer, so we
   * can't serve this from the cache.
   *
   * `from` / `to` default to the start of the current month + now,
   * respectively — that's the most common question ("how much has this
   * customer cost us this month?").
   *
   * Fail-safe: any DB error returns an all-zero result (the caller — the
   * admin endpoint — surfaces a 500 with the error message; this method
   * never throws so the route handler stays simple).
   */
  async getCustomerCosts(
    tenantId: string,
    customerId: string,
    from?: Date,
    to?: Date,
  ): Promise<{
    totalTokensIn: number
    totalTokensOut: number
    totalCostUsd: number
    byAgent: Array<{ agentName: string; tokens: number; costUsd: number; calls: number }>
  }> {
    try {
      // Default window: start of the current month → now.
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const dateFrom = from ?? startOfMonth
      const dateTo = to ?? now

      const rows = await db.tokenUsage.findMany({
        where: {
          tenantId,
          customerId,
          createdAt: { gte: dateFrom, lte: dateTo },
        },
        select: {
          agentName: true,
          tokensIn: true,
          tokensOut: true,
          costUsd: true,
        },
      })

      const byAgentMap = new Map<
        string,
        { tokens: number; costUsd: number; calls: number }
      >()
      let totalTokensIn = 0
      let totalTokensOut = 0
      let totalCostUsd = 0

      for (const row of rows) {
        totalTokensIn += row.tokensIn
        totalTokensOut += row.tokensOut
        totalCostUsd += row.costUsd
        const entry = byAgentMap.get(row.agentName) ?? {
          tokens: 0,
          costUsd: 0,
          calls: 0,
        }
        entry.tokens += row.tokensIn + row.tokensOut
        entry.costUsd += row.costUsd
        entry.calls += 1
        byAgentMap.set(row.agentName, entry)
      }

      const byAgent = Array.from(byAgentMap.entries())
        .map(([agentName, v]) => ({ agentName, ...v }))
        .sort((a, b) => b.costUsd - a.costUsd)

      // Round the totals to 6-decimal USD precision (matches `estimateCost`).
      return {
        totalTokensIn,
        totalTokensOut,
        totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
        byAgent,
      }
    } catch (err) {
      captureError(err, {
        service: 'agents',
        method: 'budget.getCustomerCosts',
        tenantId,
        customerId,
      })
      return {
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCostUsd: 0,
        byAgent: [],
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Singleton
// ───────────────────────────────────────────────────────────────────────────

export const budgetManager = new BudgetManager()
