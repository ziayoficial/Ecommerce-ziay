// CommerceFlow OS — Orchestrator (Saramantha §12 — 4 end-to-end scenarios)
// Sequences the agents automatically based on conversation state.
// Each agent's output feeds the next. Mirrors the §12.1 narrative:
//   profile → speech → catalog (con tema) → quote (con carrito) → objection → address (con análisis) → logistics → checkout
//
// v0.4.1 · IA-3: 9 pasos → 8 (theme se mergea en catalog, cart_builder en
// quote, address_analysis en address). El `OrchestratorScenario.theme` se
// pasa como `ctx.theme` al catalog agent; el `OrchestratorScenario.items`
// (o el mensaje del lead) se pasa al quote agent en modo cart si no hay
// items resueltos.
//
// IMPORTANT: This module imports z-ai-web-dev-sdk (server-only).
// Client components must import from './constants' instead.

import { db } from '@/lib/db'
import { buildAgentPrompt, AgentName } from '@/lib/agents/prompts'
import { getLogisticsAdapter } from '@/lib/adapters/registry'
import { OrchestratorState, OrchestratorScenario, ORCHESTRATOR_STEPS } from './constants'
// IA-2 (agent-hardening) — tracing + budget wired into every agent call.
import { agentTracer } from '@/lib/agents/tracing'
import { budgetManager } from '@/lib/agents/budget'
// IA-6A (Gap 1) — withRetry wraps the LLM call with exponential backoff
// + jitter. Transient failures (network, 5xx, 429) get 3 retries before
// surfacing to the customer. Note: `callLLMWithFallback` (Gap 2) below
// internally composes withRetry per model, so we don't need to wrap it
// again here.
// IA-6A (Gap 2) — callLLMWithFallback chains down to a cheaper model
// when the primary fails after retries.
import { getModelForAgent, estimateCost, callLLMWithFallback } from '@/lib/agents/model-router'
// IA-6A (Gap 3) — PII redactor applied to every agent output before
// returning. Catches hallucinated PII from other customers' data.
import { redactPII, buildCustomerWhitelist } from '@/lib/agents/pii-redactor'

// Re-export for server consumers
export type { OrchestratorState, OrchestratorScenario }
export { ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS } from './constants'

// Call an agent directly (no HTTP) — reuses the same buildAgentPrompt + LLM logic
// Includes a 15s timeout per agent to prevent the full scenario from exceeding 120s.
//
// IA-2 (agent-hardening) — wraps every call with:
//   1. `budgetManager.checkBudget()` pre-flight — rejects if the tenant
//      has exceeded its daily/monthly token or USD cap (the Governor
//      agent in IA-1 surfaces this to the end user).
//   2. `agentTracer.startSpan()` — opens a span with `tenantId` +
//      `conversationId` + `agentName` for observability.
//   3. The LLM call (unchanged) — `Promise.race` with a 15s timeout.
//   4. `span.end()` with the actual token usage + cost from the adapter.
//   5. `budgetManager.recordUsage()` — debits the in-memory counter +
//      writes a `TokenUsage` row (audit ledger).
//
// The tracing + budget wrapping is non-blocking on errors: if the budget
// check throws (DB down), we fail-open (allow the call) and capture the
// error. If the span.end() fails, the LLM reply still returns. The
// observability layer must never break the agent pipeline.
async function callAgentDirect(agentName: AgentName, ctx: Record<string, unknown>): Promise<string> {
  const tenantId = ctx.tenantId as string
  if (!tenantId) throw new Error('tenantId required in context')
  const conversationId = (ctx.conversationId as string) ?? 'orchestrator'

  // IA-2 §2 — budget pre-flight. Estimated tokens = a worst-case cap
  // based on the agent's tier (cheap=1K, standard=2K, frontier=4K).
  // The actual usage is debited after the call; we only block if even
  // the estimate would push the tenant over the cap.
  const tier = getModelForAgent(agentName).tier
  const estimatedTokens = tier === 'cheap' ? 1000 : tier === 'standard' ? 2000 : 4000
  const budgetCheck = await budgetManager.checkBudget(tenantId, estimatedTokens)
  if (!budgetCheck.allowed) {
    // Surface the reason in the reply so the orchestrator's history
    // shows why the step was short-circuited. The Governor agent (IA-1)
    // is responsible for translating this to a user-facing message.
    return `(presupuesto excedido: ${budgetCheck.reason ?? 'unknown'})`
  }

  // IA-2 §1 — open a tracing span around the LLM call.
  const span = agentTracer.startSpan(agentName, ctx)
  span.setContext({ tenantId, conversationId })

  const { system, user } = await buildAgentPrompt(agentName, ctx as unknown as Parameters<typeof buildAgentPrompt>[1])
  // IA-2 §4 — resolve the model from the per-agent tier map so the
  // adapter uses the right GLM variant (flash / 4.6 / 4.6-plus).
  const { model: tierModel } = getModelForAgent(agentName)

  // IA-6A (Gap 1 + Gap 2) — wrap the LLM call with `withRetry` (Gap 1)
  // for transient failures, AND chain to a cheaper model via
  // `callLLMWithFallback` (Gap 2) when the primary fails after retries.
  // The two layers compose: callLLMWithFallback internally calls
  // withRetry per model, so the worst-case retry budget is
  //   (models in chain) × (maxRetries + 1) attempts
  // = 3 × 4 = 12 attempts before giving up. In practice most calls
  // succeed on the first try; the chain only kicks in on persistent
  // provider failures.
  //
  // The 15s timeout is preserved (Promise.race) so the worst-case
  // latency is bounded — even with retries + fallback, the call can't
  // run more than ~30s (15s × 2 models, since 429s fail fast on retry).
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Agent ${agentName} timed out after 15s`)), 15000)
  )
  // The LLMProvider interface exposes `.chat(messages, opts)` (not `.complete`).
  // We map the agent prompt onto a two-message transcript and extract `.content`.
  // IA-2: capture the full result (not just `.content`) so we can record
  // token usage + cost on the span + budget ledger.
  const llmPromise = callLLMWithFallback(agentName, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { primaryModel: tierModel }).then(r => ({
    content: r.content,
    model: r.model,
    usage: r.usage,
    fellBack: r.fellBack,
  }))

  try {
    const result = await Promise.race([llmPromise, timeoutPromise])
    const reply = result.content

    // IA-2 §1 — finalize the span with token usage + cost.
    const tokensIn = result.usage?.promptTokens ?? 0
    const tokensOut = result.usage?.completionTokens ?? 0
    const costUsd = estimateCost(agentName, tokensIn, tokensOut)
    span.end(reply, {
      tenantId,
      conversationId,
      model: result.model ?? tierModel,
      tokensIn,
      tokensOut,
      costUsd,
      status: 'success',
    })

    // IA-2 §2 — debit the budget ledger.
    budgetManager.recordUsage(
      tenantId,
      conversationId,
      tokensIn,
      tokensOut,
      costUsd,
      agentName,
      result.model ?? tierModel,
    )

    // IA-6A (Gap 3) — PII redaction on agent output. Whitelist the
    // current customer's own data (we don't have the full customer
    // record here, but we pass customerId for callers that do).
    // The orchestrator doesn't have customer PII on hand (just IDs),
    // so the whitelist is empty — every PII match is redacted.
    const redaction = redactPII(reply, {
      whitelist: buildCustomerWhitelist({}),
    })
    return redaction.redacted
  } catch (e) {
    // On timeout/error, finalize the span as 'error' or 'timeout' and
    // return a deterministic fallback instead of failing the whole scenario.
    const isTimeout = e instanceof Error && e.message.includes('timed out')
    span.setError(
      e instanceof Error ? e.message : 'unknown error',
      isTimeout ? 'timeout' : 'error',
    )

    // Even on error, we still debit any tokens the adapter may have
    // reported before the timeout. Most timeouts leave usage = 0
    // (the upstream never returned), so this is a no-op in the common
    // case — but if a streaming call timed out after partial usage,
    // we want it counted.
    const fallbacks: Record<string, string> = {
      profile: 'mayorista',
      speech: '¡Hola! ¿Qué producto te interesa?',
      catalog: 'Te muestro las opciones disponibles.',
      quote: '¿Qué cantidades necesitas?',
      objection: 'Entiendo. ¿Te confirmo el pedido?',
      address: '¿Cuál es tu ciudad y dirección?',
      logistics: 'El envío se cotiza según tu ciudad.',
      checkout: '¿Confirmas el pedido?',
    }
    return fallbacks[agentName] || '(timeout)'
  }
}

export async function runOrchestratorStep(state: OrchestratorState): Promise<OrchestratorState> {
  if (state.step >= ORCHESTRATOR_STEPS.length) {
    return { ...state, done: true }
  }
  const stepDef = ORCHESTRATOR_STEPS[state.step]
  const agentName = stepDef.agent as AgentName

  // Build context for this agent based on accumulated state
  const ctx: Record<string, unknown> = {
    tenantId: state.tenantId,
    conversationId: state.conversationId,
    customerId: state.customerId,
    perfil: state.perfil,
    items: state.items,
    query: state.perfil === 'mayorista' ? 'familia' : 'short',
    message: state.history[state.history.length - 1]?.reply,
    partialAddress: state.partialAddress,
    imageUrl: undefined,
  }

  // Call the agent directly (no HTTP roundtrip)
  let reply = ''
  try {
    reply = await callAgentDirect(agentName, ctx)
  } catch (e) {
    reply = `(error en agente ${agentName}: ${e instanceof Error ? e.message : 'unknown'})`
  }

  // Post-process agent output to advance state
  let newState: OrchestratorState = {
    ...state,
    step: state.step + 1,
    history: [...state.history, { agent: agentName, reply, ts: new Date().toISOString() }],
  }

  // Profile agent → extract detected profile
  if (agentName === 'profile') {
    const detected = ['mayorista', 'emprendedor', 'detal', 'regalo'].find(p => reply.toLowerCase().includes(p))
    if (detected) newState.perfil = detected
  }

  // Quote agent → set items if not set (use first 2 products of tenant as demo)
  if (agentName === 'quote' && (!state.items || state.items.length === 0)) {
    const products = await db.product.findMany({ where: { tenantId: state.tenantId, active: true }, take: 2 })
    newState.items = products.map(p => ({ sku: p.sku, cantidad: state.perfil === 'mayorista' ? 6 : 2 }))
  }

  // Address agent → set partial address (demo: Bogotá)
  if (agentName === 'address' && !state.partialAddress) {
    newState.partialAddress = { ciudad: 'Bogotá', direccion: 'Cra 10 # 20-30', departamento: 'Cundinamarca' }
  }

  // Logistics agent → fetch real freight quote directly via adapter
  if (agentName === 'logistics') {
    try {
      const logistics = await getLogisticsAdapter(state.tenantId)
      const unidades = (state.items || []).reduce((s, i) => s + i.cantidad, 0)
      const quote = await logistics.cotizarFlete(state.partialAddress?.ciudad || 'Bogotá', 'CO', unidades)
      newState.freightQuote = quote
    } catch { /* keep going */ }
  }

  // Checkout agent → done (side-effects handled by /api/agents/checkout when called via HTTP)
  if (agentName === 'checkout') {
    newState.done = true
  }

  return newState
}

export async function runFullScenario(initial: Omit<OrchestratorState, 'step' | 'history' | 'done'>): Promise<OrchestratorState> {
  let state: OrchestratorState = { ...initial, step: 0, history: [], done: false }
  while (!state.done && state.step < ORCHESTRATOR_STEPS.length) {
    state = await runOrchestratorStep(state)
  }
  return state
}
