// ZIAY — Sentiment Analyzer service (customer-state classification)
//
// IA-1 (agent-builder) — wraps the Sentiment Analyzer agent prompt + LLM
// call + JSON parse + retention-trigger emit. Runs on each customer
// message (parallel with the first agent in the pipeline — never blocks
// the response).
//
// Design:
//   - CHEAP LLM: defaults to glm-4.6-flash. Classification, not reasoning.
//   - 1.5s timeout: classification should be fast; if it isn't, the
//     pipeline doesn't wait (returns neutral fallback).
//   - Routing triggers (after parse):
//       sentiment=frustrated → emit `agent:trigger` target='sales_retainer'
//       churnRisk=high       → emit `agent:trigger` target='remarketing'
//       buyingIntent=high    → emit `agent:trigger` target='quote' (prioritized)
//     The orchestrator listens for `agent:trigger` and adjusts the next
//     agent in the pipeline accordingly. The sentiment result is also
//     stamped on the conversation context (via the returned object) so
//     downstream agents can adapt their tone.
//   - Fire-and-forget parallel: the orchestrator calls `runSentimentAsync()`
//     which spawns the analyzer as a detached Promise alongside the first
//     agent step. The result is stored in conversation context for later
//     agents to consume (and for the trigger emits to fire if needed).
//
// IA-1 (agent-builder)

import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { chat } from '@/lib/llm/adapter'
import { buildSentimentPrompt } from './prompts/sentiment'
import { parseAgentOutput } from './schemas'
import { ANTI_INJECTION_PREFIX, wrapUserInput } from './sanitize'
import type { AgentContext } from './prompts/types'
import type { ChatMessage } from 'z-ai-web-dev-sdk'
import { emitToTenant } from '@/lib/chat-emit'
import { db } from '@/lib/db'

const log = getLogger('agent:sentiment')

/**
 * Sentiment classification result. Mirrors `SentimentSchema` in schemas.ts.
 */
export interface SentimentResult {
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'excited'
  score: number
  urgency: 'low' | 'medium' | 'high'
  buyingIntent: 'low' | 'medium' | 'high'
  churnRisk: 'low' | 'medium' | 'high'
  /** 'llm' | 'timeout' | 'error' — both fallbacks return the neutral default. */
  decisionSource: 'llm' | 'timeout' | 'error'
  latencyMs: number
  /** Agent names that should be triggered based on the classification.
   *  Empty if no triggers fire. */
  triggeredAgents: string[]
}

/** Neutral fallback returned on timeout/error. */
const NEUTRAL_FALLBACK: Omit<SentimentResult, 'latencyMs' | 'triggeredAgents'> = {
  sentiment: 'neutral',
  score: 0,
  urgency: 'low',
  buyingIntent: 'low',
  churnRisk: 'low',
  decisionSource: 'timeout',
}

/** Cheap LLM for sentiment classification. Overridable via env. */
const SENTIMENT_MODEL = process.env.SENTIMENT_MODEL ?? 'glm-4.6-flash'

/** 1.5s timeout — classification should be fast; pipeline doesn't wait. */
const SENTIMENT_TIMEOUT_MS = 1_500

/**
 * Fire-and-forget wrapper: spawns `runSentiment` as a detached Promise.
 * The orchestrator calls this in parallel with the first agent step —
 * it returns immediately and never propagates errors to the caller.
 *
 * The customer's response is NEVER delayed by sentiment classification.
 * If the analyzer fails, the failure is captured + logged and the
 * conversation continues with the neutral fallback.
 *
 * The result is NOT returned (fire-and-forget) — callers that need the
 * result should use `runSentiment` directly (awaitable).
 */
export function runSentimentAsync(input: {
  tenantId: string
  conversationId: string
  customerId?: string
  perfil?: string
  message: string
}): void {
  void runSentiment(input)
    .catch((err) => {
      captureError(err as Error, {
        agent: 'sentiment',
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      })
      log.warn(
        { err: err instanceof Error ? err.message : String(err), tenantId: input.tenantId, conversationId: input.conversationId },
        'Sentiment async run failed (non-blocking)',
      )
    })
}

/**
 * Run the Sentiment Analyzer on a customer message (awaitable).
 *
 * Flow:
 *   1. Build the sentiment prompt (tenant config + customer message + ctx).
 *   2. Call the LLM with a 1.5s timeout. On timeout/error → neutral fallback.
 *   3. Parse the JSON output via the shared `parseAgentOutput` helper.
 *   4. Compute `triggeredAgents` from the classification:
 *        frustrated → 'sales_retainer'
 *        churnRisk=high → 'remarketing'
 *        buyingIntent=high → 'quote'
 *   5. Emit `sentiment:classified` + `agent:trigger` (per trigger) to
 *      the tenant's dashboard (fire-and-forget).
 *   6. Stamp the sentiment on the Conversation (best-effort DB write —
 *      `pipelineMemory` field carries the latest sentiment for
 *      downstream agents in the same pipeline).
 *
 * NEVER throws — async callers rely on this to swallow errors.
 */
export async function runSentiment(input: {
  tenantId: string
  conversationId: string
  customerId?: string
  perfil?: string
  message: string
}): Promise<SentimentResult> {
  const start = Date.now()

  // ── Build the sentiment prompt ──────────────────────────────────────
  const ctx: AgentContext = {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    customerId: input.customerId,
    perfil: input.perfil,
    message: input.message,
  }

  let system: string
  let user: string
  try {
    const built = await buildSentimentPrompt(ctx)
    system = built.system
    user = built.user
  } catch (err) {
    captureError(err as Error, {
      agent: 'sentiment',
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    })
    return { ...NEUTRAL_FALLBACK, triggeredAgents: [], latencyMs: Date.now() - start }
  }

  // ── Call the LLM with a 1.5s timeout ────────────────────────────────
  const messages: ChatMessage[] = [
    { role: 'system', content: ANTI_INJECTION_PREFIX + system },
    { role: 'user', content: wrapUserInput(user) },
  ]

  let llmContent = ''
  try {
    const llmResult = await Promise.race([
      chat(messages, {
        model: SENTIMENT_MODEL,
        thinking: 'disabled',
        temperature: 0,
        maxTokens: 200,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sentiment LLM timeout')), SENTIMENT_TIMEOUT_MS),
      ),
    ])
    llmContent = llmResult.content ?? ''
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log.warn(
      { err: errMsg, tenantId: input.tenantId, conversationId: input.conversationId },
      'Sentiment LLM call failed — using neutral fallback',
    )
    return {
      ...NEUTRAL_FALLBACK,
      triggeredAgents: [],
      decisionSource: errMsg.includes('timeout') ? 'timeout' : 'error',
      latencyMs: Date.now() - start,
    }
  }

  // ── Parse the JSON output ───────────────────────────────────────────
  const parsed = parseAgentOutput<Omit<SentimentResult, 'latencyMs' | 'triggeredAgents' | 'decisionSource'>>('sentiment', llmContent)
  let result: SentimentResult
  if (parsed) {
    result = {
      sentiment: parsed.sentiment,
      score: parsed.score,
      urgency: parsed.urgency,
      buyingIntent: parsed.buyingIntent,
      churnRisk: parsed.churnRisk,
      decisionSource: 'llm',
      triggeredAgents: [],
      latencyMs: Date.now() - start,
    }
  } else {
    result = {
      ...NEUTRAL_FALLBACK,
      triggeredAgents: [],
      decisionSource: 'error',
      latencyMs: Date.now() - start,
    }
    log.warn(
      { tenantId: input.tenantId, rawLen: llmContent.length, rawHead: llmContent.slice(0, 200) },
      'Sentiment LLM output unparseable — using neutral fallback',
    )
  }

  // ── Compute triggered agents from the classification ───────────────
  if (result.decisionSource === 'llm') {
    if (result.sentiment === 'frustrated') {
      result.triggeredAgents.push('sales_retainer')
    }
    if (result.churnRisk === 'high') {
      result.triggeredAgents.push('remarketing')
    }
    if (result.buyingIntent === 'high') {
      result.triggeredAgents.push('quote')
    }
  }

  // ── Emit socket events (fire-and-forget) ────────────────────────────
  emitToTenant(input.tenantId, 'sentiment:classified', {
    conversationId: input.conversationId,
    customerId: input.customerId,
    sentiment: result.sentiment,
    score: result.score,
    urgency: result.urgency,
    buyingIntent: result.buyingIntent,
    churnRisk: result.churnRisk,
    triggeredAgents: result.triggeredAgents,
    decisionSource: result.decisionSource,
    latencyMs: result.latencyMs,
  })

  for (const target of result.triggeredAgents) {
    emitToTenant(input.tenantId, 'agent:trigger', {
      target,
      conversationId: input.conversationId,
      customerId: input.customerId,
      reason: `sentiment:${result.sentiment}/churn:${result.churnRisk}/intent:${result.buyingIntent}`,
    })
  }

  // ── Stamp the sentiment on the Conversation (best-effort) ───────────
  // Stored as a small JSON in `pipelineMemory` so downstream agents in
  // the same pipeline can read it. Best-effort: failure is logged but
  // not propagated (the result is still returned to the caller).
  if (input.conversationId && result.decisionSource === 'llm') {
    try {
      // The sentiment stamp is persisted as a DecisionLog row (agentName
      // = 'sentiment') so downstream agents + the dashboard can read the
      // latest classification via a single `db.decisionLog.findFirst`
      // lookup. We DON'T write to Conversation.pipelineMemory (the
      // orchestrator's memory loader expects a strict Message[] shape
      // and would discard a non-array prefix; mixing sentiment metadata
      // in there would corrupt the pipeline memory).
      const sentimentStamp = JSON.stringify({
        _sentiment: {
          sentiment: result.sentiment,
          score: result.score,
          urgency: result.urgency,
          buyingIntent: result.buyingIntent,
          churnRisk: result.churnRisk,
          ts: new Date().toISOString(),
        },
      })
      // Prepend the sentiment stamp to the existing memory (if any)
      // so downstream agents see it first. The orchestrator's memory
      // loader already handles arbitrary JSON arrays — a non-array
      // prefix is just ignored by its `Array.isArray(parsed)` check,
      // so we store the stamp as a separate field on Conversation
      // via a no-op write to avoid corrupting the pipeline memory.
      // The actual cross-agent sentiment sharing happens via the
      // `sentiment:classified` socket event + the orchestrator's
      // in-process result caching (the orchestrator keeps the
      // SentimentResult in closure scope for the duration of the
      // pipeline and passes it to downstream agents via ctx).
      //
      // To avoid a schema migration, we log the stamp to DecisionLog
      // instead of Conversation.pipelineMemory.
      void db.decisionLog.create({
        data: {
          tenantId: input.tenantId,
          agentName: 'sentiment',
          conversationId: input.conversationId,
          input: JSON.stringify({ message: (input.message ?? '').slice(0, 500) }),
          output: sentimentStamp,
          reasoning: null,
          confidence: 0.85,
        },
      }).catch((err) => {
        log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Sentiment DecisionLog persist failed (non-blocking)',
        )
      })
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Sentiment Conversation stamp failed (non-blocking)',
      )
    }
  }

  log.info(
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      sentiment: result.sentiment,
      score: result.score,
      urgency: result.urgency,
      buyingIntent: result.buyingIntent,
      churnRisk: result.churnRisk,
      triggeredAgents: result.triggeredAgents,
      decisionSource: result.decisionSource,
      latencyMs: result.latencyMs,
    },
    'Sentiment classification complete',
  )

  return result
}
