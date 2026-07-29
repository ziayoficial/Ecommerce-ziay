// ZIAY — Memory Curator service (async long-term fact extraction)
//
// IA-1 (agent-builder) — wraps the Memory Curator agent prompt + LLM call
// + JSON parse + CustomerMemory persistence with embeddings. Runs ASYNC
// after each conversation turn (fire-and-forget — never blocks the
// response to the customer).
//
// Design:
//   - Cheap LLM: defaults to glm-4.6-flash (extraction is classification,
//     not reasoning). Overridable via env.
//   - 10s timeout: extraction over a full turn transcript can take a
//     few seconds; the customer never waits (fire-and-forget).
//   - De-duplication: existing facts with the same (tenantId, customerId,
//     type, key) are updated in place (value + confidence + extractedFrom
//     + embedding) rather than duplicated. This keeps the memory table
//     compact and the latest value authoritative.
//   - Embeddings: each fact's `${key}: ${value}` is embedded via the
//     existing `src/lib/embeddings/service.ts` `embed()` (deterministic
//     hash embedding in dev SQLite, real embedding API in prod PG via
//     pgvector). The embedding is stored in `CustomerMemory.embeddingTexto`
//     so future agents can do semantic recall ("what do I know about this
//     customer that's relevant to THIS question?").
//   - Fire-and-forget: the orchestrator calls `runMemoryCuratorAsync()`
//     which spawns the curator as a detached Promise — it never awaits
//     the result, so the customer's response is never delayed by memory
//     extraction.
//
// IA-1 (agent-builder)

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { chat } from '@/lib/llm/adapter'
import { calculateCost } from '@/lib/llm/costs'
import { embed } from '@/lib/embeddings/service'
import { buildMemoryCuratorPrompt } from './prompts/memory_curator'
import { parseAgentOutput } from './schemas'
import { ANTI_INJECTION_PREFIX, wrapUserInput } from './sanitize'
import type { AgentContext } from './prompts/types'
import type { ChatMessage } from 'z-ai-web-dev-sdk'
import { emitToTenant } from '@/lib/chat-emit'

const log = getLogger('agent:memory-curator')

/**
 * Single extracted fact (mirrors `MemoryCuratorFactSchema` in schemas.ts).
 */
export interface ExtractedFact {
  type: 'preference' | 'purchase_history' | 'objection' | 'budget' | 'brand' | 'style' | 'other'
  key: string
  value: string
  confidence: number
}

/**
 * Result of the Memory Curator run. Returned for callers that want to
 * await (e.g. tests, admin debug endpoints). The orchestrator uses
 * `runMemoryCuratorAsync()` which never awaits.
 */
export interface MemoryCuratorResult {
  factsExtracted: number
  factsUpserted: number
  decisionSource: 'llm' | 'timeout' | 'error'
  latencyMs: number
}

/** Cheap LLM for the curator. Overridable via env for prod swap. */
const MEMORY_CURATOR_MODEL = process.env.MEMORY_CURATOR_MODEL ?? 'glm-4.6-flash'

/** 10s timeout — extraction over a full turn transcript can take a few
 *  seconds, but the customer never waits (fire-and-forget). */
const MEMORY_CURATOR_TIMEOUT_MS = 10_000

/**
 * Fire-and-forget wrapper: spawns `runMemoryCurator` as a detached
 * Promise. The orchestrator calls this after each conversation turn —
 * it returns immediately and never propagates errors to the caller.
 *
 * The customer's response is NEVER delayed by memory extraction. If
 * the curator fails, the failure is captured + logged but the
 * conversation continues normally.
 */
export function runMemoryCuratorAsync(input: {
  tenantId: string
  conversationId: string
  customerId?: string
  perfil?: string
  /** Latest turn transcript (customer message + agent reply). */
  turnTranscript: string
}): void {
  // `void` keyword makes the floating promise explicit — we deliberately
  // don't await it. The catch handler logs and swallows.
  void runMemoryCurator(input)
    .catch((err) => {
      captureError(err as Error, {
        agent: 'memory_curator',
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      })
      log.warn(
        { err: err instanceof Error ? err.message : String(err), tenantId: input.tenantId, conversationId: input.conversationId },
        'Memory Curator async run failed (non-blocking)',
      )
    })
}

/**
 * Run the Memory Curator on a conversation turn (awaitable).
 *
 * Flow:
 *   1. Build the curator prompt (tenant config + turn transcript + ctx).
 *   2. Call the LLM with a 10s timeout. On timeout/error → return
 *      `{ factsExtracted: 0, decisionSource: 'timeout'|'error' }`.
 *   3. Parse the JSON output via the shared `parseAgentOutput` helper.
 *   4. De-duplicate + upsert each fact into `CustomerMemory`:
 *        - compute the embedding of `${key}: ${value}`
 *        - lookup by (tenantId, customerId, type, key)
 *        - if exists → update value + confidence + extractedFrom + embedding
 *        - if new → create with embedding
 *   5. Emit `memory:updated` to the tenant's dashboard (fire-and-forget).
 *
 * NEVER throws — async callers (runMemoryCuratorAsync) rely on this to
 * swallow errors. Awaitable callers (tests, admin endpoints) get a
 * structured result.
 */
export async function runMemoryCurator(input: {
  tenantId: string
  conversationId: string
  customerId?: string
  perfil?: string
  turnTranscript: string
}): Promise<MemoryCuratorResult> {
  const start = Date.now()

  // Without a customerId we can't attach facts — skip (don't error).
  if (!input.customerId) {
    return { factsExtracted: 0, factsUpserted: 0, decisionSource: 'error', latencyMs: Date.now() - start }
  }

  // ── Build the curator prompt ────────────────────────────────────────
  const ctx: AgentContext = {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    customerId: input.customerId,
    perfil: input.perfil,
    message: input.turnTranscript,
  }

  let system: string
  let user: string
  try {
    const built = await buildMemoryCuratorPrompt(ctx)
    system = built.system
    user = built.user
  } catch (err) {
    captureError(err as Error, {
      agent: 'memory_curator',
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    })
    return { factsExtracted: 0, factsUpserted: 0, decisionSource: 'error', latencyMs: Date.now() - start }
  }

  // ── Call the LLM with a 10s timeout ─────────────────────────────────
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
        model: MEMORY_CURATOR_MODEL,
        thinking: 'disabled',
        temperature: 0,
        maxTokens: 1500,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Memory Curator LLM timeout')), MEMORY_CURATOR_TIMEOUT_MS),
      ),
    ])
    llmContent = llmResult.content ?? ''
    llmModel = llmResult.model
    llmProvider = llmResult.provider
    llmUsage = llmResult.usage
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log.warn(
      { err: errMsg, tenantId: input.tenantId, conversationId: input.conversationId },
      'Memory Curator LLM call failed — skipping extraction for this turn',
    )
    return {
      factsExtracted: 0,
      factsUpserted: 0,
      decisionSource: errMsg.includes('timeout') ? 'timeout' : 'error',
      latencyMs: Date.now() - start,
    }
  }

  // ── Parse the JSON output ───────────────────────────────────────────
  const parsed = parseAgentOutput<{ facts: ExtractedFact[] }>('memory_curator', llmContent)
  if (!parsed || !Array.isArray(parsed.facts)) {
    log.warn(
      { tenantId: input.tenantId, rawLen: llmContent.length, rawHead: llmContent.slice(0, 200) },
      'Memory Curator LLM output unparseable — skipping extraction',
    )
    return { factsExtracted: 0, factsUpserted: 0, decisionSource: 'error', latencyMs: Date.now() - start }
  }

  // ── De-duplicate + upsert each fact into CustomerMemory ─────────────
  let upserted = 0
  for (const fact of parsed.facts) {
    try {
      // Compute the embedding of `${key}: ${value}` for semantic recall.
      const vec = embed(`${fact.key}: ${fact.value}`)
      const embeddingBuf = Buffer.from(new Float32Array(vec).buffer)

      // Lookup by (tenantId, customerId, type, key) — the composite index
      // added in the Prisma schema makes this cheap.
      const existing = await db.customerMemory.findFirst({
        where: {
          tenantId: input.tenantId,
          customerId: input.customerId,
          type: fact.type,
          key: fact.key,
        },
        select: { id: true },
      })

      if (existing) {
        // Update in place — latest value is authoritative.
        await db.customerMemory.update({
          where: { id: existing.id },
          data: {
            value: fact.value,
            confidence: fact.confidence,
            extractedFrom: input.conversationId,
            embeddingTexto: embeddingBuf,
          },
        })
      } else {
        await db.customerMemory.create({
          data: {
            tenantId: input.tenantId,
            customerId: input.customerId,
            type: fact.type,
            key: fact.key,
            value: fact.value,
            confidence: fact.confidence,
            extractedFrom: input.conversationId,
            embeddingTexto: embeddingBuf,
          },
        })
      }
      upserted++
    } catch (err) {
      // Individual fact upsert failure shouldn't block the rest.
      log.warn(
        { err: err instanceof Error ? err.message : String(err), factKey: fact.key, factType: fact.type },
        'Memory Curator fact upsert failed (single fact, non-blocking)',
      )
    }
  }

  // ── Emit socket event + persist a DecisionLog summary (best-effort) ─
  emitToTenant(input.tenantId, 'memory:updated', {
    conversationId: input.conversationId,
    customerId: input.customerId,
    factsExtracted: parsed.facts.length,
    factsUpserted: upserted,
  })

  void persistCuratorDecisionLog(input, parsed.facts.length, upserted, {
    model: llmModel,
    provider: llmProvider,
    usage: llmUsage,
  }).catch(() => {})

  log.info(
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      customerId: input.customerId,
      factsExtracted: parsed.facts.length,
      factsUpserted: upserted,
      latencyMs: Date.now() - start,
    },
    'Memory Curator extraction complete',
  )

  return {
    factsExtracted: parsed.facts.length,
    factsUpserted: upserted,
    decisionSource: 'llm',
    latencyMs: Date.now() - start,
  }
}

/**
 * Persist a DecisionLog row summarizing the curator run (best-effort).
 * The `agentName` is 'memory_curator'. We log a SUMMARY (counts), not
 * each individual fact — individual facts live in CustomerMemory.
 */
async function persistCuratorDecisionLog(
  input: { tenantId: string; conversationId: string },
  factsExtracted: number,
  factsUpserted: number,
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
        agentName: 'memory_curator',
        conversationId: input.conversationId,
        input: JSON.stringify({ turnTranscriptLen: 0 }), // not persisted — too large
        output: JSON.stringify({
          factsExtracted,
          factsUpserted,
        }),
        reasoning: null,
        confidence: 0.8,
        model: llmMeta.model ?? null,
        provider: llmMeta.provider ?? null,
        promptTokens: llmMeta.usage?.promptTokens ?? null,
        completionTokens: llmMeta.usage?.completionTokens ?? null,
        totalTokens: llmMeta.usage?.totalTokens ?? null,
        costUsd: llmMeta.usage && llmMeta.provider
          ? calculateCost(llmMeta.provider, llmMeta.usage)
          : null,
      },
    })
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId: input.tenantId },
      'Memory Curator DecisionLog persist failed (non-blocking)',
    )
  }
}

/**
 * Semantic recall: find the most relevant CustomerMemory facts for a
 * given query text (e.g. the customer's latest message). Used by agent
 * prompts to inject "what we know about this customer that's relevant
 * to THIS question" into the system context.
 *
 * Uses the same `embed()` + cosine similarity as `searchSimilar` in
 * `src/lib/embeddings/service.ts`, but against the CustomerMemory table.
 *
 * In prod (PG + pgvector), replace this with a single SQL query:
 *   SELECT id, type, key, value, confidence, embedding <=> $1 AS score
 *   FROM customer_memory
 *   WHERE "tenantId" = $2 AND "customerId" = $3
 *   ORDER BY score LIMIT $4
 */
export async function recallCustomerMemory(input: {
  tenantId: string
  customerId: string
  query: string
  topK?: number
  minScore?: number
}): Promise<Array<{
  id: string
  type: string
  key: string
  value: string
  confidence: number
  score: number
}>> {
  const topK = input.topK ?? 5
  const minScore = input.minScore ?? 0.1
  const q = embed(input.query)

  // Load all facts for this customer (bounded by the index — typically
  // <50 facts per customer). In prod with pgvector, this becomes a
  // single indexed SQL query.
  const facts = await db.customerMemory.findMany({
    where: { tenantId: input.tenantId, customerId: input.customerId },
    select: { id: true, type: true, key: true, value: true, confidence: true, embeddingTexto: true },
  })

  const scored: Array<{ id: string; type: string; key: string; value: string; confidence: number; score: number }> = []
  for (const f of facts) {
    if (!f.embeddingTexto) continue
    const fv = bufferToVector(f.embeddingTexto)
    const score = cosineSimilarity(q, fv)
    if (score >= minScore) {
      scored.push({
        id: f.id,
        type: f.type,
        key: f.key,
        value: f.value,
        confidence: f.confidence,
        score,
      })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

// ── Helpers (mirrors of those in src/lib/embeddings/service.ts — kept
// local to avoid an extra export just for this service). ──────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function bufferToVector(buf: Uint8Array): number[] {
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(arr)
}
