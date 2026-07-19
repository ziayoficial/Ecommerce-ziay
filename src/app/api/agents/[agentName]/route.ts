import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess, requireAuth } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { buildAgentPrompt, AGENT_NAMES, AGENT_LABELS, AgentName } from '@/lib/agents/prompts'
// SPRINT-AI-LLM-ADAPTER-001 — reemplazo de la llamada directa al SDK de ZAI por el
// adapter pluggable. Resuelve el provider vía `tenant.proveedorIa` y
// unifica la superficie de llamada para los 4 providers (zai/openai/xai/ollama).
// IA-6A (Gap 1 + Gap 2) — `chat` ya no se invoca directamente en la
// ruta; `runToolLoopWithResilience` la llama internamente. Mantenemos
// el import del tipo `LLMChatResult` para tipar el resultado.
import { type LLMChatResult } from '@/lib/llm/adapter'
// FIX-AI-AGENTS-001 — defensas y validación de salida para los agentes ZIAY
// (20 agentes tras la consolidación IA-3 de v0.4.1).
import { parseAgentOutput, hasOutputSchema } from '@/lib/agents/schemas'
import { wrapUserInput, ANTI_INJECTION_PREFIX } from '@/lib/agents/sanitize'
// SPRINT-GUIA-COMPORTAMIENTO-001 — validación de reglas NUNCA en el output.
// Si el LLM viola una regla, se registra en DecisionLog y se baja la confidence.
import { validateOutput } from '@/lib/agents/rules'
// SPRINT-AI-AGENTS-003 §3 — check de presupuesto diario por tenant antes
// de la llamada LLM. Si el tenant excedió su budget, se rechaza con 429.
import { checkBudgetBeforeCall } from '@/lib/llm/budget'
import { emitToTenant } from '@/lib/chat-emit'
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapper funnels unhandled exceptions
// through Sentry + pino. The inner try/catch around the LLM call is
// preserved (it implements §A-3 fallback-reply + DecisionLog persistence
// + low_confidence emit — business logic, not boilerplate).
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
// SPRINT-HARDENING-FINAL-001 · §1 — sanitize the agent input context
// (tenantId, conversationId, message text, query string, etc.) before
// it reaches the LLM prompt + DB lookups. Strips null bytes that would
// break pino's JSON log formatter when `ctx` is logged for tracing.
import { sanitizeParsed } from '@/lib/middleware/sanitize'
// SPRINT-BACKEND-FINAL-001 — DB side-effects migrated to `agentsService`.
// The route keeps the LLM call, prompt building, output validation,
// confidence scoring + escalation; only the DB access patterns
// (tenant findUnique, conversation update, imageIdentification create,
// decisionLog create) live in the service.
import { agentsService } from '@/lib/services'
import { logger } from '@/lib/logger'
// IA-1 (agent-builder) — control-plane agents: Governor (safety/budget
// gate, runs FIRST on every message) + QA Reviewer (Reflexion
// critique+revise on revenue-critical agent outputs).
import { runGovernor } from '@/lib/agents/governor.service'
import { runQAReview, shouldReviewAgent } from '@/lib/agents/qa-reviewer.service'
// IA-4 — wire the IA-2 hardening layer into the real API routes (was dead
// code only used by src/lib/orchestrator/orchestrator.ts, which has 0
// consumers). Now every /api/agents/[agentName] call gets:
//   - getModelForAgent() → resolves the per-tier model (cheap/standard/frontier)
//     and passes it to the adapter (so the call actually uses the right GLM
//     variant instead of the adapter default).
//   - budgetManager.checkBudget() → pre-flight token+USD cap (in addition to
//     the legacy `checkBudgetBeforeCall` USD-only check; the new one covers
//     per-tenant daily/monthly token caps + per-conversation caps).
//   - agentTracer.startSpan() → opens a span around the LLM call; finalised
//     on success/error with token usage + cost + latency. Powers
//     /api/agents/traces (was returning [] because no route called it).
//   - budgetManager.recordUsage() → debits the in-memory counters + writes
//     a TokenUsage row (audit ledger). Powers /api/agents/budget (was
//     returning tokensUsed: 0 because no route called it).
// The wrapping is non-blocking: any error in the hardening layer is
// captured + logged, never breaks the agent reply (the customer's response
// is never delayed by observability).
import { agentTracer } from '@/lib/agents/tracing'
import { budgetManager } from '@/lib/agents/budget'
import { getModelForAgent, estimateCost } from '@/lib/agents/model-router'
// IA-5 — Tool Use registry + LLM ↔ tool-execution loop. When the agent
// has tools available (search_catalog, calculate_quote, etc.), they're
// injected into the LLM call as a system-prompt block; the LLM can
// emit tool_call blocks which `runToolLoop` parses + executes + feeds
// back to the LLM. Capped at 5 tool calls per turn.
// IA-6A (Gap 1 + Gap 2) — `runToolLoopWithResilience` wraps the tool
// loop with `withRetry` (Gap 1) for transient failures + a model
// fallback chain (Gap 2) for persistent primary-model failures.
import { toolRegistry, runToolLoopWithResilience } from '@/lib/agents/tools'
// IA-6A (Gap 3) — PII redactor applied to the final reply before
// returning. Catches hallucinated PII from other customers' data.
import { redactPII } from '@/lib/agents/pii-redactor'

// FIX-AI-AGENTS-001 §A-3 — tabla de fallbacks movida a module-scope para
// que sea accesible tanto del bloque try (cuando la validación de salida
// falla y queremos usar el fallback) como del catch (cuando la llamada
// LLM falla completamente). El contenido es idéntico al que estaba
// inline en el catch — se mantiene el comportamiento existente.
//
// v0.4.1 · IA-3: 8 agentes consolidados en 3 (postventa_logistics,
// scoring, address+catalog+quote enhanced). Tabla sincronizada con
// `FALLBACKS` en `src/lib/agents/prompts/index.ts`.
const AGENT_FALLBACKS: Record<AgentName, string> = {
  profile: '¿Para ti o para surtir tu negocio?',
  speech: '¡Hola! ¿Qué producto te interesa?',
  quote: '¿Qué productos y cantidades quieres cotizar?',
  catalog: '¿Qué tema o producto buscas?',
  objection: 'Entiendo. ¿Te confirmo el pedido?',
  address: '¿Cuál es tu ciudad y dirección completa?',
  logistics: '¿A qué ciudad enviamos y cuántas unidades?',
  vision: 'Por favor envíame una foto clara del producto para identificarlo.',
  checkout: '¿Confirmas el pedido?',
  buyer_behavior: 'Déjame revisar tu historial para recomendarte la mejor opción.',
  novedades: 'Tengo una novedad con tu envío, ¿me confirmas tu dirección actual?',
  redelivery: 'Para re-agendar la entrega, ¿qué horario te queda mejor?',
  remarketing: '¡Hola! Tengo una novedad que te puede interesar, ¿te acuerdo?',
  sales_retainer: 'Entiendo. ¿Te ofrezco pago contra entrega para que no pierdas el producto?',
  postventa_logistics: '¿Me compartes el número de guía o pedido para rastrearlo?',
  scoring: 'Calculando score…',
  product_enrichment: 'Enriqueciendo producto…',
  marketplace: 'Evaluando viabilidad de publicación en marketplace…',
  affiliator: 'Procesando atribución de afiliado…',
  traffic_orchestrator: 'Analizando redistribución de presupuesto…',
  // IA-1 (agent-builder) — 4 control-plane agents. Fallbacks are
  // conservative: governor/qa_reviewer fail-open (allow / pass-through),
  // memory_curator/sentiment return neutral placeholders.
  governor: '(permitido)',
  qa_reviewer: '(sin observaciones)',
  memory_curator: '(sin hechos nuevos para memorizar)',
  sentiment: 'neutral',
}

/**
 * FIX-AI-AGENTS-001 §A-3 — auto-escalación a revisión humana.
 *
 * Si `confidence < 0.6`, creamos un DecisionLog (ya creado por la ruta
 * con `humanReviewed: false` por defecto en el schema) Y emitimos un
 * evento `agent:low_confidence` al room del tenant para que cualquier
 * dashboard conectado por socket.io pueda notificar al agente humano.
 *
 * Fire-and-forget: si el chat-service está caído, la escalada sigue
 * registrada en DecisionLog y se vera en la UI de governance.
 */
function escalateLowConfidence(params: {
  tenantId: string
  agentName: string
  conversationId?: string
  confidence: number
  reply: string
  rawReply?: string
  error?: string
}): void {
  // Umbral < 0.6 cubre: call fallida (0.1), validación fallida (0.3).
  // Agentes de texto libre (0.6) y JSON validado (0.8) NO escalan.
  if (params.confidence >= 0.6) return
  emitToTenant(params.tenantId, 'agent:low_confidence', {
    agentName: params.agentName,
    conversationId: params.conversationId ?? null,
    confidence: params.confidence,
    reply: params.reply,
    rawReply: params.rawReply,
    error: params.error,
    // humanReviewed: false se persiste en DecisionLog con el valor default
    // del schema Prisma — la UI de governance filtra por este flag.
    humanReviewed: false,
  })
}

// SPRINT-GOVERNANCE-001 — pilar #4 "Trazabilidad de decisiones".
// La persistencia del DecisionLog ahora vive en `agentsService.persistDecisionLog`
// (SPRINT-BACKEND-FINAL-001). El wrapper local se eliminó — la firma del
// servicio es idéntica y el comportamiento non-blocking se conserva.
//
// POST /api/agents/[agentName]
// Body: AgentContext (tenantId required; conversationId/customerId/perfil/items/query/etc optional)
// Returns: { reply, agent, confidence, error? }
//
// SPRINT-BACKEND-FINAL-001 — DB side-effects (tenant findUnique, conversation
// update for profile detection, imageIdentification create for vision,
// decisionLog create) migrated to `agentsService`. The route keeps the LLM
// call, prompt building, output validation, confidence scoring + escalation.
//
// FIX-SECURITY-AUTH-001 (#30) — requireTenantAccess(ctx.tenantId). Any
// authed user used to be able to run any agent against any tenant (LLM
// cost + the `vision` agent side-effect writes to `ImageIdentification`
// on any tenant; the `profile` agent side-effect writes to
// `Conversation.perfilConversacion` on any tenant).
// SPRINT-ADOPT-ERRORHANDLER-001 — POST wrapped with `withErrorHandling`.
// The inner try/catch around the LLM call is preserved because its catch
// block implements §A-3 business logic (fallback reply + DecisionLog
// persistence + low_confidence emit + 200 response with `confidence: 0.1`),
// NOT generic 500 boilerplate. Errors thrown BEFORE that try (auth, rate
// limit, JSON parse, tenant gate, db lookup) bubble to the wrapper → Sentry.
export const POST = withErrorHandling(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ agentName: string }> },
  ) => {
  // FIX-REALTIME-WEBHOOKS-001 · P2 — per-route rate limit (10 req/min/IP).
  // Each call hits the LLM API ($0.01–0.10/call); the global 60/min/IP
  // middleware is too generous for an LLM endpoint.
  const limited = rateLimit(req, { max: 10, windowMs: 60_000, namespace: 'api:agents' })
  if (limited) return limited

  const { agentName } = await params
  if (!AGENT_NAMES.includes(agentName as AgentName)) {
    return NextResponse.json({ error: `Unknown agent. Valid: ${AGENT_NAMES.join(', ')}` }, { status: 400 })
  }
  // SPRINT-HARDENING-FINAL-001 §1 — sanitize the agent context BEFORE
  // the tenantId lookup + LLM call. The agent route doesn't use Zod
  // (the ctx shape varies per agent — see src/lib/agents/prompts/*), so
  // we sanitize the raw JSON instead. Strips null bytes + trims every
  // string field; caps arrays at 100 entries; drops __proto__ /
  // constructor / prototype keys (prototype-pollution defense).
  // Type stays `any` (matching the pre-sanitize behavior) so the
  // per-agent property accesses below (`ctx.tenantId`, `ctx.imageUrl`,
  // etc.) don't need casts at every usage site.
  const ctx = sanitizeParsed(await req.json())
  if (!ctx.tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  // FIX-SECURITY-AUTH-001 (#30) — tenant gate before the LLM call.
  const { error } = await requireTenantAccess(ctx.tenantId)
  if (error) return error

  // SPRINT-AI-AGENTS-003 §3 — verificar el presupuesto diario del tenant
  // antes de la llamada LLM. Si excedió el budget, devolvemos 429 para que
  // el cliente sepa que debe esperar al reset diario (o contactar al admin
  // para subir el budget vía /api/llm/budget).
  const budgetCheck = await checkBudgetBeforeCall(ctx.tenantId)
  if (!budgetCheck.allowed) {
    return NextResponse.json(
      { error: budgetCheck.message, code: 'BUDGET_EXCEEDED' },
      { status: 429 },
    )
  }

  // IA-4 — IA-2 hardening: resolve the per-agent model tier + pre-flight
  // the new token-level budget manager (covers per-conversation caps the
  // legacy `checkBudgetBeforeCall` doesn't). The new check runs alongside
  // the legacy one — both must allow the call. If the new check fails, we
  // return a 429 with a structured reason the Governor can surface to the
  // customer.
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
    // Fail-open: the legacy `checkBudgetBeforeCall` above already gated.
    // The new budget manager failing (DB down, etc.) must not block the
    // call — captured + logged.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId, agentName },
      'budgetManager.checkBudget failed (non-blocking, fail-open)',
    )
  }
  if (!tierBudgetAllowed) {
    return NextResponse.json(
      { error: tierBudgetReason || 'Token budget exceeded', code: 'BUDGET_EXCEEDED' },
      { status: 429 },
    )
  }

  // ── IA-1 (agent-builder) — Governor: safety/budget gate ──────────────
  // Runs FIRST on every inbound message, before the agent LLM call.
  // Checks for prompt injection, PII leaks, banned content. The governor
  // short-circuits with `allow: false` if it detects a policy violation —
  // the agent call is NOT made (saves tokens + prevents the violation
  // from reaching the customer).
  //
  // The governor evaluates `ctx.message` (the customer's input to the
  // agent). For agents that don't take a customer message (e.g. vision
  // takes `imageUrl`, catalog takes `query`), the governor is skipped —
  // there's no free-text customer input to gate.
  //
  // Skip the governor for the control-plane agents themselves
  // (governor, qa_reviewer, memory_curator, sentiment) — they don't
  // process customer messages directly.
  const CONTROL_PLANE_AGENTS = new Set(['governor', 'qa_reviewer', 'memory_curator', 'sentiment'])
  if (
    !CONTROL_PLANE_AGENTS.has(agentName) &&
    typeof ctx.message === 'string' &&
    ctx.message.length > 0 &&
    ctx.conversationId
  ) {
    const governorResult = await runGovernor({
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      message: ctx.message,
      customerId: ctx.customerId,
    })
    if (!governorResult.allow) {
      return NextResponse.json(
        { error: governorResult.reason || 'Mensaje bloqueado por el Gobernador', code: 'GOVERNOR_BLOCKED' },
        { status: 403 },
      )
    }
  }

  // IA-4 — open a tracing span around the LLM call. The span is finalised
  // in the try block (success) or the catch block (error/timeout) with
  // token usage + cost + latency. Non-blocking on observability failures.
  // Created AFTER the Governor check so a blocked message doesn't leave
  // an orphan span.
  const span = agentTracer.startSpan(agentName, ctx)
  span.setContext({ tenantId: ctx.tenantId, conversationId: ctx.conversationId })

  // Persist image identification result for vision agent (after the call)
  // (Done below if agentName === 'vision')

  // SPRINT-AI-LLM-ADAPTER-001 — capturamos el resultado del LLM fuera
  // del try para que, si una side-effect falla después de una llamada
  // exitosa, todavía podamos persistir el usage/costo en el catch.
  let llmResult: LLMChatResult | undefined
  const startTime = Date.now()

  try {
    const { system, user } = await buildAgentPrompt(agentName as AgentName, ctx)

    // SPRINT-AI-LLM-ADAPTER-001 — resolver el provider desde el tenant.
    // `tenant.proveedorIa` viene del schema Prisma (default 'zai').
    // Si el tenant no existe (caso edge), dejamos que el adapter use
    // `LLM_PROVIDER` env var o su default ('zai').
    // SPRINT-BACKEND-FINAL-001 — DB lookup migrated to `agentsService`.
    const tenant = await agentsService.getTenantLlmProvider(ctx.tenantId)

    // FIX-AI-AGENTS-001 §A-1: el system prompt va con rol `system`
    // (antes iba con rol `assistant` — el modelo lo trataba como una
    // respuesta previa suya y debilitaba los guardrails "Nunca inventes…",
    // habilitando prompt injection).
    //
    // FIX-AI-AGENTS-001 §A-4: se antepone `ANTI_INJECTION_PREFIX` al
    // system prompt (instrucciones anti-inyección en español) y se envuelve
    // el user prompt con `wrapUserInput()` para delimitar el contenido
    // del cliente con <user_message>…</user_message>.
    //
    // SPRINT-AI-LLM-ADAPTER-001 §A-3 (timeout): Promise.race con un
    // timeout de 15s. Si el LLM no responde a tiempo, se rechaza la
    // promesa y cae al catch (fallback deterministic por agente).
    // El adapter no soporta `signal` nativamente (cubre 4 providers con
    // APIs muy distintas), por eso usamos Promise.race en lugar de
    // AbortController.
    //
    // IA-5 (tool-use) — cuando el agente tiene tools disponibles
    // (toolRegistry.listForAgent(agentName) retorna >0), reemplazamos la
    // llamada directa al LLM por `runToolLoop()`. Esta función inyecta
    // un bloque "AVAILABLE TOOLS" en el system prompt, llama al LLM,
    // parsea bloques ```tool_call, los ejecuta vía `toolRegistry.execute()`
    // + alimenta los resultados de vuelta al LLM. Repite hasta que el
    // LLM produzca una respuesta sin tool calls (max 5 iteraciones).
    // Cuando no hay tools disponibles, runToolLoop short-circuits a una
    // sola llamada LLM (comportamiento idéntico al `chat()` directo).
    const agentTools = toolRegistry.listForAgent(agentName)
    let toolCallCount = 0
    // IA-6A (Gap 1 + Gap 2) — `runToolLoopWithResilience` wraps the
    // tool loop with `withRetry` (Gap 1) for transient failures + a
    // model fallback chain (Gap 2) for persistent primary-model
    // failures. The 15s per-attempt timeout is enforced INSIDE the
    // helper (no need for the outer Promise.race anymore).
    const toolLoopResult = await runToolLoopWithResilience({
      messages: [
        { role: 'system', content: ANTI_INJECTION_PREFIX + system },
        { role: 'user', content: wrapUserInput(user) },
      ],
      tools: agentTools,
      ctx: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        customerId: ctx.customerId,
        __agentName: agentName,
      },
      provider: tenant?.proveedorIa,
      primaryModel: tierInfo.model,
      timeoutMs: 15_000,
    })
    llmResult = toolLoopResult.llmResult
    toolCallCount = toolLoopResult.toolCallCount
    if (toolLoopResult.fellBack) {
      logger.warn(
        {
          agentName,
          tenantId: ctx.tenantId,
          primaryModel: tierInfo.model,
          actualModel: toolLoopResult.actualModel,
        },
        'LLM call used fallback model (primary failed after retries)',
      )
    }
    const reply = (llmResult.content || '').trim()

    // IA-4 — finalize the tracing span with token usage + cost + model
    // actually used by the adapter. Non-blocking: span.end() never throws
    // (it logs + persists fire-and-forget).
    const _tokensIn = llmResult.usage?.promptTokens ?? 0
    const _tokensOut = llmResult.usage?.completionTokens ?? 0
    const _costUsd = estimateCost(agentName, _tokensIn, _tokensOut)
    span.end(reply, {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      model: llmResult.model ?? tierInfo.model,
      tokensIn: _tokensIn,
      tokensOut: _tokensOut,
      costUsd: _costUsd,
      status: 'success',
    })
    // IA-4 — debit the new token-level budget ledger. Fire-and-forget on
    // the DB write (the in-memory counter is updated synchronously so
    // the very next checkBudget sees the new usage).
    budgetManager.recordUsage(
      ctx.tenantId,
      ctx.conversationId,
      _tokensIn,
      _tokensOut,
      _costUsd,
      agentName,
      llmResult.model ?? tierInfo.model,
      // IA-6B (Gap 7) — per-customer cost attribution.
      ctx.customerId,
    )

    // FIX-AI-AGENTS-001 §A-2: validar la salida contra el esquema Zod
    // del agente (si existe). 8 agentes tienen esquema (v0.4.1 · IA-3); los 12 restantes
    // son de texto libre y no se validan.
    const parsed = parseAgentOutput<unknown>(agentName, reply)
    const schemaExists = hasOutputSchema(agentName)

    // FIX-AI-AGENTS-001 §A-3: confidence real basada en validación.
    //   - 0.8: salida JSON validada contra esquema Zod.
    //   - 0.6: agente de texto libre (sin esquema) — no se puede validar.
    //   - 0.3: agente con esquema pero la salida no validó → fallback.
    //   - 0.1: la llamada LLM falló completamente (bloque catch).
    let confidence: number
    let finalReply = reply
    if (parsed) {
      confidence = 0.8 // JSON validado OK
    } else if (schemaExists) {
      // El agente debería devolver JSON válido pero no pasó la validación.
      // Usamos el fallback para no entregar al cliente un JSON roso/prose.
      confidence = 0.3
      finalReply = AGENT_FALLBACKS[agentName as AgentName]
    } else {
      // Agente de texto libre — no hay esquema, se entrega el reply tal cual.
      confidence = 0.6
    }

    // SPRINT-GUIA-COMPORTAMIENTO-001 — validar que el output cumple las
    // reglas NUNCA. Si hay violaciones, bajar confidence y registrar.
    const ruleViolations = validateOutput(finalReply)
    if (ruleViolations.length > 0) {
      // El LLM violó al menos una regla NUNCA — penalizar confidence
      confidence = Math.min(confidence, 0.4)
      logger.warn(
        { agentName, violations: ruleViolations.map(v => v.id), tenantId: ctx.tenantId },
        'Agent output violated NUNCA rules'
      )
    }

    // Side-effects per agent (preservados del comportamiento existente).
    // Para vision, el side-effect parsea el JSON del reply crudo (no del
    // Zod-validated parsed) porque los campos {sku, confianza, metodo}
    // no están en el VisionSchema de §A-2 — se mantiene la lógica original.
    // SPRINT-BACKEND-FINAL-001 — DB writes migrated to `agentsService`.
    if (agentName === 'profile') {
      // Try to detect the profile from the reply and persist on conversation
      const detected = ['mayorista', 'emprendedor', 'detal', 'regalo'].find(p => reply.toLowerCase().includes(p))
      if (detected && ctx.conversationId) {
        await agentsService.persistDetectedProfile(ctx.conversationId, detected)
      }
    }
    if (agentName === 'vision' && ctx.imageUrl && ctx.tenantId) {
      // Try to parse JSON from reply and persist as ImageIdentification
      try {
        const jsonMatch = reply.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsedVision = JSON.parse(jsonMatch[0])
          await agentsService.persistImageIdentification({
            tenantId: ctx.tenantId,
            customerId: ctx.customerId,
            imageUrl: ctx.imageUrl,
            skuDetectado: parsedVision.sku || null,
            metodo: parsedVision.metodo || 'vlm',
            confianza: parsedVision.confianza != null ? Number(parsedVision.confianza) : 0,
          })
        }
      } catch { /* non-JSON reply, skip persist */ }
    }

    // SPRINT-GOVERNANCE-001 — pilar #4: persistir la decisión del agente.
    // SPRINT-AI-LLM-ADAPTER-001 §A-6: persistimos también model/provider/
    // tokens/costo/latencia desde el resultado del adapter.
    // IA-5 (tool-use) — persistimos también el toolCallCount para que el
    // audit trail muestre "este agente usó N tools en este turno".
    await agentsService.persistDecisionLog({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      ctx,
      result: { reply: finalReply, confidence, error: undefined, toolCallCount },
      llmData: {
        model: llmResult.model,
        provider: llmResult.provider,
        usage: llmResult.usage,
        latencyMs: Date.now() - startTime,
      },
    })

    // FIX-AI-AGENTS-001 §A-3: auto-escalación si confidence < 0.6.
    // El DecisionLog ya quedó persistido con `humanReviewed: false`
    // (default del schema Prisma). Emitimos el evento al tenant room para
    // que cualquier dashboard conectado notifique al agente humano.
    escalateLowConfidence({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      confidence,
      reply: finalReply,
      rawReply: reply,
    })

    // ── IA-1 (agent-builder) — QA Reviewer on revenue-critical agents ──
    // After `quote`, `novedades`, `address`, `checkout` (and IA-6B Gap 8:
    // `objection`, `speech`, `logistics`, `scoring`) produce their output,
    // the QA Reviewer (Reflexion: critique → revise) runs to catch
    // hallucinations before they reach the customer. If the reviewer
    // returns `approved: false`, the `revisedOutput` replaces the original
    // `finalReply`. Best-effort: failure is logged but never blocks the
    // response.
    //
    // IA-6B (Gap 8) — confidence-threshold fast path: pass the route's
    // computed `confidence` so the QA Reviewer is SKIPPED when the output
    // is already high-confidence (schema-validated JSON, > 0.7). This
    // saves an 8s + frontier-model call on the common path; QA still
    // runs on the risky low-confidence path (free-text output, ≤ 0.7).
    let qaReviewed = false
    let qaIssues: string[] = []
    if (shouldReviewAgent(agentName, confidence)) {
      try {
        const qaResult = await runQAReview({
          tenantId: ctx.tenantId,
          agentName,
          agentOutput: finalReply,
          conversationContext: typeof ctx.message === 'string' ? ctx.message : '',
          conversationId: ctx.conversationId,
          customerId: ctx.customerId,
        })
        if (!qaResult.approved && qaResult.revisedOutput && qaResult.revisedOutput.length > 0) {
          finalReply = qaResult.revisedOutput
          qaReviewed = true
          qaIssues = qaResult.issues
          confidence = Math.max(confidence, 0.85)
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), agentName },
          'QA Reviewer failed (non-blocking) — using original reply',
        )
      }
    }

    // IA-6A (Gap 3) — PII redaction on the FINAL agent output (after
    // QA review, after rules validation, after side-effects). This is
    // the last step before returning to the caller — the redactor sees
    // the exact text the customer will receive.
    //
    // The agent route doesn't fetch the customer record (just IDs in
    // `ctx`), so the whitelist is empty — every PII match is redacted.
    // This is the safe default: a false-positive redaction (customer
    // sees [EMAIL] instead of their own email) is a minor UX issue,
    // while a false-negative (PII from ANOTHER customer reaching this
    // customer) is a privacy breach. The ai-reply route builds a proper
    // whitelist from its already-loaded `conv.customer` record.
    if (finalReply && finalReply.length > 0) {
      const redaction = redactPII(finalReply)
      if (redaction.hadRedactions) {
        logger.warn(
          {
            agentName,
            tenantId: ctx.tenantId,
            conversationId: ctx.conversationId,
            redactedTypes: redaction.found.map((f) => `${f.type}:${f.count}`).join(','),
            total: redaction.totalRedacted,
          },
          'PII redacted from agent output',
        )
        finalReply = redaction.redacted
      }
    }

    return NextResponse.json({
      reply: finalReply,
      agent: agentName,
      confidence,
      // IA-1 (agent-builder) — QA Review metadata for the caller.
      qaReviewed,
      qaIssues: qaIssues.length > 0 ? qaIssues : undefined,
      // IA-5 (tool-use) — surface the tool-call count so the caller can
      // see "this agent turn used 3 tool calls" for observability.
      toolCallCount,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    const fallbackReply = AGENT_FALLBACKS[agentName as AgentName]
    // FIX-AI-AGENTS-001 §A-3: la llamada LLM falló completamente → 0.1
    // (antes era 0.3 — pero 0.3 implica "teníamos un fallback y lo usamos",
    // mientras que 0.1 implica "nunca llegamos a tener output del modelo").
    // SPRINT-AI-LLM-ADAPTER-001 §A-3: incluye el caso de timeout (15s).
    const confidence = 0.1

    // IA-4 — finalize the tracing span as error/timeout. If the adapter
    // returned partial usage before the timeout, we still debit it so the
    // budget ledger stays honest. Most timeouts leave usage = undefined.
    const _errTokensIn = llmResult?.usage?.promptTokens ?? 0
    const _errTokensOut = llmResult?.usage?.completionTokens ?? 0
    const _errCostUsd = estimateCost(agentName, _errTokensIn, _errTokensOut)
    const _isTimeout = message.toLowerCase().includes('timeout')
    span.setError(message, _isTimeout ? 'timeout' : 'error')
    if (_errTokensIn > 0 || _errTokensOut > 0) {
      budgetManager.recordUsage(
        ctx.tenantId,
        ctx.conversationId,
        _errTokensIn,
        _errTokensOut,
        _errCostUsd,
        agentName,
        llmResult?.model ?? tierInfo.model,
        // IA-6B (Gap 7) — per-customer cost attribution (error path
        // still debits the partial tokens the LLM consumed before
        // timing out — keep the customer attribution honest).
        ctx.customerId,
      )
    }

    // SPRINT-GOVERNANCE-001 — pilar #4: persistir incluso los fallbacks
    // (la trazabilidad cubre los casos de error del agente).
    // Si el LLM respondió pero una side-effect falló, persistimos el
    // usage; si el LLM no respondió (timeout/error), usage queda en null.
    await agentsService.persistDecisionLog({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      ctx,
      result: { reply: fallbackReply, confidence, error: message },
      llmData: llmResult
        ? {
            model: llmResult.model,
            provider: llmResult.provider,
            usage: llmResult.usage,
            latencyMs: Date.now() - startTime,
          }
        : undefined,
    })

    // §A-3 auto-escalación: 0.1 < 0.6 → emitir evento.
    escalateLowConfidence({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      confidence,
      reply: fallbackReply,
      error: message,
    })

    return NextResponse.json({ reply: fallbackReply, agent: agentName, confidence, error: message })
  }
  },
)

// GET — list available agents with their labels
export const GET = withErrorHandling(async () => {
  const { error } = await requireAuth()
  if (error) return error
  return NextResponse.json({
    agents: AGENT_NAMES.map(name => ({ name, label: AGENT_LABELS[name] })),
  })
})
