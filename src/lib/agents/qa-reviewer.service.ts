// ZIAY — QA Reviewer service (Reflexion: generate → critique → revise)
//
// IA-1 (agent-builder) — wraps the QA Reviewer agent prompt + LLM call +
// JSON parse + DecisionLog persistence. Runs AFTER revenue-critical
// agents (quote, novedades, address, checkout) to catch hallucinations
// before they reach the customer.
//
// Design:
//   - FRONTIER LLM: defaults to glm-4.6 (the most capable model in the
//     ZAI family). Critique is harder than generation — the reviewer
//     must compare the agent's output against the conversation context
//     AND the platform's data tables, and detect unsupported claims.
//   - 8s timeout: longer than the governor (critique needs to read the
//     whole output + context) but still bounded — the orchestrator must
//     not stall waiting for QA.
//   - Reflexion pattern (Shinn et al. 2023):
//       generate (the original agent's output — already done)
//       → critique (this service — find issues)
//       → revise (this service — produce corrected version when needed)
//     The original output is the "generate" step; this service does
//     "critique" and "revise" in a single LLM call (the QA Reviewer
//     prompt asks for both `issues` and `revisedOutput`).
//   - Fail-CLOSED for parse errors: if the QA Reviewer LLM returns
//     unparseable JSON, we APPROVE the original output (don't block
//     the conversation on a QA tooling failure). This is the opposite
//     of the governor's fail-open behavior — the governor is a safety
//     gate (must not block), the QA Reviewer is a quality check (must
//     not block either, but with a clear "approved" fallback).
//
// IA-1 (agent-builder)

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { chat } from '@/lib/llm/adapter'
import { calculateCost } from '@/lib/llm/costs'
import { buildQAReviewerPrompt } from './prompts/qa_reviewer'
import { parseAgentOutput } from './schemas'
import { ANTI_INJECTION_PREFIX, wrapUserInput } from './sanitize'
import type { AgentContext } from './prompts/types'
import type { ChatMessage } from 'z-ai-web-dev-sdk'
import { emitToTenant } from '@/lib/chat-emit'

const log = getLogger('agent:qa-reviewer')

/**
 * QA Review result returned to the orchestrator.
 *
 * - `approved: true` → use the original agent output as-is. `issues`
 *   may still contain non-blocking notes (style, optimization) — the
 *   orchestrator can log them but doesn't change the customer reply.
 * - `approved: false` → use `revisedOutput` instead of the original.
 *   `issues` lists the problems found (for DecisionLog + telemetry).
 */
export interface QAReviewResult {
  approved: boolean
  revisedOutput?: string
  issues: string[]
  /** 'llm' (LLM made the decision) | 'timeout' | 'error' (both fail-closed
   *   to approve-original to keep the conversation moving). */
  decisionSource: 'llm' | 'timeout' | 'error'
  latencyMs: number
}

/** Frontier LLM for the QA Reviewer. Overridable via env for prod swap. */
const QA_REVIEWER_MODEL = process.env.QA_REVIEWER_MODEL ?? 'glm-4.6'

/** 8s timeout — critique needs to read the whole output + context, but
 *  the orchestrator must not stall waiting for QA. */
const QA_REVIEWER_TIMEOUT_MS = 8_000

/**
 * The set of agents whose output is reviewed by QA.
 *
 * IA-1 (agent-builder) — original 4: revenue-critical agents where a
 * hallucination would directly cost the tenant money (wrong price → lost
 * sale / margin; wrong address → failed delivery; wrong novedad → wrong
 * action taken; premature checkout confirmation → chargeback risk).
 *
 * IA-6B (Gap 8) — expanded to 8: added `objection` (a wrong objection
 * reply can lose a sale or violate the NUNCA-descuento rule), `speech`
 * (the sales-pitch anchor — bad output poisons every downstream step),
 * `logistics` (wrong freight quote → margin leak + delivery failure),
 * `scoring` (a wrong customer/carrier score drives wrong retention +
 * routing decisions). Together these 8 cover every agent whose output
 * directly shapes a customer-facing decision or a financial outcome.
 */
export const QA_REVIEWED_AGENTS = new Set<string>([
  // IA-1 — original 4 revenue-critical agents.
  'quote',
  'novedades',
  'address',
  'checkout',
  // IA-6B (Gap 8) — 4 more high-impact agents.
  'objection',
  'speech',
  'logistics',
  'scoring',
])

/**
 * IA-6B (Gap 8) — Confidence threshold for the QA fast-path.
 *
 * When the agent's output confidence (computed by the calling route
 * from schema-validation + rule checks) is ABOVE this threshold, the
 * QA Reviewer is SKIPPED — the output is already high-confidence, so
 * spending 8s + a frontier-model call on critique is a waste of
 * budget. When confidence is AT OR BELOW this threshold, QA runs
 * (the slow path) to catch issues the schema-validation missed.
 *
 * The 0.7 value matches the agent-eval promotion-gate threshold
 * (`scripts/eval-agents.ts`): if the route is already confident the
 * output is good (>= 0.7), QA is redundant; below 0.7 the route
 * itself is unsure, so QA critique is valuable.
 *
 * Callers pass the agent's confidence as the optional 2nd arg to
 * `shouldReviewAgent()`. When omitted (e.g. from older call sites
 * that haven't been updated), QA always runs — preserves the
 * fail-safe default.
 */
export const QA_CONFIDENCE_THRESHOLD = 0.7

/**
 * IA-6B (Gap 8) — Issue-count threshold for human escalation.
 *
 * When the QA Reviewer finds AT LEAST this many issues, the case is
 * escalated to a human reviewer (DecisionLog row with
 * `enforcementResult: 'needs_human_review'` + a `qa:needs_review`
 * socket event so the dashboard can surface it in real time). The
 * operator can then review the original + revised output + decide
 * whether to (a) hand-craft a different reply, (b) blacklist the
 * pattern, or (c) file a prompt-improvement task.
 *
 * The 3-issue threshold matches the QA Reviewer prompt's severity
 * rubric: 1-2 issues are usually style/format nits the revisedOutput
 * already fixes; 3+ issues suggest a deeper problem worth a human
 * look.
 */
export const QA_HUMAN_ESCALATION_ISSUE_THRESHOLD = 3

/**
 * Run the QA Reviewer on an agent's output.
 *
 * Flow:
 *   1. Build the QA Reviewer prompt (tenant config + agent output + ctx).
 *   2. Call the LLM with an 8s timeout. On timeout/error → fail-closed
 *      (approve original — don't block the conversation on QA tooling).
 *   3. Parse the JSON output via the shared `parseAgentOutput` helper.
 *   4. Persist a DecisionLog row for audit (best-effort).
 *   5. Emit `qa:review` to the tenant's dashboard (fire-and-forget).
 *
 * NEVER throws — the orchestrator trusts this function to always return
 * a QAReviewResult so the conversation flow is never broken by a QA
 * internal error.
 */
export async function runQAReview(input: {
  tenantId: string
  agentName: string
  agentOutput: string
  conversationContext: string
  conversationId?: string
  customerId?: string
  perfil?: string
}): Promise<QAReviewResult> {
  const start = Date.now()

  // ── Build the QA Reviewer prompt ────────────────────────────────────
  // `ctx.query` carries the agent under review (cheap overload of an
  // existing AgentContext field — keeps the type stable). `ctx.message`
  // carries the agent's output to review. `ctx.customerId` /
  // `ctx.conversationId` are passed through for the reviewer's context.
  const ctx: AgentContext = {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    customerId: input.customerId,
    perfil: input.perfil,
    query: input.agentName,
    message: input.agentOutput + '\n\n--- Conversation context ---\n' + input.conversationContext,
  }

  let system: string
  let user: string
  try {
    const built = await buildQAReviewerPrompt(ctx)
    system = built.system
    user = built.user
  } catch (err) {
    captureError(err as Error, {
      agent: 'qa_reviewer',
      tenantId: input.tenantId,
      agentUnderReview: input.agentName,
    })
    return {
      approved: true,
      revisedOutput: undefined,
      issues: [],
      decisionSource: 'error',
      latencyMs: Date.now() - start,
    }
  }

  // ── Call the LLM with an 8s timeout ─────────────────────────────────
  const messages: ChatMessage[] = [
    { role: 'system', content: ANTI_INJECTION_PREFIX + system },
    { role: 'user', content: wrapUserInput(user) },
  ]

  let llmContent = ''
  let llmModel: string | undefined
  let llmProvider: string | undefined
  let llmUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined

  try {
    const llmResult = await Promise.race([
      chat(messages, {
        model: QA_REVIEWER_MODEL,
        thinking: 'disabled',
        temperature: 0,
        maxTokens: 2000,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('QA Reviewer LLM timeout')), QA_REVIEWER_TIMEOUT_MS),
      ),
    ])
    llmContent = llmResult.content ?? ''
    llmModel = llmResult.model
    llmProvider = llmResult.provider
    llmUsage = llmResult.usage
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log.warn(
      { err: errMsg, tenantId: input.tenantId, agentName: input.agentName },
      'QA Reviewer LLM call failed — failing closed (approve original)',
    )
    return {
      approved: true,
      revisedOutput: undefined,
      issues: [],
      decisionSource: errMsg.includes('timeout') ? 'timeout' : 'error',
      latencyMs: Date.now() - start,
    }
  }

  // ── Parse the JSON output ───────────────────────────────────────────
  const parsed = parseAgentOutput<{
    approved: boolean
    issues: string[]
    revisedOutput: string
  }>('qa_reviewer', llmContent)

  let result: QAReviewResult
  if (parsed) {
    result = {
      approved: parsed.approved,
      revisedOutput: parsed.approved ? undefined : (parsed.revisedOutput || undefined),
      issues: parsed.issues ?? [],
      decisionSource: 'llm',
      latencyMs: Date.now() - start,
    }
  } else {
    // JSON parse failed — fail-closed (approve original).
    result = {
      approved: true,
      revisedOutput: undefined,
      issues: [],
      decisionSource: 'error',
      latencyMs: Date.now() - start,
    }
    log.warn(
      { tenantId: input.tenantId, agentName: input.agentName, rawLen: llmContent.length, rawHead: llmContent.slice(0, 200) },
      'QA Reviewer LLM output unparseable — failing closed (approve original)',
    )
  }

  // ── Persist DecisionLog + emit socket event (best-effort) ──────────
  const llmMeta = { model: llmModel, provider: llmProvider, usage: llmUsage }
  void persistQAReviewDecision(input, result, llmMeta).catch(() => {})

  // ── IA-6B (Gap 8) — Feedback loop + human escalation ──────────────
  //
  // When the QA Reviewer finds issues, we:
  //   1. ALWAYS write a `QAFeedback` row — the per-incident log that
  //      prompt authors use to spot recurring failure patterns. Best-effort
  //      (a DB error never blocks the response).
  //   2. WHEN the issue count crosses the human-escalation threshold
  //      (default 3), create a SECOND DecisionLog row with
  //      `enforcementResult: 'needs_human_review'` + emit a
  //      `qa:needs_review` socket event so the dashboard can surface the
  //      escalation in real time. The operator reviews the original +
  //      revised output and decides what to do.
  //
  // The QAFeedback row is the "data" (per-incident); the
  // needs_human_review DecisionLog row is the "alert" (operator action
  // required). They're separate because not every QA failure needs human
  // attention — most are caught + revised automatically; only the
  // 3+ issue cases warrant a human look.
  if (!result.approved && result.issues.length > 0 && result.decisionSource === 'llm') {
    void persistQAFeedback(input, result).catch(() => {})
    if (result.issues.length >= QA_HUMAN_ESCALATION_ISSUE_THRESHOLD) {
      void escalateToHuman(input, result).catch(() => {})
    }
  }

  log.info(
    {
      tenantId: input.tenantId,
      agentName: input.agentName,
      approved: result.approved,
      issuesCount: result.issues.length,
      decisionSource: result.decisionSource,
      latencyMs: result.latencyMs,
      // IA-6B (Gap 8) — flag escalations for quick log filtering.
      escalated: !result.approved && result.issues.length >= QA_HUMAN_ESCALATION_ISSUE_THRESHOLD,
    },
    'QA review complete',
  )

  return result
}

/**
 * Persist a DecisionLog row for the QA review (best-effort — failure
 * is captured but never propagated). The `agentName` is 'qa_reviewer'
 * so it shows up in the agent decision log. `enforcementResult` carries
 * the full review shape (approved/issues/revised) so auditors can see
 * what was reviewed and what changed.
 */
async function persistQAReviewDecision(
  input: { tenantId: string; agentName: string; conversationId?: string },
  result: QAReviewResult,
  llmMeta: {
    model?: string
    provider?: string
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  },
): Promise<void> {
  try {
    await db.decisionLog.create({
      data: {
        tenantId: input.tenantId,
        agentName: 'qa_reviewer',
        conversationId: input.conversationId ?? null,
        input: JSON.stringify({
          reviewedAgent: input.agentName,
          originalOutputLen: 0, // not available here — kept for schema compat
        }),
        output: JSON.stringify({
          approved: result.approved,
          issues: result.issues,
          revisedOutputLen: result.revisedOutput?.length ?? 0,
          decisionSource: result.decisionSource,
        }),
        reasoning: null,
        confidence: result.decisionSource === 'llm' ? 0.85 : 0.3,
        enforcementResult: JSON.stringify({
          allowed: result.approved,
          violations: result.issues,
          escalated: !result.approved,
          blocked: false,
        }),
        liabilityParty: result.approved ? null : 'agent_provider',
        model: llmMeta.model ?? null,
        provider: llmMeta.provider ?? null,
        promptTokens: llmMeta.usage?.promptTokens ?? null,
        completionTokens: llmMeta.usage?.completionTokens ?? null,
        totalTokens: llmMeta.usage?.totalTokens ?? null,
        costUsd: llmMeta.usage && llmMeta.provider
          ? calculateCost(llmMeta.provider, llmMeta.usage)
          : null,
        latencyMs: result.latencyMs,
      },
    })
    emitToTenant(input.tenantId, 'qa:review', {
      reviewedAgent: input.agentName,
      conversationId: input.conversationId,
      approved: result.approved,
      issues: result.issues,
      decisionSource: result.decisionSource,
      latencyMs: result.latencyMs,
    })
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId: input.tenantId },
      'QA Reviewer DecisionLog persist failed (non-blocking)',
    )
  }
}

/**
 * Convenience: should this agent's output be reviewed by QA?
 *
 * The orchestrator calls this to decide whether to invoke `runQAReview`
 * after an agent step. Centralized here so the list of reviewed agents
 * is a single source of truth (used by both the orchestrator route and
 * the `/api/agents/[agentName]` route).
 *
 * IA-6B (Gap 8) — confidence-threshold fast path. The optional
 * `confidence` arg lets the caller skip QA when the agent's output is
 * already high-confidence (>= `QA_CONFIDENCE_THRESHOLD`). This saves
 * an 8s + frontier-model call on the common high-confidence path
 * (e.g. schema-validated JSON output) while still running QA on the
 * risky low-confidence path (e.g. free-text output the route is
 * unsure about).
 *
 * When `confidence` is omitted, QA always runs (preserves the fail-safe
 * default for older call sites that haven't been updated).
 */
export function shouldReviewAgent(agentName: string, confidence?: number): boolean {
  if (!QA_REVIEWED_AGENTS.has(agentName)) return false
  // IA-6B (Gap 8) — fast path: skip QA when the route is already
  // confident the output is good. The threshold matches the agent-eval
  // promotion-gate bar (0.7) — anything above that is "trust the agent".
  if (typeof confidence === 'number' && confidence > QA_CONFIDENCE_THRESHOLD) {
    return false
  }
  return true
}

// ───────────────────────────────────────────────────────────────────────────
// IA-6B (Gap 8) — Feedback loop + human escalation helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Persist a `QAFeedback` row for every QA review that found issues.
 * Best-effort — never throws. The `severity` field is derived from the
 * issue count (>= threshold → 'high', else 'medium') so prompt authors
 * can filter the feedback table to "show me the high-severity patterns
 * for the quote agent".
 *
 * The `promptVersion` field is left null for now — a follow-up will
 * wire the resolved prompt version from `promptVersionManager.getPrompt()`
 * so feedback can be correlated to a specific prompt version (which
 * powers the per-version metrics roll-up).
 */
async function persistQAFeedback(
  input: { tenantId: string; agentName: string; conversationId?: string },
  result: QAReviewResult,
): Promise<void> {
  try {
    await db.qAFeedback.create({
      data: {
        tenantId: input.tenantId,
        agentName: input.agentName,
        issues: JSON.stringify(result.issues),
        severity:
          result.issues.length >= QA_HUMAN_ESCALATION_ISSUE_THRESHOLD ? 'high' : 'medium',
        conversationId: input.conversationId ?? null,
        promptVersion: null,
      },
    })
  } catch (err) {
    log.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        tenantId: input.tenantId,
        agentName: input.agentName,
      },
      'QA Reviewer feedback persist failed (non-blocking)',
    )
  }
}

/**
 * Escalate a QA review failure to a human reviewer. Creates a SECOND
 * DecisionLog row (in addition to the one written by
 * `persistQAReviewDecision`) with `enforcementResult: 'needs_human_review'`
 * + `humanReviewed: false` so the operator's queue surfaces it. Also
 * emits a `qa:needs_review` socket event for real-time dashboard
 * notification.
 *
 * Best-effort — never throws. The first DecisionLog row (the per-review
 * audit) was already written by `persistQAReviewDecision`; this second
 * row is the operator-actionable alert.
 */
async function escalateToHuman(
  input: { tenantId: string; agentName: string; conversationId?: string },
  result: QAReviewResult,
): Promise<void> {
  try {
    await db.decisionLog.create({
      data: {
        tenantId: input.tenantId,
        agentName: 'qa_reviewer',
        conversationId: input.conversationId ?? null,
        input: JSON.stringify({
          reviewedAgent: input.agentName,
          issueCount: result.issues.length,
          issues: result.issues,
        }),
        output: JSON.stringify({
          approved: result.approved,
          revisedOutputLen: result.revisedOutput?.length ?? 0,
          decisionSource: result.decisionSource,
          escalated: true,
        }),
        reasoning: `QA Reviewer found ${result.issues.length} issues: ${result.issues.join(', ').slice(0, 500)}`,
        confidence: 0.3,
        // The marker the operator queue filters on.
        enforcementResult: 'needs_human_review',
        liabilityParty: 'agent_provider',
        // `humanReviewed: false` is the default — set explicitly so the
        // operator dashboard can filter on "unreviewed escalations".
        humanReviewed: false,
        latencyMs: result.latencyMs,
      },
    })
    emitToTenant(input.tenantId, 'qa:needs_review', {
      reviewedAgent: input.agentName,
      conversationId: input.conversationId,
      issues: result.issues,
      issueCount: result.issues.length,
      revisedOutputLen: result.revisedOutput?.length ?? 0,
      decisionSource: result.decisionSource,
      latencyMs: result.latencyMs,
    })
    log.warn(
      {
        tenantId: input.tenantId,
        agentName: input.agentName,
        conversationId: input.conversationId,
        issueCount: result.issues.length,
      },
      'QA Reviewer escalated to human review',
    )
  } catch (err) {
    log.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        tenantId: input.tenantId,
        agentName: input.agentName,
      },
      'QA Reviewer human-escalation persist failed (non-blocking)',
    )
  }
}
