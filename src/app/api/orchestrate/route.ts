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
import { AGENT_LABELS, AgentName, buildAgentPrompt, FALLBACKS } from '@/lib/agents/prompts'
import {
  ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS, OrchestratorStepId, OrchestratorScenario,
} from '@/lib/orchestrator/constants'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import ZAI from 'z-ai-web-dev-sdk'

const log = getLogger('api:orchestrate')

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

      log.info({ tenantId, action, stepId: step.id, agent: step.agent }, 'agent start')
      let reply = ''
      let errorMsg: string | undefined
      try {
        reply = await callAgent(step.agent as AgentName, buildCtx(step.id))
        log.info({ tenantId, stepId: step.id, agent: step.agent, replyLen: reply.length }, 'agent complete')
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'unknown error'
        reply = FALLBACKS[step.agent as AgentName]
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
      log.info({ tenantId, action: 'full', stepId: step.id, agent: step.agent, index: step.index }, 'agent start')
      let reply = ''
      let errorMsg: string | undefined
      try {
        reply = await callAgent(step.agent as AgentName, buildCtx(step.id))
        log.info({ tenantId, stepId: step.id, agent: step.agent, replyLen: reply.length }, 'agent complete')
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'unknown error'
        reply = FALLBACKS[step.agent as AgentName]
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
  } catch (err) {
    captureError(err, { action: 'orchestrate' })
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
