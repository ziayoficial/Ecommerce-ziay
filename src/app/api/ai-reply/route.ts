import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
// SPRINT-AI-LLM-ADAPTER-001 — reemplazo de la llamada directa al SDK de ZAI por el
// adapter pluggable. Provider resuelto desde `tenant.proveedorIa`.
import { chat, type LLMChatResult } from '@/lib/llm/adapter'
// SPRINT-AI-LLM-ADAPTER-001 §A-7 — truncado del historial para prevenir
// desbordamiento del context window en conversaciones largas.
import { truncateHistory, type Message } from '@/lib/agents/history'
// SPRINT-AI-AGENTS-003 §1 — resumen LLM para conversaciones largas (>20
// mensajes). truncateHistory (simple) sigue siendo el default para
// conversaciones cortas (ahorra una llamada LLM extra).
import { truncateWithSummary } from '@/lib/agents/summarize'
// FIX-AI-AGENTS-001 — defensas anti-inyección + confidence real.
import { wrapUserInput, ANTI_INJECTION_PREFIX } from '@/lib/agents/sanitize'
// SPRINT-AI-AGENTS-003 §3 — check de presupuesto diario por tenant antes
// de la llamada LLM. Si el tenant excedió su budget, se rechaza con 429.
import { checkBudgetBeforeCall } from '@/lib/llm/budget'
import { emitToTenant } from '@/lib/chat-emit'
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapper funnels unhandled exceptions
// through Sentry + pino. The inner try/catch around the LLM call is
// preserved (it implements the §A-3 fallback-reply + DecisionLog
// persistence + low_confidence emit — business logic, not boilerplate).
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
// SPRINT-HARDENING-FINAL-001 · §1 — sanitize conversationId + tone
// before they reach the DB lookup + the LLM system prompt. Strips
// null bytes (log-injection) + trims whitespace (DB lookup miss).
import { sanitizeParsed } from '@/lib/middleware/sanitize'
// SPRINT-BACKEND-FINAL-001 — DB access migrated to the service layer.
// `conversationService` owns the LLM-context reads (conversation,
// tenant provider, catalog slice); `agentsService` owns the
// DecisionLog persistence (shared with /api/agents/[agentName]).
import { conversationService, agentsService } from '@/lib/services'
// IA-1 (agent-builder) — control-plane agents: Governor (safety/budget
// gate, runs FIRST), Sentiment Analyzer (parallel classification),
// Memory Curator (async long-term fact extraction).
import { runGovernor } from '@/lib/agents/governor.service'
import { runSentimentAsync, runSentiment } from '@/lib/agents/sentiment.service'
import { runMemoryCuratorAsync, recallCustomerMemory } from '@/lib/agents/memory-curator.service'
// IA-4 — wire the IA-2 hardening layer into the real API route. Was
// previously dead code (only used by src/lib/orchestrator/orchestrator.ts
// which has 0 consumers). Now every /api/ai-reply call gets:
//   - getModelForAgent('ai_reply') → uses the 'standard' tier default
//     (ai_reply isn't in AGENT_MODEL_TIER; the router falls back to
//     'standard' = glm-4.6, which matches the adapter default for ZAI).
//   - budgetManager.checkBudget() pre-flight + recordUsage() post-call.
//   - agentTracer.startSpan() around the LLM call.
import { agentTracer } from '@/lib/agents/tracing'
import { budgetManager } from '@/lib/agents/budget'
import { getModelForAgent, estimateCost } from '@/lib/agents/model-router'
// IA-5 — Tool Use registry + LLM ↔ tool-execution loop. The ai-reply
// route is the most general agent endpoint (used by the WhatsApp
// webhook + dashboard reply box). When the implicit 'ai_reply' agent
// has tools available, runToolLoop injects them into the LLM call.
// Note: 'ai_reply' isn't in TOOL_PERMISSIONS today, so listForAgent
// returns 0 tools → runToolLoop short-circuits to a single LLM call.
// The wiring is in place so future tools added with allowedAgents
// including 'ai_reply' light up automatically.
// IA-6A (Gap 1 + Gap 2) — `runToolLoopWithResilience` wraps the tool
// loop with `withRetry` (Gap 1) for transient failures + a model
// fallback chain (Gap 2) for persistent primary-model failures.
import { toolRegistry, runToolLoopWithResilience } from '@/lib/agents/tools'
// IA-6A (Gap 3) — PII redactor applied to the final reply before
// returning. Whitelists the current customer's own PII (already loaded
// in `conv.customer`) so the agent can echo back the customer's email
// without it being masked — while still catching PII from OTHER
// customers that may leak via CustomerMemory recall.
import { redactPII, buildCustomerWhitelist } from '@/lib/agents/pii-redactor'
// IA-4 (P1-2 / P1-3 / P1-4) — agent prompt builders + schemas for the
// sentiment-triggered retention agent invocation (sales_retainer /
// remarketing). The retention agent is invoked AFTER the reply is
// generated, fire-and-forget, so the customer's reply is never delayed.
import { AGENT_NAMES, AgentName, buildAgentPrompt, FALLBACKS } from '@/lib/agents/prompts'
import { getLogger } from '@/lib/logger'

const log = getLogger('api:ai-reply')

// TD-2: Zod schema for ai-reply POST.
const AiReplySchema = z.object({
  conversationId: z.string().min(1),
  tone: z.string().optional(),
}).passthrough()

// IA-4 (P1-4) — stashed sentiment result on the conversation object so
// the system prompt builder + the post-reply retention invoker can read
// it without plumbing a separate variable through every helper.
type ConvWithSentiment = {
  _sentiment?: {
    sentiment: string
    score: number
    urgency: string
    buyingIntent: string
    churnRisk: string
    decisionSource: string
    triggeredAgents: string[]
  }
}

// POST /api/ai-reply
// Generates context-aware sales replies using the LLM skill.
// Uses conversation history + channel payment strategy + catalog context.
//
// SPRINT-BACKEND-FINAL-001 — DB access migrated to the service layer.
// `conversationService` owns the LLM-context reads (conversation,
// tenant provider, catalog slice); `agentsService` owns the DecisionLog
// persistence (shared with /api/agents/[agentName]). The route keeps
// the LLM call, prompt building, confidence scoring + escalation emit.
//
// FIX-SECURITY-AUTH-001 (#11) — fetch the conversation, verify tenant
// ownership before the LLM call. Any authed user used to be able to feed
// any tenant's customer PII + message history into the LLM (cross-tenant
// PII exfiltration via the LLM response).
// SPRINT-ADOPT-ERRORHANDLER-001 — POST wrapped with `withErrorHandling`.
// The inner try/catch around the LLM call is preserved because its catch
// block implements §A-3 business logic (fallback reply + DecisionLog
// persistence + low_confidence emit + 200 response with `confidence: 0.1`),
// NOT generic 500 boilerplate. Errors thrown BEFORE that try (auth, rate
// limit, JSON parse, tenant gate, db lookup) bubble to the wrapper → Sentry.
/**
 * POST /api/ai-reply
 *
 * Generate an AI draft reply for a conversation message.
 *
 * @security Requires authentication + tenant access
 * @returns AI-generated draft reply text
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  // FIX-REALTIME-WEBHOOKS-001 · P2 — per-route rate limit (10 req/min/IP).
  // Each call hits the LLM API ($0.01–0.10/call); the global 60/min/IP
  // middleware is too generous for an LLM endpoint.
  const limited = rateLimit(req, { max: 10, windowMs: 60_000, namespace: 'api:ai-reply' })
  if (limited) return limited

  const raw = await req.json()
  const parseResult = AiReplySchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validación fallida', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  // SPRINT-HARDENING-FINAL-001 §1 — strip null bytes + trim AFTER Zod.
  // The conversationId is used in the db.conversation.findUnique lookup
  // (whitespace / null bytes would 404 the request); the tone is
  // interpolated into the LLM system prompt (null bytes would break
  // pino's JSON log formatter when the prompt is logged for tracing).
  const { conversationId, tone = 'friendly' } = sanitizeParsed(parseResult.data) as {
    conversationId: string
    tone?: string
  }

  const conv = await conversationService.getConversationContextForAiReply(conversationId)
  if (!conv) return NextResponse.json({ error: 'conversation not found' }, { status: 404 })

  // FIX-SECURITY-AUTH-001 (#11) — tenant gate before the LLM gets fed PII.
  const { error } = await requireTenantAccess(conv.tenantId)
  if (error) return error

  // SPRINT-AI-AGENTS-003 §3 — verificar el presupuesto diario del tenant
  // antes de la llamada LLM. Si excedió el budget, devolvemos 429 para que
  // el cliente sepa que debe esperar al reset diario (o contactar al admin
  // para subir el budget vía /api/llm/budget).
  const budgetCheck = await checkBudgetBeforeCall(conv.tenantId)
  if (!budgetCheck.allowed) {
    return NextResponse.json(
      { error: budgetCheck.message, code: 'BUDGET_EXCEEDED' },
      { status: 429 },
    )
  }

  // ── IA-1 (agent-builder) — Governor: safety/budget gate ──────────────
  // Runs FIRST on every inbound message, before the LLM generates a reply.
  // Checks for prompt injection, PII leaks, banned content. Has a <300ms
  // timeout and fails-open (allow) on timeout/error so the conversation
  // is never blocked by a slow governor LLM.
  //
  // The latest customer message is fetched from the conversation history
  // (the dashboard's "AI reply" button generates a reply for the latest
  // inbound). If the governor blocks, return 403 with the reason — the
  // dashboard surfaces it to the agent.
  let latestCustomerMessage = ''
  try {
    const latestInbound = await db.message.findFirst({
      where: { conversationId, direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    })
    latestCustomerMessage = latestInbound?.body ?? ''
  } catch {
    // Non-blocking — if we can't fetch the latest message, the governor
    // runs with an empty message (which it'll allow).
  }
  if (latestCustomerMessage) {
    const governorResult = await runGovernor({
      tenantId: conv.tenantId,
      conversationId,
      message: latestCustomerMessage,
      customerId: conv.customerId,
    })
    if (!governorResult.allow) {
      return NextResponse.json(
        { error: governorResult.reason || 'Mensaje bloqueado por el Gobernador', code: 'GOVERNOR_BLOCKED' },
        { status: 403 },
      )
    }
    // ── IA-4 (P1-3 / P1-4) — Sentiment Analyzer (awaited) ─────────────
    // Switched from fire-and-forget to an awaited call so the classification
    // result is available to (a) adapt the reply's tone via the system
    // prompt below (P1-4) and (b) drive the retention-agent trigger
    // directly after the reply is generated (P1-3 — previously the
    // `agent:trigger` socket event had no listener).
    //
    // The sentiment call has a 1.5s timeout built into `runSentiment`,
    // so the worst-case latency impact is bounded. On timeout/error it
    // returns a neutral fallback — the reply continues with no tone
    // adjustment and no retention trigger.
    try {
      const sentiment = await runSentiment({
        tenantId: conv.tenantId,
        conversationId,
        customerId: conv.customerId,
        message: latestCustomerMessage,
      })
      // Stash on the request-scoped `conv` object so the system prompt
      // builder + the post-reply retention invoker can read it.
      ;(conv as ConvWithSentiment)._sentiment = sentiment
    } catch (err) {
      // Non-blocking — fall back to the legacy async emit so the
      // dashboard still sees the classification attempt.
      log.warn(
        { err: err instanceof Error ? err.message : String(err), conversationId },
        'Sentiment synchronous call failed — continuing without sentiment ctx (non-blocking)',
      )
      runSentimentAsync({
        tenantId: conv.tenantId,
        conversationId,
        customerId: conv.customerId,
        message: latestCustomerMessage,
      })
    }
  }

  // IA-4 (P1-2) — recall long-term customer memory (past purchases,
  // preferences, objections) so the reply can reference "lo que ya
  // sabemos" instead of asking the customer again. Non-blocking: failure
  // → empty memories (the system prompt just doesn't get the memory block).
  let customerMemories: { id: string; type: string; key: string; value: string; confidence: number; score: number }[] = []
  if (conv.customerId && latestCustomerMessage) {
    try {
      customerMemories = await recallCustomerMemory({
        tenantId: conv.tenantId,
        customerId: conv.customerId,
        query: latestCustomerMessage,
        topK: 5,
        minScore: 0.15,
      })
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), tenantId: conv.tenantId, customerId: conv.customerId },
        'recallCustomerMemory failed (non-blocking) — reply will run without memory block',
      )
    }
  }

  // Build context for the model
  // SPRINT-BACKEND-FINAL-001 — DB read migrated to `conversationService.getCatalogContext`.
  const products = await conversationService.getCatalogContext(conv.tenantId, 8)
  const catalog = products.map(p => `- ${p.name} ($${p.price.toLocaleString('es-CO')} COP, sku ${p.sku})`).join('\n')

  const strategyText = (() => {
    switch (conv.channel.paymentStrategy) {
      case 'advance':
        return `Este canal exige PAGO ANTICIPADO. Ofrece ${conv.channel.prepayDiscountPct || 0}% de descuento por pago anticipado y envía link de pago del carrito.`
      case 'cod':
        return `Este canal opera solo CONTRA ENTREGA. Costo de envío contra entrega: $${conv.channel.codFee || 0}. Confirma dirección y ciudad antes de cerrar.`
      case 'hybrid':
      default:
        return `Este canal es HÍBRIDO. Para pedidos > $${conv.channel.requirePrepayMin || 0} recomienda pago anticipado (${conv.channel.prepayDiscountPct || 0}% off). Para pedidos menores permite contra entrega (recargo $${conv.channel.codFee || 0}).`
    }
  })()

  // SPRINT-AI-LLM-ADAPTER-001 §A-7 — el historial ahora se construye
  // como Message[] (role+content) más abajo, para pasarlo por
  // truncateHistory. La variable `history` (string único) se removió.

  // SPRINT-AI-LLM-ADAPTER-001 — resolver el provider desde el tenant.
  // Reutilizamos el tenantId del conversation (ya cargado con customer/channel).
  // SPRINT-BACKEND-FINAL-001 — DB read migrated to `conversationService.getTenantLlmProvider`.
  const tenant = await conversationService.getTenantLlmProvider(conv.tenantId)

  // IA-4 (P1-2 / P1-4) — inject recalled memory + sentiment tone
  // adjustment into the system prompt. The memory block references
  // "lo que ya sabemos del cliente" so the reply doesn't re-ask. The
  // sentiment block nudges the tone (frustrated → empathetic, high
  // buyingIntent → close).
  const memoryBlock = customerMemories.length > 0
    ? '\n\nContexto conocido del cliente (recuperado de memoria a largo plazo — úsalo SI es relevante, NO lo repitas textualmente al cliente):\n' +
      customerMemories.slice(0, 8).map((m) => {
        const v = m.value.length > 200 ? m.value.slice(0, 200) + '…' : m.value
        return `- ${m.type} · ${m.key}: ${v} (confianza ${m.confidence.toFixed(2)})`
      }).join('\n')
    : ''
  const sentiment = (conv as ConvWithSentiment)._sentiment
  const sentimentBlock = (() => {
    if (!sentiment || sentiment.decisionSource !== 'llm') return ''
    const parts: string[] = []
    if (sentiment.sentiment === 'frustrated') parts.push('El cliente parece frustrado — usa un tono calmado y empático, reconoce su molestia antes de responder.')
    if (sentiment.sentiment === 'excited') parts.push('El cliente está entusiasmado — refuerza la energía y avanza rápido hacia el cierre.')
    if (sentiment.urgency === 'high') parts.push('El cliente muestra urgencia — responde sin demora y prioriza la información esencial.')
    if (sentiment.buyingIntent === 'high') parts.push('El cliente muestra fuerte intención de compra — mueve la conversación hacia el cierre (cantidades, dirección, pago).')
    if (sentiment.churnRisk === 'high') parts.push('El cliente podría estar por abandonar — ofrece un incentivo de retención (contra entrega, bono pequeño).')
    if (parts.length === 0) return ''
    return '\n\nAjuste de tono según sentimiento detectado:\n' + parts.map((p) => `- ${p}`).join('\n')
  })()

  const systemPrompt = `Eres un asistente de ventas conversacional experto para una tienda de belleza y cuidado personal en Colombia (y expansión internacional).
Canal: ${conv.channel.displayName} (${conv.channel.type}).
Estrategia de pago del canal: ${strategyText}
Cliente: ${conv.customer.name} (${conv.customer.country || 'N/A'}, ${conv.customer.city || ''}).
Contexto de atribución: ${conv.sourceCampaign ? 'vino por campaña "' + conv.sourceCampaign + '"' : 'orgánico'}.

Catálogo disponible:
${catalog}

Tono: ${tone}, cálido, cercano (estilo LATAM), emojis moderados. Máximo 2 mensajes cortos. Cierra hacia la venta: confirma producto, cantidad, modo de pago y dirección. NO inventes precios fuera del catálogo. Si el cliente pregunta por contra entrega y el canal es solo 'advance', explica amablemente que ese canal requiere pago anticipado pero ofrece descuento.${memoryBlock}${sentimentBlock}`

  // SPRINT-AI-LLM-ADAPTER-001 §A-7 — convertir el historial a formato
  // Message[] (role+content) y truncar para preservar el context window.
  //
  // SPRINT-AI-AGENTS-003 §1 — enfoque híbrido: si el historial es largo
  // (>20 mensajes), usamos `truncateWithSummary` que invoca al LLM para
  // generar un resumen enriquecido de los mensajes antiguos (preserva
  // precios cotizados, preocupaciones del cliente, próximos pasos
  // acordados). Si el historial es corto, usamos `truncateHistory`
  // (resumen simple basado en intents del usuario) — ahorrar el costo
  // de una llamada LLM extra (~$0.0005 con glm-4.6) cuando no se justifica.
  //
  // FIX-AI-AGENTS-001 §A-4: cada mensaje del cliente se envuelve con
  // wrapUserInput (delimitador <user_message>) para prevenir prompt
  // injection — antes todo el historial iba como un solo user message
  // sin delimitar, mezclando input del cliente con respuestas del agente.
  const conversationHistory: Message[] = conv.messages.map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.direction === 'inbound' ? wrapUserInput(m.body) : m.body,
  }))
  // `take: 12` en el query anterior normalmente deja este historial corto
  // (<20) — el path de truncateWithSummary solo se activa si se sube el
  // límite o si el caller ya trae un historial más grande (p.ej. desde un
  // contexto externo inyectado por webhook).
  let messages: Message[]
  if (conversationHistory.length > 20) {
    messages = await truncateWithSummary(ANTI_INJECTION_PREFIX + systemPrompt, conversationHistory)
  } else {
    messages = truncateHistory(ANTI_INJECTION_PREFIX + systemPrompt, conversationHistory)
  }
  messages.push({
    role: 'user',
    content: wrapUserInput(
      'Genera la siguiente respuesta del agente (solo el texto, sin prefijo "Agente:"):',
    ),
  })

  // SPRINT-AI-LLM-ADAPTER-001 §A-6 — capturamos startTime para medir
  // latencia y persistirla en el DecisionLog.
  const startTime = Date.now()
  let llmResult: LLMChatResult | undefined

  // IA-4 — IA-2 hardening: resolve the per-tier model + pre-flight the
  // new token-level budget manager + open a tracing span around the LLM
  // call. The model for /api/ai-reply is the 'standard' tier (glm-4.6)
  // via getModelForAgent's fallback — explicit per-agent override can be
  // added to AGENT_MODEL_TIER if a tenant wants a different tier.
  const tierInfo = getModelForAgent('ai_reply')
  const span = agentTracer.startSpan('ai_reply', { tenantId: conv.tenantId, conversationId: conv.id, customerId: conv.customerId })
  span.setContext({ tenantId: conv.tenantId, conversationId: conv.id })

  try {
    // §A-3 (timeout): Promise.race con 15s. Si el LLM no responde,
    // cae al catch (fallback deterministic) — mismo comportamiento que
    // una excepción de red o del provider.
    //
    // IA-5 (tool-use) — cuando el agente 'ai_reply' tiene tools
    // disponibles, runToolLoop los inyecta en el system prompt + ejecuta
    // los bloques ```tool_call + alimenta los resultados de vuelta al
    // LLM. Hoy 'ai_reply' no está en TOOL_PERMISSIONS → listForAgent
    // retorna [] → runToolLoop short-circuits a una sola llamada LLM.
    //
    // IA-6A (Gap 1 + Gap 2) — `runToolLoopWithResilience` wraps the
    // tool loop with `withRetry` (Gap 1) for transient failures + a
    // model fallback chain (Gap 2). The 15s per-attempt timeout is
    // enforced INSIDE the helper (no need for the outer Promise.race).
    const aiReplyTools = toolRegistry.listForAgent('ai_reply')
    let toolCallCount = 0
    const toolLoopResult = await runToolLoopWithResilience({
      messages,
      tools: aiReplyTools,
      ctx: {
        tenantId: conv.tenantId,
        conversationId: conv.id,
        customerId: conv.customerId,
        __agentName: 'ai_reply',
      },
      provider: tenant?.proveedorIa,
      primaryModel: tierInfo.model,
      timeoutMs: 15_000,
    })
    llmResult = toolLoopResult.llmResult
    toolCallCount = toolLoopResult.toolCallCount
    if (toolLoopResult.fellBack) {
      log.warn(
        {
          tenantId: conv.tenantId,
          conversationId: conv.id,
          primaryModel: tierInfo.model,
          actualModel: toolLoopResult.actualModel,
        },
        'LLM call used fallback model (primary failed after retries)',
      )
    }
    let reply = (llmResult.content || '').trim()

    // IA-6A (Gap 3) — PII redaction on the final reply. The customer's
    // own PII (email, phone, documentNumber) is whitelisted so the agent
    // can echo it back without being masked. PII from OTHER customers
    // (which could leak via CustomerMemory recall) is redacted.
    if (reply.length > 0) {
      const whitelist = conv.customer
        ? buildCustomerWhitelist({
            email: conv.customer.email,
            phone: conv.customer.phone,
            documentNumber: conv.customer.documentNumber,
          })
        : []
      const redaction = redactPII(reply, { whitelist })
      if (redaction.hadRedactions) {
        log.warn(
          {
            tenantId: conv.tenantId,
            conversationId: conv.id,
            redactedTypes: redaction.found.map((f) => `${f.type}:${f.count}`).join(','),
            total: redaction.totalRedacted,
          },
          'PII redacted from ai-reply output',
        )
        reply = redaction.redacted
      }
    }
    // FIX-AI-AGENTS-001 §A-3: confidence real — esta ruta devuelve texto
    // libre (no JSON), no hay esquema Zod que validar → 0.6.
    // (Antes era 0.9 hardcodeado en cada éxito.)
    const confidence = 0.6

    // IA-4 — finalize the tracing span + debit the budget ledger.
    const tokensIn = llmResult.usage?.promptTokens ?? 0
    const tokensOut = llmResult.usage?.completionTokens ?? 0
    const costUsd = estimateCost('ai_reply', tokensIn, tokensOut)
    span.end(reply, {
      tenantId: conv.tenantId,
      conversationId: conv.id,
      model: llmResult.model ?? tierInfo.model,
      tokensIn,
      tokensOut,
      costUsd,
      status: 'success',
    })
    budgetManager.recordUsage(
      conv.tenantId,
      conv.id,
      tokensIn,
      tokensOut,
      costUsd,
      'ai_reply',
      llmResult.model ?? tierInfo.model,
      // IA-6B (Gap 7) — per-customer cost attribution.
      conv.customerId ?? undefined,
    )

    // SPRINT-AI-LLM-ADAPTER-001 §A-6 — persistir tokens/costo/latencia
    // en DecisionLog. El path de éxito antes no persistía nada; ahora
    // registramos tokens y costo para observabilidad (¿cuánto cobra cada
    // respuesta automática al tenant?).
    // SPRINT-BACKEND-FINAL-001 — DB write migrated to `agentsService.persistDecisionLog`.
    await agentsService.persistDecisionLog({
      tenantId: conv.tenantId,
      agentName: 'ai_reply',
      conversationId: conv.id,
      ctx: { conversationId: conv.id, tone },
      result: { reply, confidence },
      llmData: {
        model: llmResult.model,
        provider: llmResult.provider,
        usage: llmResult.usage,
        latencyMs: Date.now() - startTime,
      },
    })

    // ── IA-1 (agent-builder) — Memory Curator (async, fire-and-forget) ──
    // After the reply is generated, extract durable facts from the latest
    // turn (customer message + this reply) and persist them in
    // `CustomerMemory` for future conversations. NEVER blocks the response.
    if (latestCustomerMessage) {
      const turnTranscript = `Customer: ${latestCustomerMessage}\n\nAgent: ${reply}`
      runMemoryCuratorAsync({
        tenantId: conv.tenantId,
        conversationId: conv.id,
        customerId: conv.customerId,
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
    // fire-and-forget call: after the reply is sent, if the sentiment
    // classification triggered any retention agents (excluding 'quote',
    // which is a no-op in this single-reply route), we invoke each one
    // with the conversation context + the sentiment + the recalled
    // memory, then emit the retention reply via socket so the operator
    // can review + route it. NEVER delays the customer's reply.
    if (sentiment && sentiment.triggeredAgents.length > 0) {
      const retentionTargets = sentiment.triggeredAgents.filter(
        (a) => a !== 'quote' && AGENT_NAMES.includes(a as AgentName),
      )
      for (const target of retentionTargets) {
        // Fire-and-forget — the customer's reply is already returned.
        void invokeRetentionAgent({
          agentName: target as AgentName,
          tenantId: conv.tenantId,
          conversationId: conv.id,
          customerId: conv.customerId,
          message: latestCustomerMessage,
          providerName: tenant?.proveedorIa,
          sentiment,
          customerMemories,
        }).catch((err) => {
          log.warn(
            { err: err instanceof Error ? err.message : String(err), target, conversationId: conv.id },
            'Sentiment-triggered retention agent failed (non-blocking)',
          )
        })
      }
    }

    return NextResponse.json({ reply, confidence, toolCallCount })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    // Fallback deterministic reply so the UI never breaks
    const fallback = `¡Hola ${conv.customer.name.split(' ')[0]}! 👋 Gracias por escribir. ¿Te ayudo a confirmar tu pedido? Cuéntame qué producto te interesa y tu ciudad para coordinar el envío.`
    // FIX-AI-AGENTS-001 §A-3: la llamada LLM falló completamente → 0.1
    // (antes era 0.3 — pero 0.3 implicaba "teníamos fallback", mientras
    // que 0.1 implica "nunca llegamos a tener output del modelo").
    // SPRINT-AI-LLM-ADAPTER-001 §A-3: incluye el caso de timeout (15s).
    const confidence = 0.1

    // IA-4 — finalize the tracing span as error/timeout. If the adapter
    // returned partial usage before the timeout, still debit it.
    const _errTokensIn = llmResult?.usage?.promptTokens ?? 0
    const _errTokensOut = llmResult?.usage?.completionTokens ?? 0
    const _errCostUsd = estimateCost('ai_reply', _errTokensIn, _errTokensOut)
    const _isTimeout = message.toLowerCase().includes('timeout')
    span.setError(message, _isTimeout ? 'timeout' : 'error')
    if (_errTokensIn > 0 || _errTokensOut > 0) {
      budgetManager.recordUsage(
        conv.tenantId,
        conv.id,
        _errTokensIn,
        _errTokensOut,
        _errCostUsd,
        'ai_reply',
        llmResult?.model ?? tierInfo.model,
        // IA-6B (Gap 7) — per-customer cost attribution (error path).
        conv.customerId ?? undefined,
      )
    }

    // §A-3 auto-escalación: 0.1 < 0.6 → persistir DecisionLog con
    // `humanReviewed: false` y emitir `agent:low_confidence` al tenant.
    // SPRINT-BACKEND-FINAL-001 — DB write migrated to `agentsService.persistDecisionLog`.
    await agentsService.persistDecisionLog({
      tenantId: conv.tenantId,
      agentName: 'ai_reply',
      conversationId: conv.id,
      ctx: { conversationId: conv.id, tone },
      result: { reply: fallback, confidence, error: message },
      llmData: llmResult
        ? {
            model: llmResult.model,
            provider: llmResult.provider,
            usage: llmResult.usage,
            latencyMs: Date.now() - startTime,
          }
        : undefined,
    })
    emitToTenant(conv.tenantId, 'agent:low_confidence', {
      agentName: 'ai_reply',
      conversationId: conv.id,
      confidence,
      reply: fallback,
      error: message,
      humanReviewed: false,
    })
    return NextResponse.json({ reply: fallback, confidence, error: message })
  }
})

// ───────────────────────────────────────────────────────────────────────────
// IA-4 (P1-3) — Fire-and-forget retention agent invoker.
//
// Called after the /api/ai-reply reply is generated, when the sentiment
// classification triggered a retention agent (frustrated → sales_retainer,
// churnRisk=high → remarketing). The invocation:
//   1. Builds the retention agent's prompt with the full conversation
//      context (tenantId, customerId, latest message, sentiment, recalled
//      memory) — same shape as /api/agents/[agentName] uses.
//   2. Calls the LLM via the pluggable adapter, with a 15s timeout.
//   3. Emits the retention reply via the `agent:trigger` socket event so
//      the dashboard can surface it to the operator for review + routing
//      to the customer.
//
// NEVER awaits — the customer's reply was already returned. Any failure
// is captured + logged; the operator won't see the retention suggestion
// in that case (acceptable: better to deliver the customer's reply than
// to block on a retention side-effect).
// ───────────────────────────────────────────────────────────────────────────

async function invokeRetentionAgent(params: {
  agentName: AgentName
  tenantId: string
  conversationId: string
  customerId?: string
  message: string
  providerName?: string
  sentiment: { sentiment: string; score: number; urgency: string; buyingIntent: string; churnRisk: string; decisionSource: string; triggeredAgents: string[] }
  customerMemories: { id: string; type: string; key: string; value: string; confidence: number; score: number }[]
}): Promise<void> {
  const start = Date.now()
  const { system, user } = await buildAgentPrompt(params.agentName, {
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    customerId: params.customerId,
    message: params.message,
    // The literal types in SentimentContext (e.g. 'frustrated') are
    // already validated by the sentiment service's Zod schema. Cast to
    // satisfy the AgentContext type without re-validating here.
    sentiment: params.sentiment as unknown as {
      sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'excited'
      score: number
      urgency: 'low' | 'medium' | 'high'
      buyingIntent: 'low' | 'medium' | 'high'
      churnRisk: 'low' | 'medium' | 'high'
      decisionSource: 'llm' | 'timeout' | 'error'
    },
    customerMemories: params.customerMemories.length > 0 ? params.customerMemories : undefined,
  })

  const messages: Message[] = [
    { role: 'system', content: ANTI_INJECTION_PREFIX + system },
    { role: 'user', content: wrapUserInput(user) },
  ]

  let reply = ''
  let model = ''
  try {
    const result = await Promise.race([
      chat(messages, {
        provider: params.providerName,
        model: getModelForAgent(params.agentName).model,
        thinking: 'disabled',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Retention agent LLM timeout (15s)')), 15_000),
      ),
    ])
    reply = result.content.trim() || FALLBACKS[params.agentName]
    model = result.model
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), agentName: params.agentName, conversationId: params.conversationId },
      'Retention agent LLM call failed — using fallback reply',
    )
    reply = FALLBACKS[params.agentName]
  }

  // Emit the retention reply to the tenant's dashboard. The dashboard
  // surfaces it as a suggestion (NOT auto-sent to the customer — the
  // operator reviews + approves). This is the actionable sink for the
  // previously-unheard `agent:trigger` socket event.
  emitToTenant(params.tenantId, 'agent:trigger', {
    target: params.agentName,
    conversationId: params.conversationId,
    customerId: params.customerId,
    reason: `sentiment:${params.sentiment.sentiment}/churn:${params.sentiment.churnRisk}/intent:${params.sentiment.buyingIntent}`,
    reply,
    model,
    latencyMs: Date.now() - start,
  })

  log.info(
    { agentName: params.agentName, conversationId: params.conversationId, replyLen: reply.length, latencyMs: Date.now() - start },
    'Sentiment-triggered retention agent invoked (fire-and-forget)',
  )
}
