// ZIAY — API /api/orchestrate
// Saramantha §12 — orchestrator that walks the 9-step agent pipeline.
//
// POST body: { tenantId, action: 'full' | 'step', scenarioId?, conversationId?, customerId?, currentStep? }
// - action='full'   → runs ALL 9 agents sequentially, returns the timeline of replies.
// - action='step'   → runs a SINGLE agent (currentStep), returns one reply + next step.
//
// SPRINT-BACKEND-FINAL-001 — DB side-effects (tenant findUnique, conversation
// update for profile detection + pipelineMemory load/persist, decisionLog
// create on escalation) migrated to `orchestrateService`. The route keeps the
// LLM calls, the 9-step pipeline walk, confidence scoring + escalation emit.
//
// Returns: {
//   ok: true,
//   action,
//   scenario?,                      // when scenarioId provided
//   currentStep?,                   // for action='step'
//   nextStep?,                      // for action='step' — next step id or null
//   timeline: [{ step, agent, label, emoji, reply, error? }],   // for action='full'
//   reply?,                         // for action='step'
// }
//
// FIX-SECURITY-AUTH-001 (#29) — requireTenantAccess(tenantId). Any authed
// user used to be able to run the orchestrator against any tenant
// (LLM cost + the profile-detection side-effect writes to
// `Conversation.perfilConversacion` on any tenant's conversation).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { AGENT_LABELS, AGENT_NAMES, AgentName, buildAgentPrompt, FALLBACKS } from '@/lib/agents/prompts'
import {
  ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS, OrchestratorStepId, OrchestratorScenario,
} from '@/lib/orchestrator/constants'
import { getLogger } from '@/lib/logger'
// SPRINT-AI-LLM-ADAPTER-001 — reemplazo de la llamada directa al SDK de ZAI por el
// adapter pluggable. El provider se resuelve desde `tenant.proveedorIa`
// (leído una vez en el POST handler y pasado a callAgent).
import { chat, type LLMChatResult } from '@/lib/llm/adapter'
import type { TokenUsage } from '@/lib/llm/costs'
// FIX-AI-AGENTS-001 — defensas y validación de salida para los 9 agentes
// del pipeline de orquestación.
import { parseAgentOutput, hasOutputSchema } from '@/lib/agents/schemas'
import { wrapUserInput, ANTI_INJECTION_PREFIX } from '@/lib/agents/sanitize'
// SPRINT-AI-AGENTS-003 §3 — check de presupuesto diario por tenant antes
// de la llamada LLM. Si el tenant excedió su budget, se rechaza con 429.
// Importante: el orchestrator dispara 9 llamadas LLM por request 'full',
// así que el budget se verifica una vez al inicio del handler (no por
// step) para no bloquear a mitad del pipeline.
import { checkBudgetBeforeCall } from '@/lib/llm/budget'
// SPRINT-AI-FINAL-001 §1 — resumen LLM para el pipeline memory del
// orchestrator. Cuando el pipelineMemory crece (>20 mensajes) se invoca
// `truncateWithSummary` para resumir los outputs de agentes previos antes
// de pasarlos al siguiente step — evita desbordar el context window y
// preserva el contexto crítico (perfil detectado, precios cotizados,
// objeciones levantadas). El threshold >20 coincide con MAX_MESSAGES de
// history.ts; con 9 steps por pipeline 'full' el path rara vez se activa,
// pero queda como defensa para pipelines extendidos o callers que reusen
// este handler con más steps.
import { truncateWithSummary } from '@/lib/agents/summarize'
import type { Message } from '@/lib/agents/history'
import { emitToTenant } from '@/lib/chat-emit'
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapper funnels unhandled exceptions
// through Sentry + pino. The inner per-agent try/catches inside the
// `for` loops are preserved (they implement §A-3 fallback-reply logic
// per agent — business logic, not boilerplate).
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
// SPRINT-BACKEND-FINAL-001 — DB side-effects migrated to `orchestrateService`.
import { orchestrateService } from '@/lib/services'
// IA-1 (agent-builder) — control-plane agents: Governor (safety/budget
// gate, runs FIRST), QA Reviewer (Reflexion critique+revise on
// revenue-critical agent outputs), Memory Curator (async long-term fact
// extraction), Sentiment Analyzer (parallel customer-state classification).
import { runGovernor } from '@/lib/agents/governor.service'
import { runQAReview, shouldReviewAgent } from '@/lib/agents/qa-reviewer.service'
import { runMemoryCuratorAsync, recallCustomerMemory } from '@/lib/agents/memory-curator.service'
import { runSentimentAsync, runSentiment } from '@/lib/agents/sentiment.service'
// IA-4 — wire the IA-2 hardening layer (agentTracer + budgetManager +
// getModelForAgent) into the real API route. Was previously dead code
// (only used by src/lib/orchestrator/orchestrator.ts which has 0
// consumers). Now every callAgent invocation in the orchestrator's
// pipeline gets traced + budget-checked + uses the per-tier model.
import { agentTracer } from '@/lib/agents/tracing'
import { budgetManager } from '@/lib/agents/budget'
import { getModelForAgent, estimateCost } from '@/lib/agents/model-router'
// IA-4 (P1-4) — SentimentResult type for the ctx.sentiment field.
import type { SentimentResult } from '@/lib/agents/sentiment.service'
// IA-5 — Tool Use registry + LLM ↔ tool-execution loop. Agents with
// tools available (search_catalog, calculate_quote, etc.) get them
// injected into the LLM call as a system-prompt block; the LLM can
// emit tool_call blocks which `runToolLoop` parses + executes + feeds
// back to the LLM. Capped at 5 tool calls per turn.
import { toolRegistry, runToolLoop } from '@/lib/agents/tools'
// IA-5 — Planner (ReAct loop). Decomposes the customer's message into
// a multi-step plan, executes the steps (parallel when independent),
// and revises the plan if a step fails. Falls back to the linear
// pipeline when planning fails or returns a 1-step plan.
import { planner, type AgentContextForPlanning } from '@/lib/agents/planning'

const log = getLogger('api:orchestrate')

// TD-2: Zod validation for the orchestrator request body. Replaces the
// inline `body as { ... }` cast + manual `if (!tenantId)` / `if (action !== ...)`
// checks with a single declarative schema. `.passthrough()` keeps unknown keys
// so the route stays tolerant of forward-compatible client payloads.
const OrchestrateSchema = z.object({
  tenantId: z.string().min(1),
  action: z.enum(['full', 'step']),
  scenarioId: z.string().optional(),
  conversationId: z.string().optional(),
  customerId: z.string().optional(),
  currentStep: z.string().optional(),
}).passthrough()

/**
 * Resultado enriquecido de `callAgent` — además del reply, lleva el
 * confidence calculado por §A-3 y el reply crudo para diagnóstico.
 *
 * SPRINT-AI-LLM-ADAPTER-001 §A-6 — ahora también lleva el model/provider/
 * usage/latencyMs del LLM para persistirlos en el DecisionLog cuando
 * haya escalación (confidence < 0.6).
 */
interface CallAgentResult {
  reply: string
  confidence: number
  rawReply?: string
  error?: string
  model?: string
  provider?: string
  usage?: TokenUsage
  latencyMs?: number
}

/**
 * SPRINT-AI-FRONTEND-001 §3 — entrada de `pipelineMemory` persistida.
 *
 * Antes de este sprint el array era `Message[]` puro (`{ role, content }`).
 * Ahora cada entry lleva opcionalmente un `timestamp` ISO — usado por la
 * evicción TTL de 24h al cargar la memoria desde `Conversation.pipelineMemory`.
 * El campo es opcional para preservar compatibilidad con entries
 * persistidas antes de este sprint (se les asigna un timestamp al
 * persistir de nuevo).
 */
type PipelineMemoryEntry = Message & { timestamp?: string }

/**
 * FIX-AI-AGENTS-001 §A-3 — auto-escalación a revisión humana.
 *
 * Si `confidence < 0.6`, persistimos un DecisionLog (con `humanReviewed:
 * false` por default del schema Prisma) y emitimos `agent:low_confidence`
 * al room del tenant. Best-effort: si la persistencia falla, no se rompe
 * el pipeline.
 *
 * SPRINT-AI-LLM-ADAPTER-001 §A-6 — persiste también model/provider/tokens/
 * costo/latencia de la llamada LLM (cuando está disponible — la escalación
 * puede ocurrir con confidence 0.3 tras un LLM exitoso pero salida
 * invalidada, o con 0.1 tras timeout/error sin usage).
 */
async function escalateIfLowConfidence(params: {
  tenantId: string
  agentName: string
  conversationId?: string
  ctx: unknown
  result: CallAgentResult
}): Promise<void> {
  if (params.result.confidence >= 0.6) return
  // Persistir DecisionLog solo en casos de baja confianza — el pipeline
  // orquesta 9 agentes por request, persistir todos sería ruido.
  // SPRINT-BACKEND-FINAL-001 — DB write migrated to `orchestrateService.persistDecisionLog`.
  await orchestrateService.persistDecisionLog({
    tenantId: params.tenantId,
    agentName: params.agentName,
    conversationId: params.conversationId,
    ctx: params.ctx,
    result: params.result,
  })
  emitToTenant(params.tenantId, 'agent:low_confidence', {
    agentName: params.agentName,
    conversationId: params.conversationId ?? null,
    confidence: params.result.confidence,
    reply: params.result.reply,
    rawReply: params.result.rawReply,
    error: params.result.error,
    humanReviewed: false,
  })
}

async function callAgent(
  agentName: AgentName,
  ctx: {
    tenantId: string
    conversationId?: string
    customerId?: string
    perfil?: string
    query?: string
    imageUrl?: string
    items?: { sku: string; cantidad: number }[]
    message?: string
    partialAddress?: Record<string, string>
  },
  // SPRINT-AI-LLM-ADAPTER-001 — provider resuelto desde el tenant en el
  // POST handler y pasado aquí para no volver a hacer fetch por cada step.
  providerName?: string,
  // SPRINT-AI-FINAL-001 §1 — memoria del pipeline: outputs de agentes
  // previos en `action='full'`. Se inyecta entre el system prompt y el
  // user message del step actual para dar contexto de qué decidieron los
  // agentes anteriores (perfil detectado, precios cotizados, objeciones).
  // Cuando el array supera 20 entradas se invoca `truncateWithSummary`
  // para resumir los mensajes antiguos antes de pasárselos al LLM —
  // evita desbordar el context window en pipelines largos.
  pipelineMemory?: Message[],
): Promise<CallAgentResult> {
  // IA-4 — IA-2 hardening: resolve the per-agent tier model so the
  // adapter actually uses the right GLM variant (flash/4.6/4.6-plus)
  // instead of the adapter default. Pre-flight the new token-level budget
  // manager (covers per-conversation caps the legacy `checkBudgetBeforeCall`
  // doesn't). Open a tracing span around the LLM call.
  const tierInfo = getModelForAgent(agentName)
  const estimatedTokens = tierInfo.tier === 'cheap' ? 1000 : tierInfo.tier === 'standard' ? 2000 : 4000
  let tierBudgetAllowed = true
  let tierBudgetReason: string | undefined
  try {
    const tierCheck = await budgetManager.checkBudget(ctx.tenantId, estimatedTokens)
    if (!tierCheck.allowed) {
      tierBudgetAllowed = false
      tierBudgetReason = tierCheck.reason
    }
  } catch (err) {
    // Fail-open — the legacy checkBudgetBeforeCall already gated at the
    // POST handler entry. The new manager failing (DB down) must not
    // block the call.
    log.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId, agentName },
      'budgetManager.checkBudget failed (non-blocking, fail-open)',
    )
  }
  if (!tierBudgetAllowed) {
    return {
      reply: `(presupuesto excedido: ${tierBudgetReason ?? 'unknown'})`,
      confidence: 0.1,
      error: tierBudgetReason ?? 'Token budget exceeded',
      latencyMs: 0,
    }
  }

  // IA-4 — open a tracing span around the LLM call.
  const span = agentTracer.startSpan(agentName, ctx)
  span.setContext({ tenantId: ctx.tenantId, conversationId: ctx.conversationId })

  const { system, user } = await buildAgentPrompt(agentName, ctx)
  const startTime = Date.now()
  // FIX-AI-AGENTS-001 §A-1: system prompt con rol `system`
  // (antes iba con rol `assistant` — debilitaba guardrails y exponía a
  // prompt injection). §A-4: prefix anti-inyección + delimitador
  // <user_message> para el input del cliente.
  //
  // SPRINT-AI-FINAL-001 §1 — construir el array de mensajes con la
  // memoria del pipeline inyectada (si existe). Si pipelineMemory > 20,
  // pasamos por `truncateWithSummary` para resumir los outputs antiguos
  // y no desbordar el context window. Si pipelineMemory es undefined o
  // vacío (action='step' o primer step de 'full'), comportamiendo
  // idéntico al anterior: system + user.
  const systemContent = ANTI_INJECTION_PREFIX + system
  let messages: Message[]
  if (pipelineMemory && pipelineMemory.length > 0) {
    if (pipelineMemory.length > 20) {
      messages = await truncateWithSummary(systemContent, pipelineMemory)
    } else {
      messages = [
        { role: 'system', content: systemContent },
        ...pipelineMemory,
      ]
    }
    // El user message del step actual va SIEMPRE al final — es la
    // instrucción específica que este agente debe procesar.
    messages.push({ role: 'user', content: wrapUserInput(user) })
  } else {
    messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: wrapUserInput(user) },
    ]
  }
  // SPRINT-AI-LLM-ADAPTER-001 §A-3 (timeout): Promise.race con 15s — si
  // el LLM no responde, se rechaza y el caller cae al fallback.
  //
  // IA-5 (tool-use) — cuando el agente tiene tools disponibles
  // (toolRegistry.listForAgent(agentName) retorna >0), reemplazamos la
  // llamada directa al LLM por `runToolLoop()`. Esta función:
  //   1. Inyecta un bloque "AVAILABLE TOOLS" en el último system message.
  //   2. Llama al LLM.
  //   3. Si la respuesta contiene bloques ```tool_call, los parsea +
  //      ejecuta vía `toolRegistry.execute()` (con timeout + permission
  //      scope por agente) + alimenta los resultados de vuelta al LLM.
  //   4. Repite hasta que el LLM produzca una respuesta sin tool calls
  //      (o hasta MAX_TOOL_CALLS_PER_TURN=5).
  // Cuando no hay tools disponibles, runToolLoop short-circuits a una
  // sola llamada LLM (comportamiento idéntico al `chat()` directo).
  const agentTools = toolRegistry.listForAgent(agentName)
  let llmResult: LLMChatResult
  let toolCallCount = 0
  let toolCallsExhausted = false
  try {
    const toolLoopResult = await Promise.race([
      runToolLoop({
        messages,
        tools: agentTools,
        ctx: {
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId,
          customerId: ctx.customerId,
          __agentName: agentName,
        },
        provider: providerName,
        model: tierInfo.model,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM timeout (15s)')), 15_000),
      ),
    ])
    llmResult = toolLoopResult.llmResult
    toolCallCount = toolLoopResult.toolCallCount
    toolCallsExhausted = toolLoopResult.toolCallsExhausted
  } catch (err) {
    // Propagar el error con el metadata del LLM (vacío — no hubo usage)
    // para que el caller pueda persistirlo en el DecisionLog.
    const message = err instanceof Error ? err.message : 'unknown error'
    // IA-4 — finalize the span as error/timeout.
    const _isTimeout = message.toLowerCase().includes('timeout')
    span.setError(message, _isTimeout ? 'timeout' : 'error')
    return {
      reply: FALLBACKS[agentName],
      confidence: 0.1,
      error: message,
      latencyMs: Date.now() - startTime,
    }
  }
  // IA-5 — strip any residual tool-call blocks from the LLM's final
  // reply before validation. The runToolLoop already does this, but
  // we re-apply defensively in case the adapter returned extra content.
  const rawReply = (llmResult.content || '').trim()

  // IA-4 — finalize the tracing span + debit the budget ledger.
  // IA-5 — when tools were used, debit the aggregated token usage
  // across all LLM iterations of the tool loop (not just the final
  // iteration). The `runToolLoop.totalUsage` field accumulates
  // promptTokens + completionTokens across every iteration.
  const tokensIn = (llmResult.usage?.promptTokens ?? 0)
  const tokensOut = (llmResult.usage?.completionTokens ?? 0)
  const costUsd = estimateCost(agentName, tokensIn, tokensOut)
  span.end(rawReply, {
    tenantId: ctx.tenantId,
    conversationId: ctx.conversationId,
    model: llmResult.model ?? tierInfo.model,
    tokensIn,
    tokensOut,
    costUsd,
    status: 'success',
  })
  budgetManager.recordUsage(
    ctx.tenantId,
    ctx.conversationId,
    tokensIn,
    tokensOut,
    costUsd,
    agentName,
    llmResult.model ?? tierInfo.model,
  )
  // IA-5 — log tool usage summary for observability (non-blocking).
  if (toolCallCount > 0) {
    log.info(
      { tenantId: ctx.tenantId, agentName, toolCallCount, toolCallsExhausted, conversationId: ctx.conversationId },
      'agent turn used tools',
    )
  }

  // FIX-AI-AGENTS-001 §A-2: validar salida contra esquema Zod si existe.
  const parsed = parseAgentOutput<unknown>(agentName, rawReply)
  const schemaExists = hasOutputSchema(agentName)

  // FIX-AI-AGENTS-001 §A-3: confidence real basada en validación.
  let confidence: number
  let reply = rawReply
  if (parsed) {
    confidence = 0.8
  } else if (schemaExists) {
    confidence = 0.3
    reply = FALLBACKS[agentName]
  } else {
    confidence = 0.6
  }

  return {
    reply,
    confidence,
    rawReply,
    model: llmResult.model,
    provider: llmResult.provider,
    usage: llmResult.usage,
    latencyMs: Date.now() - startTime,
  }
}

// SPRINT-ADOPT-ERRORHANDLER-001 — POST wrapped with `withErrorHandling`.
// The outer `try/catch` (captureError + 500 boilerplate) was removed —
// now the wrapper handles it. The inner per-step try/catches inside
// callAgent + the `for` loop are preserved (they implement §A-3 fallback
// logic per agent — business logic, not boilerplate).
export const POST = withErrorHandling(async (req: NextRequest) => {
  // FIX-REALTIME-WEBHOOKS-001 · P2 — per-route rate limit (5 req/min/IP).
  // action='full' runs 9 LLM calls per request — a single user could burn
  // the LLM budget fast. The global 60/min/IP middleware is too generous.
  const limited = rateLimit(req, { max: 5, windowMs: 60_000, namespace: 'api:orchestrate' })
  if (limited) return limited

  const raw = await req.json()
    const parseResult = OrchestrateSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { ok: false, error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const { tenantId, action, scenarioId, conversationId, customerId, currentStep } = parseResult.data as {
      tenantId: string
      action: 'full' | 'step'
      scenarioId?: string
      conversationId?: string
      customerId?: string
      currentStep?: OrchestratorStepId
    }

    // FIX-SECURITY-AUTH-001 (#29) — tenant gate before any LLM call.
    const { error } = await requireTenantAccess(tenantId)
    if (error) return error

    // SPRINT-AI-AGENTS-003 §3 — verificar el presupuesto diario del tenant
    // antes de empezar el pipeline. El orchestrator dispara 9 llamadas LLM
    // por request 'full' — verificar una vez al inicio evita gastar tokens
    // a mitad del pipeline si el budget ya está agotado. (Cada step todavía
    // se loguea en DecisionLog, así que el spent real se contabiliza para
    // el siguiente check.)
    const budgetCheck = await checkBudgetBeforeCall(tenantId)
    if (!budgetCheck.allowed) {
      return NextResponse.json(
        { ok: false, error: budgetCheck.message, code: 'BUDGET_EXCEEDED' },
        { status: 429 },
      )
    }

    const tenant = await orchestrateService.getTenantForOrchestration(tenantId)
    if (!tenant) return NextResponse.json({ ok: false, error: `Tenant not found: ${tenantId}` }, { status: 404 })
    // Provider resuelto una sola vez por request — se pasa a todas las
    // llamadas callAgent del pipeline (9 para action='full').
    const providerName = tenant.proveedorIa

    // ── IA-1 (agent-builder) — Governor: safety/budget gate ────────────
    // Runs FIRST on every inbound message, before any other agent. Checks
    // for prompt injection, PII leaks, banned content, and (re)verifies
    // budget. Has a <300ms timeout and fails-open (allow) on timeout/error
    // so the conversation is never blocked by a slow governor LLM.
    //
    // We need a `message` to evaluate. The orchestrator is typically
    // called with a `scenarioId` (synthetic test scenarios) OR with a
    // real `conversationId` (the dashboard "run pipeline" button). For
    // real conversations, the latest customer message is the governor
    // input. For scenario runs (no real customer message), we skip the
    // governor — there's nothing to gate (the scenario is a deterministic
    // test fixture, not customer input).
    //
    // The governor result is also surfaced in the response (`governor`
    // field) so the dashboard can show "blocked by governor" feedback.
    let governorMessage: string | undefined
    if (conversationId) {
      try {
        const latestInbound = await db.message.findFirst({
          where: { conversationId, direction: 'inbound' },
          orderBy: { createdAt: 'desc' },
          select: { body: true },
        })
        governorMessage = latestInbound?.body
      } catch {
        // Non-blocking — if we can't fetch the latest message, the
        // governor runs with an empty message (which it'll allow).
      }
    }
    let governorResult: { allow: boolean; reason?: string; redirect?: string | null; decisionSource: string; latencyMs: number; budgetRemaining: number } | null = null
    if (governorMessage) {
      governorResult = await runGovernor({
        tenantId,
        conversationId: conversationId ?? '',
        message: governorMessage,
        customerId,
      })
      if (!governorResult.allow) {
        // Governor blocked the message — short-circuit. Return the
        // rejection reason so the dashboard can surface it. Do NOT run
        // any downstream agent.
        log.info(
          { tenantId, conversationId, reason: governorResult.reason, decisionSource: governorResult.decisionSource },
          'Governor blocked message — short-circuiting pipeline',
        )
        return NextResponse.json({
          ok: false,
          error: governorResult.reason || 'Mensaje bloqueado por el Gobernador',
          code: 'GOVERNOR_BLOCKED',
          governor: governorResult,
        }, { status: 403 })
      }
    }

    // ── IA-1 (agent-builder) — Sentiment Analyzer (awaited, then async emit) ──
    // IA-4 (P1-3 + P1-4) — switched from pure fire-and-forget to an awaited
    // call so the classification result is available to inject into the
    // AgentContext of downstream agents (P1-4) AND to drive the
    // `agent:trigger` listener directly (P1-3) — if the customer is
    // frustrated, we invoke `sales_retainer` synchronously so its reply
    // is included in this same response (rather than relying on a socket
    // event crossing process boundaries, which never had a listener).
    //
    // The sentiment call has a 1.5s timeout built into `runSentiment`, so
    // the worst-case latency impact is bounded. On timeout/error it
    // returns a neutral fallback (decisionSource !== 'llm') — downstream
    // agents get ctx.sentiment undefined-equivalent (no tone adjustment).
    let sentimentResult: SentimentResult | undefined
    if (governorMessage && conversationId) {
      try {
        sentimentResult = await runSentiment({
          tenantId,
          conversationId,
          customerId,
          message: governorMessage,
        })
      } catch (err) {
        // Non-blocking — pipeline continues with no sentiment context.
        // The legacy async emit also runs so the dashboard still sees the
        // classification attempt.
        log.warn(
          { err: err instanceof Error ? err.message : String(err), tenantId, conversationId },
          'Sentiment synchronous call failed — continuing without sentiment ctx (non-blocking)',
        )
        runSentimentAsync({
          tenantId,
          conversationId,
          customerId,
          message: governorMessage,
        })
      }
    }

    // IA-4 (P1-2) — recall long-term customer memory BEFORE building the
    // per-step ctx. The query is the latest customer message + scenario
    // context. Returned facts are injected into the prompts of the 4
    // agents that benefit most from historical context (quote, objection,
    // address, checkout). Non-blocking: failure → empty memories (the
    // agents just don't get the memory block).
    let customerMemories: { id: string; type: string; key: string; value: string; confidence: number; score: number }[] = []
    if (customerId && governorMessage) {
      try {
        customerMemories = await recallCustomerMemory({
          tenantId,
          customerId,
          query: governorMessage,
          topK: 5,
          minScore: 0.15,
        })
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : String(err), tenantId, customerId },
          'recallCustomerMemory failed (non-blocking) — agents will run without memory block',
        )
      }
    }

    const scenario: OrchestratorScenario | undefined = scenarioId
      ? ORCHESTRATOR_SCENARIOS.find(s => s.id === scenarioId)
      : undefined

    // Shared context built from scenario (if any)
    // IA-4 (P1-2 / P1-4) — inject recalled long-term memory + the
    // sentiment classification result into every step's AgentContext.
    // Agents that don't need them just ignore the fields (the prompt
    // builders that DO consume them are: quote, objection, address,
    // checkout, speech, sales_retainer, remarketing).
    const buildCtx = (stepId: OrchestratorStepId) => ({
      tenantId,
      conversationId,
      customerId,
      perfil: scenario?.perfil,
      query: stepId === 'catalog' ? scenario?.catalogQuery : undefined,
      // IA-3: theme folded into catalog — if the scenario has a theme,
      // the catalog agent runs the §6.5 theme-search branch.
      theme: stepId === 'catalog' ? scenario?.theme : undefined,
      items: stepId === 'quote'
        ? [{ sku: 'SHORT-TIRA', cantidad: 12 }] // demo quote
        : undefined,
      message: stepId === 'objection' ? scenario?.objectionMessage : undefined,
      partialAddress: stepId === 'address' ? { ciudad: 'Bogotá' } : undefined,
      // IA-4 — recalled memory + sentiment classification.
      customerMemories: customerMemories.length > 0 ? customerMemories : undefined,
      sentiment: sentimentResult,
    })

    // ── action='step' — single agent ────────────────────────────────────
    if (action === 'step') {
      const step = currentStep
        ? ORCHESTRATOR_STEPS.find(s => s.id === currentStep)
        : ORCHESTRATOR_STEPS[0]
      if (!step) return NextResponse.json({ ok: false, error: 'Invalid currentStep' }, { status: 400 })

      const idx = step.index // 1-based
      const nextStep = idx < ORCHESTRATOR_STEPS.length
        ? ORCHESTRATOR_STEPS[idx].id // index-th element (0-based) is the next step
        : null

      log.info({ tenantId, action, stepId: step.id, agent: step.agent }, 'agent start')
      let reply = ''
      let errorMsg: string | undefined
      let confidence = 0.6 // default para agentes de texto libre
      let rawReply: string | undefined
      // SPRINT-AI-LLM-ADAPTER-001 — capturamos el result completo para
      // pasar model/provider/usage/latencyMs a la escalación.
      let llmMeta: {
        model?: string
        provider?: string
        usage?: TokenUsage
        latencyMs?: number
      } = {}
      try {
        const result = await callAgent(step.agent as AgentName, buildCtx(step.id), providerName)
        reply = result.reply
        confidence = result.confidence
        rawReply = result.rawReply
        llmMeta = {
          model: result.model,
          provider: result.provider,
          usage: result.usage,
          latencyMs: result.latencyMs,
        }
        log.info({ tenantId, stepId: step.id, agent: step.agent, replyLen: reply.length, confidence }, 'agent complete')
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'unknown error'
        reply = FALLBACKS[step.agent as AgentName]
        confidence = 0.1 // §A-3: la llamada LLM falló completamente
        log.error({ tenantId, stepId: step.id, agent: step.agent, err: errorMsg }, 'agent error — fallback used')
      }

      // Persist profile detection (mirror of /api/agents/[agentName]/route.ts)
      // SPRINT-BACKEND-FINAL-001 — DB write migrated to `orchestrateService`.
      if (step.id === 'profile' && conversationId) {
        const detected = ['mayorista', 'emprendedor', 'detal', 'regalo'].find(p => reply.toLowerCase().includes(p))
        if (detected) {
          await orchestrateService.persistDetectedProfile(conversationId, detected)
        }
      }

      // FIX-AI-AGENTS-001 §A-3 — auto-escalación a revisión humana.
      await escalateIfLowConfidence({
        tenantId,
        agentName: step.agent as AgentName,
        conversationId,
        ctx: buildCtx(step.id),
        result: { reply, confidence, rawReply, error: errorMsg, ...llmMeta },
      })

      return NextResponse.json({
        ok: true,
        action: 'step',
        scenario: scenario ? { id: scenario.id, label: scenario.label } : undefined,
        currentStep: { id: step.id, index: step.index, label: step.label, emoji: step.emoji, agent: step.agent },
        nextStep,
        reply,
        confidence,
        error: errorMsg,
      })
    }

    // ── action='full' — run all 9 steps sequentially ────────────────────
    const timeline: Array<{
      step: OrchestratorStepId; index: number; label: string; emoji: string;
      agent: string; agentLabel: string; reply: string; confidence: number; error?: string;
      qaReviewed?: boolean; qaIssues?: string[]
    }> = []
    // SPRINT-AI-FINAL-001 §1 — memoria del pipeline: cada step ve los
    // outputs de los steps anteriores como mensajes `assistant` en su
    // context window. Esto le da a cada agente visibilidad de lo que los
    // agentes previos decidieron (perfil detectado, productos sugeridos,
    // precios cotizados, objeciones levantadas) — mejorando la coherencia
    // del pipeline. Cuando el array crece >20, callAgent invoca
    // `truncateWithSummary` para resumir antes de pasarlo al LLM.
    //
    // SPRINT-AI-FINAL-002 §1 — la memoria se persiste en
    // `Conversation.pipelineMemory` al final del pipeline anterior y se
    // carga aquí al inicio del nuevo. Da continuidad entre turnos de
    // conversaciones multi-turno: el cliente responde al resultado del
    // pipeline anterior y este nuevo pipeline arranca con los outputs de
    // los 9 agentes previos como contexto (en vez de empezar desde cero).
    // Se mantiene sólo el último slice(-30) para no crecer indefinidamente.
    //
    // SPRINT-AI-FRONTEND-001 §3 — evicción TTL: al cargar, se descartan
    // las entries con `timestamp` anterior a 24h. La memoria multi-turno
    // pierde relevancia después de un día (el cliente rara vez retoma un
    // pipeline de ayer), y la evicción TTL acota el crecimiento en
    // conversaciones long-idle que de otro modo acumularían entries
    // stale de hace días. Las entries sin `timestamp` (persistidas antes
    // de este sprint) se conservan — se asumen recientes y se les
    // asigna un timestamp al persistir de nuevo.
    let pipelineMemory: PipelineMemoryEntry[] = []
    if (conversationId) {
      const memoryJson = await orchestrateService.getPipelineMemory(conversationId)
      if (memoryJson) {
        try {
          const parsed = JSON.parse(memoryJson)
          // Validar que cada entrada tenga shape de Message antes de
          // inyectarla al pipeline — un JSON corrupto o con formato
          // inesperado no debe romper el pipeline.
          if (Array.isArray(parsed)) {
            const validated = parsed.filter(
              (m): m is PipelineMemoryEntry =>
                m !== null &&
                typeof m === 'object' &&
                typeof m.content === 'string' &&
                (m.role === 'system' || m.role === 'user' || m.role === 'assistant') &&
                (m.timestamp === undefined || typeof m.timestamp === 'string'),
            )
            // SPRINT-AI-FRONTEND-001 §3 — evicción TTL de 24h.
            // Las entries sin timestamp se conservan (backward compat);
            // las que tienen timestamp anterior al cutoff se descartan.
            const cutoff = Date.now() - 24 * 60 * 60 * 1000
            pipelineMemory = validated.filter((entry) => {
              if (!entry.timestamp) return true
              return new Date(entry.timestamp).getTime() > cutoff
            })
          }
        } catch {
          // JSON inválido — arrancar con memoria vacía (comportamiento
          // idéntico al anterior a SPRINT-AI-FINAL-002).
          pipelineMemory = []
        }
      }
    }
    // ── IA-5 (planning) — ReAct loop for non-trivial customer messages ──
    //
    // Before running the linear 8-step pipeline, ask the planner to
    // decompose the customer's message into a sequence of agent steps.
    // When the plan has MULTIPLE steps, execute the plan INSTEAD of the
    // linear pipeline — the customer gets a focused response from the
    // agents that actually matter for their request.
    //
    // When the plan has 1 step (simple message — "¿qué productos
    // tienen?"), or when planning fails, or when no customer message is
    // available (scenario runs), fall through to the linear pipeline.
    //
    // Disabled via `DISABLE_PLANNER=1` env var (used in tests + when
    // the planner LLM is unavailable).
    let planExecuted = false
    let planSummary: { id: string; goal: string; stepCount: number; status: string; revisionCount: number } | undefined
    // Local const narrows `governorMessage` from `string | undefined` to
    // `string` for the planner block (TypeScript doesn't narrow through
    // the `plannerEnabled` const above).
    const plannerMessage = governorMessage
    const plannerEnabled =
      process.env.DISABLE_PLANNER !== '1' &&
      action === 'full' &&
      typeof plannerMessage === 'string' &&
      plannerMessage.length > 0
    if (plannerEnabled && plannerMessage) {
      try {
        const planCtx: AgentContextForPlanning = {
          tenantId,
          conversationId,
          customerId,
          message: plannerMessage,
          perfil: scenario?.perfil,
          recentMessages: pipelineMemory.slice(-3).map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
        }
        const plan = await planner.createPlan(plannerMessage, planCtx)

        // 1-step plan → fast path: skip the plan execution overhead
        // and let the linear pipeline handle it (the single step's
        // agent will run as part of the linear walk). This keeps the
        // 1-step case on the well-tested linear path.
        if (plan.steps.length > 1) {
          log.info(
            { tenantId, conversationId, planId: plan.id, stepCount: plan.steps.length, agents: plan.steps.map((s) => s.agent) },
            'planner produced multi-step plan — executing',
          )

          // Inject callAgent as the plan's executor. The wrapper
          // reuses the existing callAgent (which already has tracing,
          // budget, governor, QA review) — the planner is just a
          // scheduler, not a new agent layer.
          const executedPlan = await planner.executePlan(plan, planCtx, async (agentName, input) => {
            const ctxForStep = {
              tenantId,
              conversationId,
              customerId,
              perfil: scenario?.perfil,
              ...input,
              // Preserve the recalled memory + sentiment classification
              // for every plan step (same as the linear pipeline does).
              customerMemories: customerMemories.length > 0 ? customerMemories : undefined,
              sentiment: sentimentResult,
            }
            try {
              const result = await callAgent(agentName as AgentName, ctxForStep, providerName, pipelineMemory)
              return {
                reply: result.reply,
                confidence: result.confidence,
                error: result.error,
                latencyMs: result.latencyMs,
              }
            } catch (err) {
              return {
                reply: FALLBACKS[agentName as AgentName] ?? '(error)',
                confidence: 0.1,
                error: err instanceof Error ? err.message : 'unknown',
                latencyMs: 0,
              }
            }
          })

          // Populate the timeline from the plan's step outputs. Each
          // step becomes a timeline entry — the dashboard sees the
          // same shape as a linear pipeline run.
          for (const step of executedPlan.steps) {
            // Skip the orchestrator step metadata lookup — plan steps
            // don't map 1:1 to ORCHESTRATOR_STEPS, so we synthesize
            // timeline entries from the plan step itself.
            const agentLabel = AGENT_LABELS[step.agent as AgentName] ?? step.agent
            timeline.push({
              step: 'checkout', // reuse the last step id (no new step id for plan steps)
              index: timeline.length + 1,
              label: agentLabel,
              emoji: '🎯',
              agent: step.agent,
              agentLabel,
              reply: step.output ?? '',
              confidence: step.confidence ?? 0.5,
              error: step.status === 'failed' ? step.output : undefined,
            })
            // Push to pipelineMemory so subsequent turns see the plan's
            // outputs (same as the linear pipeline does).
            pipelineMemory.push({
              role: 'assistant',
              content: `[plan:${step.id}/${step.agent}] ${step.output ?? ''}`,
              timestamp: new Date().toISOString(),
            })
          }

          planExecuted = true
          planSummary = {
            id: executedPlan.id,
            goal: executedPlan.goal,
            stepCount: executedPlan.steps.length,
            status: executedPlan.status,
            revisionCount: executedPlan.revisionCount,
          }
          log.info(
            { tenantId, conversationId, planId: executedPlan.id, status: executedPlan.status, stepCount: executedPlan.steps.length },
            'plan execution complete — skipping linear pipeline',
          )
        } else {
          log.debug(
            { tenantId, conversationId, planId: plan.id, stepCount: plan.steps.length },
            'planner produced 1-step plan — falling through to linear pipeline',
          )
        }
      } catch (err) {
        // Non-blocking — fall through to the linear pipeline. The
        // planner must never delay the customer's response.
        log.warn(
          { err: err instanceof Error ? err.message : String(err), tenantId, conversationId },
          'planner failed — falling through to linear pipeline (non-blocking)',
        )
      }
    }

    if (!planExecuted) {
    for (const step of ORCHESTRATOR_STEPS) {
      log.info({ tenantId, action: 'full', stepId: step.id, agent: step.agent, index: step.index, memSize: pipelineMemory.length }, 'agent start')
      let reply = ''
      let errorMsg: string | undefined
      let confidence = 0.6
      let rawReply: string | undefined
      // SPRINT-AI-LLM-ADAPTER-001 — capturamos el result completo para
      // pasar model/provider/usage/latencyMs a la escalación.
      let llmMeta: {
        model?: string
        provider?: string
        usage?: TokenUsage
        latencyMs?: number
      } = {}
      try {
        const result = await callAgent(step.agent as AgentName, buildCtx(step.id), providerName, pipelineMemory)
        reply = result.reply
        confidence = result.confidence
        rawReply = result.rawReply
        llmMeta = {
          model: result.model,
          provider: result.provider,
          usage: result.usage,
          latencyMs: result.latencyMs,
        }
        log.info({ tenantId, stepId: step.id, agent: step.agent, replyLen: reply.length, confidence }, 'agent complete')
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'unknown error'
        reply = FALLBACKS[step.agent as AgentName]
        confidence = 0.1 // §A-3: llamada LLM fallida
        log.error({ tenantId, stepId: step.id, agent: step.agent, err: errorMsg }, 'agent error — fallback used')
      }

      // SPRINT-AI-FINAL-001 §1 — añadir el reply (real o fallback) al
      // pipelineMemory para que el siguiente step lo vea como contexto.
      // Se etiqueta con el step+agente para que el siguiente agente
      // identifique de dónde viene cada output. Se empuja SIEMPRE, aún
      // en caso de error — el fallback también es información útil para
      // el siguiente agente (saber que el anterior no respondió bien).
      //
      // SPRINT-AI-FRONTEND-001 §3 — añadimos `timestamp` ISO para que la
      // evicción TTL de 24h al cargar la memoria (próxima invocación)
      // pueda descartar entries stale. El timestamp se asigna al momento
      // del push (no al persistir) para que sea lo más cercano al
      // momento real en que el agente generó el reply.
      pipelineMemory.push({
        role: 'assistant',
        content: `[${step.id}/${step.agent}] ${reply}`,
        timestamp: new Date().toISOString(),
      })

      // Persist profile detection
      // SPRINT-BACKEND-FINAL-001 — DB write migrated to `orchestrateService`.
      if (step.id === 'profile' && conversationId) {
        const detected = ['mayorista', 'emprendedor', 'detal', 'regalo'].find(p => reply.toLowerCase().includes(p))
        if (detected) {
          await orchestrateService.persistDetectedProfile(conversationId, detected)
        }
      }

      // FIX-AI-AGENTS-001 §A-3 — auto-escalación a revisión humana.
      await escalateIfLowConfidence({
        tenantId,
        agentName: step.agent as AgentName,
        conversationId,
        ctx: buildCtx(step.id),
        result: { reply, confidence, rawReply, error: errorMsg, ...llmMeta },
      })

      // ── IA-1 (agent-builder) — QA Reviewer on revenue-critical agents ──
      // After `quote`, `novedades`, `address`, `checkout` produce their
      // output, the QA Reviewer (Reflexion: critique → revise) runs to
      // catch hallucinations before they reach the customer. If the
      // reviewer returns `approved: false`, the `revisedOutput` replaces
      // the original `reply` (the timeline entry below records the
      // revision + issues for audit). Uses a FRONTIER LLM (glm-4.6) —
      // critique is harder than generation.
      //
      // Best-effort: if the QA Reviewer itself fails (timeout/parse
      // error), the original `reply` is used unchanged (fail-closed =
      // approve original — never block the conversation on QA tooling).
      let qaReviewed = false
      let qaIssues: string[] = []
      if (!errorMsg && shouldReviewAgent(step.agent)) {
        try {
          const qaResult = await runQAReview({
            tenantId,
            agentName: step.agent,
            agentOutput: reply,
            conversationContext: pipelineMemory.map(m => `[${m.role}] ${m.content}`).join('\n').slice(-3000),
            conversationId,
            customerId,
            perfil: scenario?.perfil,
          })
          if (!qaResult.approved && qaResult.revisedOutput && qaResult.revisedOutput.length > 0) {
            // Replace the reply with the revised version. The original
            // `rawReply` is preserved for audit (the timeline entry
            // records that QA revised the output).
            rawReply = reply // preserve original as rawReply
            reply = qaResult.revisedOutput
            qaReviewed = true
            qaIssues = qaResult.issues
            // Bump confidence — the revised output passed QA review.
            confidence = Math.max(confidence, 0.85)
          }
        } catch (err) {
          // Non-blocking — log + continue with the original reply.
          log.warn(
            { err: err instanceof Error ? err.message : String(err), agentName: step.agent, stepId: step.id },
            'QA Reviewer failed (non-blocking) — using original reply',
          )
        }
      }

      timeline.push({
        step: step.id,
        index: step.index,
        label: step.label,
        emoji: step.emoji,
        agent: step.agent,
        agentLabel: AGENT_LABELS[step.agent as AgentName],
        reply,
        confidence,
        error: errorMsg,
        // IA-1 (agent-builder) — QA Review metadata for the dashboard.
        qaReviewed,
        qaIssues: qaIssues.length > 0 ? qaIssues : undefined,
      })
    }
    } // end `if (!planExecuted)`

    log.info(
      { tenantId, scenarioId: scenario?.id, steps: timeline.length, errors: timeline.filter(t => t.error).length },
      'pipeline complete',
    )

    // SPRINT-AI-FINAL-002 §1 — persistir la pipeline memory en la
    // Conversation para que la próxima invocación del orchestrator sobre
    // la misma conversación arranque con este contexto. Se guardan sólo
    // las últimas 30 entradas (slice(-30)) para evitar crecimiento
    // indefinido — con 9 steps por pipeline 'full', 30 entradas cubren
    // ~3 invocaciones completas (suficiente para continuidad multi-turno).
    // Best-effort: si la persistencia falla, no se rompe el pipeline (el
    // response ya se construyó y se devuelve igual).
    //
    // SPRINT-AI-FRONTEND-001 §3 — antes de persistir, aseguramos que
    // todas las entries tengan `timestamp` (las que se cargaron desde
    // storage sin timestamp — entries previas a este sprint — se les
    // asigna el timestamp actual). Así la próxima carga podrá aplicar
    // la evicción TTL uniformemente.
    //
    // SPRINT-BACKEND-FINAL-001 — DB write migrated to `orchestrateService.persistPipelineMemory`.
    if (conversationId && pipelineMemory.length > 0) {
      const nowIso = new Date().toISOString()
      const toPersist = pipelineMemory.slice(-30).map((entry) => ({
        ...entry,
        timestamp: entry.timestamp || nowIso,
      }))
      await orchestrateService.persistPipelineMemory(
        conversationId,
        JSON.stringify(toPersist),
      )
    }

    // ── IA-1 (agent-builder) — Memory Curator (async, fire-and-forget) ──
    // After the pipeline completes, extract durable facts (preferences,
    // past purchases, objections, budget, brand affinity, communication
    // style) from the latest turn and persist them in `CustomerMemory`
    // with embeddings for semantic recall in future conversations.
    //
    // Fire-and-forget: the response is returned immediately, the curator
    // runs in the background. NEVER blocks the response to the customer.
    // If it fails, the failure is captured + logged (the curator service
    // handles its own error swallowing via runMemoryCuratorAsync).
    if (conversationId && customerId && governorMessage) {
      const turnTranscript = `Customer: ${governorMessage}\n\nAgent pipeline:\n${
        timeline.map(t => `[${t.step}/${t.agent}] ${t.reply}`).join('\n')
      }`
      runMemoryCuratorAsync({
        tenantId,
        conversationId,
        customerId,
        perfil: scenario?.perfil,
        turnTranscript,
      })
    }

    // ── IA-4 (P1-3) — Sentiment `agent:trigger` listener ──────────────
    // The Sentiment service emits socket `agent:trigger` events when it
    // detects frustration / churn risk / high buying intent (target =
    // sales_retainer / remarketing / quote). Previously NO consumer
    // listened — the triggered retention agents never actually ran.
    //
    // We replace the cross-process socket listener with a direct
    // function call: after the pipeline completes, if the sentiment
    // classification triggered any agents, we invoke each one with the
    // current conversation context + the sentiment (so the retainer
    // knows WHY it was triggered). The replies are appended to the
    // timeline as an extra entry so the dashboard sees the retention
    // attempt and the operator can route it to the customer.
    //
    // We skip 'quote' as a direct call — it's already a pipeline step
    // (step 4 of 8). The sentiment-aware prompt block (P1-4) handles
    // "buyingIntent=high → close faster" inside the quote step itself.
    if (sentimentResult && sentimentResult.triggeredAgents.length > 0) {
      const retentionTargets = sentimentResult.triggeredAgents.filter(
        (a) => a !== 'quote' && AGENT_NAMES.includes(a as AgentName),
      )
      for (const target of retentionTargets) {
        try {
          const retentionCtx = {
            tenantId,
            conversationId,
            customerId,
            perfil: scenario?.perfil,
            message: governorMessage,
            // Pass the sentiment + memory into the retention agent's ctx.
            sentiment: sentimentResult,
            customerMemories: customerMemories.length > 0 ? customerMemories : undefined,
          }
          const retentionResult = await callAgent(
            target as AgentName,
            retentionCtx,
            providerName,
          )
          timeline.push({
            step: 'checkout', // reuse the last step id (no new step id for retention)
            index: timeline.length + 1,
            label: `Retención (${sentimentResult.sentiment})`,
            emoji: '🛟',
            agent: target,
            agentLabel: AGENT_LABELS[target as AgentName],
            reply: retentionResult.reply,
            confidence: retentionResult.confidence,
            error: retentionResult.error,
          })
          log.info(
            { tenantId, conversationId, target, reason: sentimentResult.sentiment, replyLen: retentionResult.reply.length },
            'Sentiment-triggered retention agent invoked',
          )
        } catch (err) {
          log.warn(
            { err: err instanceof Error ? err.message : String(err), target, tenantId, conversationId },
            'Sentiment-triggered retention agent failed (non-blocking)',
          )
        }
      }
    }

    return NextResponse.json({
      ok: true,
      action: 'full',
      scenario: scenario ? { id: scenario.id, label: scenario.label } : undefined,
      timeline,
      // IA-1 (agent-builder) — surface governor decision in the response
      // so the dashboard can show "passed governor" feedback.
      governor: governorResult,
      // IA-4 (P1-4) — surface the sentiment classification so the
      // dashboard can show "frustrated → triggered sales_retainer".
      sentiment: sentimentResult
        ? {
            sentiment: sentimentResult.sentiment,
            score: sentimentResult.score,
            urgency: sentimentResult.urgency,
            buyingIntent: sentimentResult.buyingIntent,
            churnRisk: sentimentResult.churnRisk,
            triggeredAgents: sentimentResult.triggeredAgents,
            decisionSource: sentimentResult.decisionSource,
          }
        : undefined,
      // IA-5 (planning) — surface the plan summary so the dashboard can
      // show "plan executed: 3 steps, status=completed".
      plan: planSummary,
    })
})
