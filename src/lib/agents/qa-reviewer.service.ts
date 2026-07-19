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
 * The set of agents whose output is reviewed by QA. Hardcoded per the
 * IA-1 task spec: revenue-critical agents where a hallucination would
 * directly cost the tenant money (wrong price → lost sale / margin;
 * wrong address → failed delivery; wrong novedad → wrong action taken;
 * premature checkout confirmation → chargeback risk).
 */
export const QA_REVIEWED_AGENTS = new Set<string>([
  'quote',
  'novedades',
  'address',
  'checkout',
])

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

  log.info(
    {
      tenantId: input.tenantId,
      agentName: input.agentName,
      approved: result.approved,
      issuesCount: result.issues.length,
      decisionSource: result.decisionSource,
      latencyMs: result.latencyMs,
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
 */
export function shouldReviewAgent(agentName: string): boolean {
  return QA_REVIEWED_AGENTS.has(agentName)
}
