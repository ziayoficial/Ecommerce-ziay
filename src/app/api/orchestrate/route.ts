// ZIAY — API /api/orchestrate
// Saramantha §12 — orchestrator that walks the 9-step agent pipeline.
//
// POST body: { tenantId, action: 'full' | 'step', scenarioId?, conversationId?, customerId?, currentStep? }
// - action='full'   → runs ALL 9 agents sequentially, returns the timeline of replies.
// - action='step'   → runs a SINGLE agent (currentStep), returns one reply + next step.
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

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { AGENT_LABELS, AgentName, buildAgentPrompt } from '@/lib/agents/prompts'
import {
  ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS, OrchestratorStepId, OrchestratorScenario,
} from '@/lib/orchestrator/constants'
import { captureError } from '@/lib/capture-error'
import ZAI from 'z-ai-web-dev-sdk'

async function callAgent(agentName: AgentName, ctx: {
  tenantId: string
  conversationId?: string
  customerId?: string
  perfil?: string
  query?: string
  imageUrl?: string
  items?: { sku: string; cantidad: number }[]
  message?: string
  partialAddress?: Record<string, string>
}): Promise<string> {
  const { system, user } = await buildAgentPrompt(agentName, ctx)
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content: user },
    ],
    thinking: { type: 'disabled' },
  })
  return completion.choices[0]?.message?.content?.trim() || ''
}

const FALLBACKS: Record<AgentName, string> = {
  profile: ' mayorista',
  speech: '¡Hola! ¿Qué producto te interesa?',
  quote: '¿Qué productos y cantidades quieres cotizar?',
  catalog: '¿Qué tema o producto buscas?',
  theme: '¿Qué personaje o tema te gusta?',
  objection: 'Entiendo. ¿Te confirmo el pedido?',
  address: '¿Cuál es tu ciudad y dirección completa?',
  logistics: '¿A qué ciudad enviamos y cuántas unidades?',
  vision: 'Por favor envíame una foto clara del producto para identificarlo.',
  checkout: '¿Confirmas el pedido?',
  // BUILD-AGENTS-LIB-001 — 16 new agent fallbacks (generic)
  buyer_behavior: 'Déjame revisar tu historial para recomendarte la mejor opción.',
  cart_builder: '¿Qué productos y cantidades quieres agregar al carrito?',
  guide_tracking: '¿Me compartes el número de guía o pedido para rastrearlo?',
  novedades: 'Tengo una novedad con tu envío, ¿me confirmas tu dirección actual?',
  redelivery: 'Para re-agendar la entrega, ¿qué horario te queda mejor?',
  remarketing: '¡Hola! Tengo una novedad que te puede interesar, ¿te acuerdo?',
  guide_alert: 'Alerta operativa generada — el equipo revisará el caso.',
  sales_retainer: 'Entiendo. ¿Te ofrezco pago contra entrega para que no pierdas el producto?',
  logistics_notifier: 'Tu pedido va en camino — te aviso en cada hito.',
  customer_score: 'Calculando score de cliente…',
  carrier_score: 'Calculando score de transportadoras…',
  product_enrichment: 'Enriqueciendo producto…',
  marketplace: 'Evaluando viabilidad de publicación en marketplace…',
  affiliator: 'Procesando atribución de afiliado…',
  traffic_orchestrator: 'Analizando redistribución de presupuesto…',
  address_analysis: 'Analizando calidad de la dirección…',
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const body = await req.json()
    const { tenantId, action, scenarioId, conversationId, customerId, currentStep } = body as {
      tenantId?: string
      action?: 'full' | 'step'
      scenarioId?: string
      conversationId?: string
      customerId?: string
      currentStep?: OrchestratorStepId
    }

    if (!tenantId) return NextResponse.json({ ok: false, error: 'tenantId required' }, { status: 400 })
    if (action !== 'full' && action !== 'step') {
      return NextResponse.json({ ok: false, error: "action must be 'full' or 'step'" }, { status: 400 })
    }

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) return NextResponse.json({ ok: false, error: `Tenant not found: ${tenantId}` }, { status: 404 })

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

      let reply = ''
      let errorMsg: string | undefined
      try {
        reply = await callAgent(step.agent as AgentName, buildCtx(step.id))
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'unknown error'
        reply = FALLBACKS[step.agent as AgentName]
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

      return NextResponse.json({
        ok: true,
        action: 'step',
        scenario: scenario ? { id: scenario.id, label: scenario.label } : undefined,
        currentStep: { id: step.id, index: step.index, label: step.label, emoji: step.emoji, agent: step.agent },
        nextStep,
        reply,
        error: errorMsg,
      })
    }

    // ── action='full' — run all 9 steps sequentially ────────────────────
    const timeline: Array<{
      step: OrchestratorStepId; index: number; label: string; emoji: string;
      agent: string; agentLabel: string; reply: string; error?: string
    }> = []
    for (const step of ORCHESTRATOR_STEPS) {
      let reply = ''
      let errorMsg: string | undefined
      try {
        reply = await callAgent(step.agent as AgentName, buildCtx(step.id))
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'unknown error'
        reply = FALLBACKS[step.agent as AgentName]
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

      timeline.push({
        step: step.id,
        index: step.index,
        label: step.label,
        emoji: step.emoji,
        agent: step.agent,
        agentLabel: AGENT_LABELS[step.agent as AgentName],
        reply,
        error: errorMsg,
      })
    }

    return NextResponse.json({
      ok: true,
      action: 'full',
      scenario: scenario ? { id: scenario.id, label: scenario.label } : undefined,
      timeline,
    })
  } catch (err) {
    captureError(err, { action: 'orchestrate' })
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
