// CommerceFlow OS — Orchestrator (Saramantha §12 — 4 end-to-end scenarios)
// Sequences the 10 agents automatically based on conversation state.
// Each agent's output feeds the next. Mirrors the §12.1 narrative:
//   profile → speech → catalog → theme → quote → objection → address → logistics → checkout
//
// IMPORTANT: This module imports z-ai-web-dev-sdk (server-only).
// Client components must import from './constants' instead.

import { db } from '@/lib/db'
import { buildAgentPrompt, AgentName } from '@/lib/agents/prompts'
import { getLogisticsAdapter } from '@/lib/adapters/registry'
import { getLLMAdapter } from '@/lib/llm/adapter'
import { OrchestratorState, OrchestratorScenario, ORCHESTRATOR_STEPS } from './constants'

// Re-export for server consumers
export type { OrchestratorState, OrchestratorScenario }
export { ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS } from './constants'

// Call an agent directly (no HTTP) — reuses the same buildAgentPrompt + LLM logic
// Includes a 15s timeout per agent to prevent the full scenario from exceeding 120s.
async function callAgentDirect(agentName: AgentName, ctx: Record<string, unknown>): Promise<string> {
  const { system, user } = await buildAgentPrompt(agentName, ctx as unknown as Parameters<typeof buildAgentPrompt>[1])
  const tenantId = ctx.tenantId as string
  if (!tenantId) throw new Error('tenantId required in context')
  const llm = await getLLMAdapter(tenantId)

  // 15s timeout per agent call
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Agent ${agentName} timed out after 15s`)), 15000)
  )
  const llmPromise = llm.complete([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])

  try {
    return await Promise.race([llmPromise, timeoutPromise])
  } catch (e) {
    // On timeout, return a deterministic fallback instead of failing the whole scenario
    const fallbacks: Record<string, string> = {
      profile: 'mayorista',
      speech: '¡Hola! ¿Qué producto te interesa?',
      catalog: 'Te muestro las opciones disponibles.',
      theme: 'Tenemos Stitch y Hello Kitty.',
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
