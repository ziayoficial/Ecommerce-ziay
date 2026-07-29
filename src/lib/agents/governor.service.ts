// ZIAY — Governor service (safety / budget gatekeeper)
//
// IA-1 (agent-builder) — wraps the Governor agent prompt + LLM call +
// JSON parse + budget check + <300ms timeout. Runs FIRST on every inbound
// message before any other agent. Returns a decision that the orchestrator
// uses to allow / reject / redirect the message.
//
// Design:
//   - CHEAP LLM: defaults to glm-4.6-flash (overridable via env
//     GOVERNOR_MODEL). Classification + policy check, not reasoning.
//   - <300ms timeout: Promise.race with 280ms — leaves ~20ms headroom for
//     JSON parse + budget check before the 300ms SLA. On timeout, fail-open
//     (allow with a logged warning) so the conversation is never blocked
//     by a slow governor LLM.
//   - Budget check BEFORE the LLM call (no token spent on a doomed call).
//     Reuses the existing `checkBudgetBeforeCall` from `@/lib/llm/budget`
//     so the governor stays consistent with the daily/monthly caps that
//     the rest of the agent layer already enforces.
//   - JSON parse: tolerates prose wrapper / markdown fences via the shared
//     `parseAgentOutput` helper. On parse failure, fail-open (allow).
//
// IA-1 (agent-builder)

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { chat } from '@/lib/llm/adapter'
import { checkBudgetBeforeCall } from '@/lib/llm/budget'
import { calculateCost } from '@/lib/llm/costs'
import { buildGovernorPrompt } from './prompts/governor'
import { parseAgentOutput } from './schemas'
import { ANTI_INJECTION_PREFIX, wrapUserInput } from './sanitize'
import type { AgentContext } from './prompts/types'
import type { ChatMessage } from 'z-ai-web-dev-sdk'
import { emitToTenant } from '@/lib/chat-emit'
// GAP-FIX #1: alert when Governor exceeds SLA 3+ times in 5 min
import { recordGovernorSlaViolation } from '@/lib/alerts'

const log = getLogger('agent:governor')

/**
 * Governor decision returned to the orchestrator.
 *
 * - `allow: false` → the orchestrator short-circuits: it returns the
 *   `reason` to the customer (or a generic rejection) and does NOT run
 *   any downstream agent. A DecisionLog row is written for audit.
 * - `allow: true` + `redirect` set → the orchestrator routes to the
 *   redirected agent instead of its default choice.
 * - `allow: true` + `redirect: null` → proceed with the normal flow.
 * - `budgetRemaining` is always returned (the orchestrator may surface
 *   it to the dashboard / include it in telemetry).
 */
export interface GovernorResult {
  allow: boolean
  reason?: string
  redirect?: string | null
  budgetRemaining: number
  /** 'llm' (LLM made the decision) | 'budget' (budget short-circuit) |
   *  'timeout' (LLM timed out, fail-open) | 'error' (LLM/parse error, fail-open). */
  decisionSource: 'llm' | 'budget' | 'timeout' | 'error'
  latencyMs: number
}

/** Hard SLA for the governor LLM call. The Promise.race timeout is set
 *  slightly below this so JSON parse + budget check + log still fit. */
export const GOVERNOR_SLA_MS = 300
const GOVERNOR_LLM_TIMEOUT_MS = 280

/** Cheap LLM for the governor. Overridable via env for prod swap. */
const GOVERNOR_MODEL = process.env.GOVERNOR_MODEL ?? 'glm-4.6-flash'

/** Safe fail-open default — used when the LLM times out or errors. */
const FAIL_OPEN_RESULT: Omit<GovernorResult, 'latencyMs' | 'budgetRemaining'> = {
  allow: true,
  reason: '',
  redirect: null,
  decisionSource: 'timeout',
}

/**
 * Run the Governor on an inbound message.
 *
 * Flow:
 *   1. Budget check (daily + monthly). If exhausted → short-circuit with
 *      `allow: false`, reason = budget message. No token spent.
 *   2. Build the governor prompt (tenant config + banned keywords + msg).
 *   3. Call the LLM with a 280ms timeout. On timeout/error → fail-open.
 *   4. Parse the JSON output via the shared `parseAgentOutput` helper.
 *   5. Persist a DecisionLog row for audit (best-effort).
 *   6. Emit `governor:decision` to the tenant's dashboard (fire-and-forget).
 *
 * NEVER throws — the orchestrator trusts this function to always return
 * a GovernorResult so the conversation flow is never broken by a governor
 * internal error.
 */
export async function runGovernor(input: {
  tenantId: string
  conversationId: string
  message: string
  customerHistory?: string
  customerId?: string
}): Promise<GovernorResult> {
  const start = Date.now()

  // ── 1. Budget check (before any LLM token is spent) ──────────────────
  // Reuses the existing `checkBudgetBeforeCall` so the governor is
  // consistent with the daily/monthly caps the rest of the agent layer
  // already enforces. Fail-open if the budget check itself errors.
  let budgetRemaining = Infinity
  try {
    const budget = await checkBudgetBeforeCall(input.tenantId)
    budgetRemaining = budget.remaining
    if (!budget.allowed) {
      const result: GovernorResult = {
        allow: false,
        reason: budget.message ?? 'Presupuesto LLM agotado',
        redirect: null,
        budgetRemaining: 0,
        decisionSource: 'budget',
        latencyMs: Date.now() - start,
      }
      log.warn({ tenantId: input.tenantId, conversationId: input.conversationId }, 'Governor blocked message (budget exhausted)')
      void persistGovernorDecision(input, result, null).catch(() => {})
      return result
    }
  } catch (err) {
    // Budget check failed (DB down, etc.) — fail-open, log warn.
    log.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId: input.tenantId },
      'Governor budget check failed — failing open',
    )
  }

  // ── 2. Build the governor prompt ─────────────────────────────────────
  const ctx: AgentContext = {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    customerId: input.customerId,
    message: input.message,
  }
  let system: string
  let user: string
  try {
    const built = await buildGovernorPrompt(ctx)
    system = built.system
    user = built.user
  } catch (err) {
    // Prompt build failed (tenant not found, DB error) — fail-open.
    captureError(err as Error, {
      agent: 'governor',
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    })
    return { ...FAIL_OPEN_RESULT, budgetRemaining, decisionSource: 'error', latencyMs: Date.now() - start }
  }

  // ── 3. Call the LLM with a 280ms timeout ────────────────────────────
  const messages: ChatMessage[] = [
    { role: 'system', content: ANTI_INJECTION_PREFIX + system },
    { role: 'user', content: wrapUserInput(user) },
  ]

  let llmContent = ''
  let llmModel: string | undefined
  let llmProvider: string | undefined
  let llmUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  let llmError: string | undefined

  try {
    const llmResult = await Promise.race([
      chat(messages, {
        model: GOVERNOR_MODEL,
        thinking: 'disabled',
        temperature: 0,
        maxTokens: 200,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Governor LLM timeout')), GOVERNOR_LLM_TIMEOUT_MS),
      ),
    ])
    llmContent = llmResult.content ?? ''
    llmModel = llmResult.model
    llmProvider = llmResult.provider
    llmUsage = llmResult.usage
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err)
    // Fail-open: timeout or LLM error must never block the conversation.
    const result: GovernorResult = {
      ...FAIL_OPEN_RESULT,
      budgetRemaining,
      decisionSource: llmError?.includes('timeout') ? 'timeout' : 'error',
      latencyMs: Date.now() - start,
    }
    log.warn(
      { err: llmError, tenantId: input.tenantId, conversationId: input.conversationId },
      'Governor LLM call failed — failing open (allow + no redirect)',
    )
    // GAP-FIX #1: record SLA violation for alert threshold tracking.
    // If the Governor exceeds its SLA 3+ times in 5 min, an alert fires.
    if (result.latencyMs > GOVERNOR_SLA_MS) {
      void recordGovernorSlaViolation(input.tenantId, result.latencyMs).catch(() => {})
    }
    void persistGovernorDecision(input, result, null).catch(() => {})
    return result
  }

  // ── 4. Parse the JSON output ────────────────────────────────────────
  const parsed = parseAgentOutput<{
    allow: boolean
    reason: string
    redirect: string | null
  }>('governor', llmContent)

  let result: GovernorResult
  if (parsed) {
    // Normalize `redirect` — accept empty string as null.
    const redirect = parsed.redirect && parsed.redirect.length > 0 ? parsed.redirect : null
    result = {
      allow: parsed.allow,
      reason: parsed.reason ?? '',
      redirect,
      budgetRemaining,
      decisionSource: 'llm',
      latencyMs: Date.now() - start,
    }
  } else {
    // JSON parse failed — fail-open (allow). The governor's job is to be
    // a safety net, not a hard gate; an unparseable response is logged
    // but doesn't block the conversation.
    result = {
      allow: true,
      reason: '',
      redirect: null,
      budgetRemaining,
      decisionSource: 'error',
      latencyMs: Date.now() - start,
    }
    log.warn(
      { tenantId: input.tenantId, rawLen: llmContent.length, rawHead: llmContent.slice(0, 200) },
      'Governor LLM output unparseable — failing open',
    )
  }

  // ── 5. Persist DecisionLog + emit socket event (best-effort) ────────
  const llmMeta = {
    model: llmModel,
    provider: llmProvider,
    usage: llmUsage,
  }
  void persistGovernorDecision(input, result, llmMeta).catch(() => {})

  log.info(
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      allow: result.allow,
      redirect: result.redirect,
      decisionSource: result.decisionSource,
      latencyMs: result.latencyMs,
    },
    'Governor decision',
  )

  return result
}

/**
 * Persist a DecisionLog row for the governor decision (best-effort —
 * failure is captured but never propagated). The `agentName` is
 * 'governor' so it shows up in the agent decision log alongside the
 * other agents. `enforcementResult` carries the full decision shape
 * so auditors can see allow/reason/redirect/decisionSource.
 */
async function persistGovernorDecision(
  input: { tenantId: string; conversationId: string; message?: string; customerHistory?: string },
  result: GovernorResult,
  llmMeta: {
    model?: string
    provider?: string
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  } | null,
): Promise<void> {
  try {
    await db.decisionLog.create({
      data: {
        tenantId: input.tenantId,
        agentName: 'governor',
        conversationId: input.conversationId,
        input: JSON.stringify({
          message: (input.message ?? '').slice(0, 500),
          customerHistory: (input.customerHistory ?? '').slice(0, 500),
        }),
        output: JSON.stringify({
          allow: result.allow,
          reason: result.reason,
          redirect: result.redirect,
          decisionSource: result.decisionSource,
        }),
        reasoning: null,
        confidence: result.decisionSource === 'llm' ? 0.9 : 0.3,
        enforcementResult: JSON.stringify({
          allowed: result.allow,
          violations: result.allow ? [] : [result.reason],
          escalated: !result.allow,
          blocked: !result.allow,
        }),
        liabilityParty: result.allow ? null : 'customer',
        model: llmMeta?.model ?? null,
        provider: llmMeta?.provider ?? null,
        promptTokens: llmMeta?.usage?.promptTokens ?? null,
        completionTokens: llmMeta?.usage?.completionTokens ?? null,
        totalTokens: llmMeta?.usage?.totalTokens ?? null,
        costUsd: llmMeta?.usage && llmMeta.provider
          ? calculateCost(llmMeta.provider, llmMeta.usage)
          : null,
        latencyMs: result.latencyMs,
      },
    })
    // Emit a socket event so the dashboard can show governor decisions
    // in real time (a "policy gate" widget). Fire-and-forget.
    emitToTenant(input.tenantId, 'governor:decision', {
      conversationId: input.conversationId,
      allow: result.allow,
      reason: result.reason,
      redirect: result.redirect,
      decisionSource: result.decisionSource,
      latencyMs: result.latencyMs,
      budgetRemaining: result.budgetRemaining,
    })
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId: input.tenantId },
      'Governor DecisionLog persist failed (non-blocking)',
    )
  }
}
