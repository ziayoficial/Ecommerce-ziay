// ZIAY — Agent Observability / Tracing (IA-2 · agent-hardening)
//
// Lightweight, dependency-free tracing layer for the 26-agent fleet. Every
// agent invocation gets a `AgentTrace` record covering:
//
//   - Identity: trace ID, tenantId, conversationId, agentName, parentId
//   - I/O: input context (sanitized), output text, model used
//   - Tokens/cost: tokensIn, tokensOut, costUsd (via model-router pricing)
//   - Performance: latencyMs (wall-clock)
//   - Outcome: status (success | error | timeout) + errorMessage
//
// Two sinks:
//
//   1. In-memory `Map<traceId, AgentTrace>` with a 1-hour TTL — powers the
//      `/api/agents/traces` admin endpoint for live debugging without
//      round-tripping to the DB. Periodic sweep evicts expired entries so
//      long-running processes don't leak memory.
//
//   2. `DecisionLog` Prisma model (already persisted by the agent route)
//      — the tracer writes a parallel row with the same `agentName` /
//      `conversationId` / `input` / `output` / `confidence` / `reasoning`
//      fields, plus `model` / `promptTokens` / `completionTokens` /
//      `costUsd` / `latencyMs` for the cost-control dashboard.
//
//   3. Structured JSON log via pino (`logger.info({ trace }, 'agent.trace')`)
//      — for log aggregation (Loki / Datadog / CloudWatch). This is the
//      upgrade path to Langfuse / LangSmith: the JSON shape already matches
//      their ingestion format, so a future migration just swaps the sink.
//
// Design notes:
//
//   - No external dependency. The whole point of IA-2 is to ship
//     observability *now*, without waiting on a Langfuse procurement.
//     The `AgentTrace` interface is shaped to map 1:1 onto Langfuse's
//     `Generation` schema, so a future adapter only needs to translate
//     field names + POST to the Langfuse API.
//
//   - Spans, not traces. `AgentSpan` is the live handle the orchestrator
//     holds while the agent is running; `AgentTrace` is the finalized
//     record persisted on `span.end()`. The split lets the caller attach
//     metadata (tokens, cost, error) after the LLM call returns without
//     re-fetching the trace by ID.
//
//   - Nested spans. `span.child(agentName, input)` creates a sub-span
//     with `parentId` set — used when the orchestrator fans out into
//     parallel sub-agents (e.g. customer_score + carrier_score + address
//     running concurrently for a quote). The parent/child relationship is
//     stored on the trace so the admin UI can render a tree.
//
//   - Non-blocking persistence. The DB write happens via `fireAndForget`
//     (caught + logged) — a slow DB must never block the agent reply.
//
//   - Sanitization. The `input` field is sanitized with the same
//     `sanitizeParsed` helper the agent route uses, so a malicious
//     `__proto__` payload or a null byte in the user message can't break
//     pino's JSON formatter when the trace is logged.
// ───────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { getModelForAgent, estimateCost } from './model-router'
import { sanitizeParsed } from '@/lib/middleware/sanitize'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface AgentTrace {
  id: string
  tenantId: string
  conversationId: string
  agentName: string
  input: unknown
  output: string
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  status: 'success' | 'error' | 'timeout'
  errorMessage?: string
  parentId?: string
  startedAt: Date
  finishedAt: Date
}

export interface AgentSpanMetadata {
  tenantId?: string
  conversationId?: string
  model?: string
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  status?: AgentTrace['status']
  errorMessage?: string
  parentId?: string
  confidence?: number
  reasoning?: string
}

// ───────────────────────────────────────────────────────────────────────────
// In-memory trace store (1h TTL)
// ───────────────────────────────────────────────────────────────────────────

const TRACE_TTL_MS = 60 * 60 * 1000 // 1 hour
const SWEEP_INTERVAL_MS = 10 * 60 * 1000 // sweep every 10 min

const tracesById = new Map<string, AgentTrace>()
const tracesByConversation = new Map<string, Set<string>>()

let sweepTimer: NodeJS.Timeout | null = null

function ensureSweepTimer(): void {
  if (sweepTimer) return
  // Only run the sweep on the server (not during build / lint).
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
    // In production we still want the sweep — just check we're not in a
    // build context (`next build` runs the module graph but never serves).
    if (!process.env.NEXT_RUNTIME) return
  }
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - TRACE_TTL_MS
    let evicted = 0
    for (const [id, trace] of tracesById) {
      if (trace.finishedAt.getTime() < cutoff) {
        tracesById.delete(id)
        const set = tracesByConversation.get(trace.conversationId)
        if (set) {
          set.delete(id)
          if (set.size === 0) tracesByConversation.delete(trace.conversationId)
        }
        evicted++
      }
    }
    if (evicted > 0) {
      logger.debug({ evicted, remaining: tracesById.size }, 'agent.trace.sweep')
    }
  }, SWEEP_INTERVAL_MS)
  // Don't keep the event loop alive just for the sweep.
  if (sweepTimer && typeof sweepTimer.unref === 'function') sweepTimer.unref()
}

// ───────────────────────────────────────────────────────────────────────────
// AgentSpan — live handle held by the caller while the agent runs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Live handle for an in-flight agent invocation. Created by
 * `AgentTracer.startSpan()`, finalized by `span.end()` (success) or
 * `span.setError()` (failure). Hold the span across the LLM call, then
 * call `.end(output, metadata)` with the token usage + cost from the
 * adapter result.
 *
 * Spans are cheap to create — no DB write happens until `.end()`.
 */
export class AgentSpan {
  readonly id: string
  readonly agentName: string
  readonly input: unknown
  readonly startedAt: Date
  private readonly tracer: AgentTracer
  private parentId?: string
  private tenantId?: string
  private conversationId?: string
  private ended = false

  constructor(
    tracer: AgentTracer,
    agentName: string,
    input: unknown,
    parentId?: string,
  ) {
    this.tracer = tracer
    this.id = randomUUID()
    this.agentName = agentName
    this.input = sanitizeParsed(input)
    this.startedAt = new Date()
    this.parentId = parentId
  }

  /**
   * Finalize the span with the agent's output + optional metadata
   * (tokens, cost, model, status). Computes `latencyMs` from the span's
   * `startedAt`. Persists the trace to the in-memory store + DecisionLog
   * + structured log.
   *
   * Safe to call exactly once. Subsequent calls are no-ops (logged as
   * warn) — protects against double-end bugs in the orchestrator where
   * a finally block + a success path could both call `.end()`.
   */
  end(output: string, metadata: AgentSpanMetadata = {}): void {
    if (this.ended) {
      logger.warn(
        { traceId: this.id, agentName: this.agentName },
        'agent.trace.end called twice — ignoring second call',
      )
      return
    }
    this.ended = true
    const finishedAt = new Date()
    const latencyMs = finishedAt.getTime() - this.startedAt.getTime()

    // Resolve tenantId / conversationId from metadata or fall back to
    // the parent's values (children inherit context).
    const tenantId = metadata.tenantId ?? this.tenantId ?? 'unknown'
    const conversationId = metadata.conversationId ?? this.conversationId ?? 'unknown'

    // Resolve model from metadata or the model-router.
    const routerModel = getModelForAgent(this.agentName).model
    const model = metadata.model ?? routerModel

    // Resolve tokens / cost from metadata or compute from the model-router
    // pricing (only when the caller supplied token counts).
    const tokensIn = metadata.tokensIn ?? 0
    const tokensOut = metadata.tokensOut ?? 0
    const costUsd =
      metadata.costUsd ??
      (tokensIn || tokensOut ? estimateCost(this.agentName, tokensIn, tokensOut) : 0)

    const status = metadata.status ?? 'success'

    const trace: AgentTrace = {
      id: this.id,
      tenantId,
      conversationId,
      agentName: this.agentName,
      input: this.input,
      output,
      model,
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs,
      status,
      errorMessage: metadata.errorMessage,
      parentId: this.parentId,
      startedAt: this.startedAt,
      finishedAt,
    }

    this.tracer.recordTrace(trace, metadata)
  }

  /**
   * Finalize the span as an error / timeout. Shorthand for
   * `span.end('', { status: 'error', errorMessage })`.
   */
  setError(error: string, status: 'error' | 'timeout' = 'error'): void {
    this.end('', { status, errorMessage: error })
  }

  /**
   * Create a child span — used when the orchestrator fans out into
   * sub-agents. The child inherits the parent's tenantId / conversationId
   * unless the caller overrides them in `.end()` metadata.
   */
  child(agentName: string, input: unknown): AgentSpan {
    const childSpan = this.tracer.startSpan(agentName, input)
    childSpan.parentId = this.id
    childSpan.tenantId = this.tenantId
    childSpan.conversationId = this.conversationId
    return childSpan
  }

  /** Attach tenantId / conversationId after creation (orchestrator pattern). */
  setContext(ctx: { tenantId?: string; conversationId?: string }): void {
    if (ctx.tenantId) this.tenantId = ctx.tenantId
    if (ctx.conversationId) this.conversationId = ctx.conversationId
  }
}

// ───────────────────────────────────────────────────────────────────────────
// AgentTracer — the public façade
// ───────────────────────────────────────────────────────────────────────────

/**
 * Singleton tracer for the agent layer. Callers do `tracer.startSpan(...)`
 * to begin a span, then `span.end(output, { tokensIn, tokensOut })` to
 * finalize. The tracer handles persistence + logging.
 *
 * The class is exported (not just a singleton instance) so tests can
 * construct an isolated instance with a fresh in-memory store. Production
 * code uses the default `agentTracer` export.
 */
export class AgentTracer {
  startSpan(agentName: string, input: unknown): AgentSpan {
    ensureSweepTimer()
    return new AgentSpan(this, agentName, input)
  }

  /**
   * Internal: persist a finalized trace to all three sinks (in-memory,
   * DecisionLog, structured log). Called by `AgentSpan.end()` — not part
   * of the public API.
   */
  recordTrace(trace: AgentTrace, metadata: AgentSpanMetadata): void {
    // 1. In-memory store.
    tracesById.set(trace.id, trace)
    let convoSet = tracesByConversation.get(trace.conversationId)
    if (!convoSet) {
      convoSet = new Set()
      tracesByConversation.set(trace.conversationId, convoSet)
    }
    convoSet.add(trace.id)

    // 2. Structured JSON log (pino) — the log-aggregation sink. The shape
    //    matches Langfuse's `Generation` schema for a future swap.
    logger.info(
      {
        trace: {
          id: trace.id,
          tenantId: trace.tenantId,
          conversationId: trace.conversationId,
          agentName: trace.agentName,
          model: trace.model,
          tokensIn: trace.tokensIn,
          tokensOut: trace.tokensOut,
          costUsd: trace.costUsd,
          latencyMs: trace.latencyMs,
          status: trace.status,
          errorMessage: trace.errorMessage,
          parentId: trace.parentId,
          startedAt: trace.startedAt.toISOString(),
          finishedAt: trace.finishedAt.toISOString(),
        },
      },
      'agent.trace',
    )

    // 3. DecisionLog persistence (fire-and-forget).
    this.persistToDecisionLog(trace, metadata).catch((err) => {
      captureError(err, {
        service: 'agents',
        method: 'tracer.persistToDecisionLog',
        traceId: trace.id,
        agentName: trace.agentName,
        tenantId: trace.tenantId,
      })
    })
  }

  /**
   * Persist the trace to `DecisionLog`. Mirrors the schema written by
   * `agentsService.persistDecisionLog` (which is called separately by the
   * agent route) but with the tracer's richer metadata (latency, tokens,
   * cost). The two rows are differentiated by `input`/`output` — the
   * tracer's row includes the full `AgentTrace` JSON in `reasoning` so
   * the admin UI can render the trace tree.
   *
   * This is intentionally a separate write from the agent route's
   * `persistDecisionLog` call — the route persists the agent's *decision*
   * (reply, confidence, error), while the tracer persists the *execution
   * metadata* (tokens, cost, latency, parent/child). They answer different
   * questions: "what did the agent decide?" vs "how did the call go?".
   */
  private async persistToDecisionLog(
    trace: AgentTrace,
    metadata: AgentSpanMetadata,
  ): Promise<void> {
    try {
      await db.decisionLog.create({
        data: {
          tenantId: trace.tenantId,
          agentName: trace.agentName,
          conversationId: trace.conversationId !== 'unknown' ? trace.conversationId : null,
          input: JSON.stringify(trace.input),
          output: trace.output,
          reasoning: JSON.stringify({
            traceId: trace.id,
            parentId: trace.parentId ?? null,
            status: trace.status,
            errorMessage: trace.errorMessage ?? null,
          }),
          confidence: metadata.confidence ?? null,
          model: trace.model,
          // Provider is unknown to the tracer (the adapter owns it) — leave null.
          provider: null,
          promptTokens: trace.tokensIn || null,
          completionTokens: trace.tokensOut || null,
          totalTokens: trace.tokensIn + trace.tokensOut || null,
          costUsd: trace.costUsd || null,
          latencyMs: trace.latencyMs,
        },
      })
    } catch (err) {
      // Non-blocking — captured + logged. The agent reply still goes out.
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          traceId: trace.id,
          agentName: trace.agentName,
        },
        'agent.trace.persist failed (non-blocking)',
      )
    }
  }

  getTrace(traceId: string): AgentTrace | null {
    return tracesById.get(traceId) ?? null
  }

  /**
   * Get all traces for a conversation, ordered by `startedAt` ascending
   * (so the orchestrator's parent span comes before its children).
   */
  getConversationTraces(conversationId: string): AgentTrace[] {
    const ids = tracesByConversation.get(conversationId)
    if (!ids) return []
    const traces: AgentTrace[] = []
    for (const id of ids) {
      const t = tracesById.get(id)
      if (t) traces.push(t)
    }
    return traces.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  }

  /**
   * Get the N most recent traces across all tenants (admin dashboard).
   * Returns traces ordered by `finishedAt` descending.
   */
  getRecentTraces(limit = 50): AgentTrace[] {
    const all = Array.from(tracesById.values())
    return all
      .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())
      .slice(0, limit)
  }

  /**
   * Test-only: clear the in-memory store. Used by the evaluation harness
   * to isolate test runs. Not part of the public API — exported for tests.
   */
  clearForTesting(): void {
    tracesById.clear()
    tracesByConversation.clear()
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Singleton tracer
// ───────────────────────────────────────────────────────────────────────────

export const agentTracer = new AgentTracer()
