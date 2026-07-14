// ZIAY — API /api/orchestrate
// Saramantha §12 — orchestrator that walks the 9-step agent pipeline.
//
// POST body: { tenantId, action: 'full' | 'step', scenarioId?, conversationId?, customerId?, currentStep? }
// - action='full'   → runs ALL 9 agents sequentially, returns the timeline of replies.
// - action='step'   → runs a SINGLE agent (currentStep), returns one reply + next step.
//
// SPRINT8-SERVICES-REST-001 — left inline. The db calls here are:
//   1. `db.tenant.findUnique` — single tenant existence check.
//   2. `db.conversation.update` — profile-detection side-effect, runs at
//      most once per pipeline invocation.
// Per rule #2 (1-2 simple db calls OK to leave), the orchestration flow
// is dominated by LLM calls (9 per pipeline), not db calls.
// TODO: migrate to service layer if more db writes get added per step.
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
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { db } from '@/lib/db'
import { AGENT_LABELS, AgentName, buildAgentPrompt, FALLBACKS } from '@/lib/agents/prompts'
import {
  ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS, OrchestratorStepId, OrchestratorScenario,
} from '@/lib/orchestrator/constants'
import { getLogger } from '@/lib/logger'
// SPRINT-AI-LLM-ADAPTER-001 — reemplazo de la llamada directa al SDK de ZAI por el
// adapter pluggable. El provider se resuelve desde `tenant.proveedorIa`
// (leído una vez en el POST handler y pasado a callAgent).
import { chat, type LLMChatResult } from '@/lib/llm/adapter'
import { calculateCost, type TokenUsage } from '@/lib/llm/costs'
// FIX-AI-AGENTS-001 — defensas y validación de salida para los 9 agentes
// del pipeline de orquestación.
import { parseAgentOutput, hasOutputSchema } from '@/lib/agents/schemas'
import { wrapUserInput, ANTI_INJECTION_PREFIX } from '@/lib/agents/sanitize'
import { emitToTenant } from '@/lib/chat-emit'
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapper funnels unhandled exceptions
// through Sentry + pino. The inner per-agent try/catches inside the
// `for` loops are preserved (they implement §A-3 fallback-reply logic
// per agent — business logic, not boilerplate).
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

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
  try {
    const usage = params.result.usage
    await db.decisionLog.create({
      data: {
        tenantId: params.tenantId,
        agentName: params.agentName,
        conversationId: params.conversationId ?? null,
        input: JSON.stringify(params.ctx),
        output: JSON.stringify({
          reply: params.result.reply,
          confidence: params.result.confidence,
          error: params.result.error ?? null,
        }),
        reasoning: null,
        confidence: params.result.confidence,
        // humanReviewed: false (default del schema Prisma).
        // §A-6: tracking de tokens/costo/latencia.
        model: params.result.model ?? null,
        provider: params.result.provider ?? null,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        costUsd: usage
          ? calculateCost(params.result.provider ?? 'zai', usage)
          : null,
        latencyMs: params.result.latencyMs ?? null,
      },
    })
  } catch (err) {
    log.warn(
      { err, agentName: params.agentName, tenantId: params.tenantId },
      'No se pudo persistir DecisionLog en escalación (non-blocking)',
    )
  }
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
): Promise<CallAgentResult> {
  const { system, user } = await buildAgentPrompt(agentName, ctx)
  const startTime = Date.now()
  // FIX-AI-AGENTS-001 §A-1: system prompt con rol `system`
  // (antes iba con rol `assistant` — debilitaba guardrails y exponía a
  // prompt injection). §A-4: prefix anti-inyección + delimitador
  // <user_message> para el input del cliente.
  //
  // SPRINT-AI-LLM-ADAPTER-001 §A-3 (timeout): Promise.race con 15s — si
  // el LLM no responde, se rechaza y el caller cae al fallback.
  let llmResult: LLMChatResult
  try {
    llmResult = await Promise.race([
      chat(
        [
          { role: 'system', content: ANTI_INJECTION_PREFIX + system },
          { role: 'user', content: wrapUserInput(user) },
        ],
        {
          provider: providerName,
          thinking: 'disabled',
        },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM timeout (15s)')), 15_000),
      ),
    ])
  } catch (err) {
    // Propagar el error con el metadata del LLM (vacío — no hubo usage)
    // para que el caller pueda persistirlo en el DecisionLog.
    const message = err instanceof Error ? err.message : 'unknown error'
    return {
      reply: FALLBACKS[agentName],
      confidence: 0.1,
      error: message,
      latencyMs: Date.now() - startTime,
    }
  }
  const rawReply = llmResult.content.trim() || ''

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

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      // SPRINT-AI-LLM-ADAPTER-001 — sólo necesitamos proveedorIa para
      // resolver el LLM provider. El check de existencia (`if (!tenant)`)
      // sigue funcionando con un select parcial.
      select: { id: true, proveedorIa: true },
    })
    if (!tenant) return NextResponse.json({ ok: false, error: `Tenant not found: ${tenantId}` }, { status: 404 })
    // Provider resuelto una sola vez por request — se pasa a todas las
    // llamadas callAgent del pipeline (9 para action='full').
    const providerName = tenant.proveedorIa

    const scenario: OrchestratorScenario | undefined = scenarioId
      ? ORCHESTRATOR_SCENARIOS.find(s => s.id === scenarioId)
      : undefined

    // Shared context built from scenario (if any)
    const buildCtx = (stepId: OrchestratorStepId) => ({
      tenantId,
      conversationId,
      customerId,
      perfil: scenario?.perfil,
      query: stepId === 'catalog' ? scenario?.catalogQuery : undefined,
      items: stepId === 'quote'
        ? [{ sku: 'SHORT-TIRA', cantidad: 12 }] // demo quote
        : undefined,
      message: stepId === 'objection' ? scenario?.objectionMessage : undefined,
      partialAddress: stepId === 'address' ? { ciudad: 'Bogotá' } : undefined,
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
      if (step.id === 'profile' && conversationId) {
        const detected = ['mayorista', 'emprendedor', 'detal', 'regalo'].find(p => reply.toLowerCase().includes(p))
        if (detected) {
          try {
            await db.conversation.update({ where: { id: conversationId }, data: { perfilConversacion: detected } })
          } catch { /* ignore */ }
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
      agent: string; agentLabel: string; reply: string; confidence: number; error?: string
    }> = []
    for (const step of ORCHESTRATOR_STEPS) {
      log.info({ tenantId, action: 'full', stepId: step.id, agent: step.agent, index: step.index }, 'agent start')
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
        confidence = 0.1 // §A-3: llamada LLM fallida
        log.error({ tenantId, stepId: step.id, agent: step.agent, err: errorMsg }, 'agent error — fallback used')
      }

      // Persist profile detection
      if (step.id === 'profile' && conversationId) {
        const detected = ['mayorista', 'emprendedor', 'detal', 'regalo'].find(p => reply.toLowerCase().includes(p))
        if (detected) {
          try {
            await db.conversation.update({ where: { id: conversationId }, data: { perfilConversacion: detected } })
          } catch { /* ignore */ }
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
      })
    }

    log.info(
      { tenantId, scenarioId: scenario?.id, steps: timeline.length, errors: timeline.filter(t => t.error).length },
      'pipeline complete',
    )
    return NextResponse.json({
      ok: true,
      action: 'full',
      scenario: scenario ? { id: scenario.id, label: scenario.label } : undefined,
      timeline,
    })
})
