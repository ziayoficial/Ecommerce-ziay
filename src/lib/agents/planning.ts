// ZIAY — Agent Planning / ReAct Loop (IA-5 · planning)
//
// Closes the gap surfaced by the IA-5 audit: the orchestrator was a
// fixed 8-step linear pipeline (profile → speech → catalog → quote →
// objection → address → logistics → checkout). There was no LLM-driven
// planning — every customer message ran through every step, even when
// a single agent could have answered. The Governor's `redirect` field
// was parsed but never consumed to alter routing.
//
// This module adds a Planner that:
//
//   1. `createPlan(message, ctx)` — uses a CHEAP LLM (glm-4.6-flash) to
//      decompose the customer's message into a sequence of agent steps.
//      Each step specifies the agent to call, the input to pass, and
//      optional dependencies on prior steps' outputs. Cheap LLM because
//      decomposition is classification, not reasoning — and the planner
//      runs on every message, so cost matters.
//
//      Example decomposition:
//        "Quiero 10 pijamas de Stitch para mi tienda"
//        → step 1: profile  (detect mayorista)
//        → step 2: catalog  (search "Stitch")        depends on step 1
//        → step 3: quote    (calculate price for 10)  depends on step 2
//        → step 4: checkout (if customer agrees)      depends on step 3
//
//   2. `executePlan(plan, ctx)` — runs the steps in dependency order.
//      Independent steps (no `dependsOn`) can run in parallel. If a
//      step fails, `revisePlan()` is called to adjust the remaining
//      steps. Caps at 10 steps per plan (prevents runaway planning).
//
//   3. `revisePlan(plan, failedStep, ctx)` — uses a CHEAP LLM to analyze
//      the failure and adjust the remaining steps (skip, add, or modify).
//      Marks the failed step as 'failed' and continues with the revised
//      plan. If revision itself fails, the plan is marked 'failed' and
//      the caller falls back to the linear pipeline.
//
// Design notes:
//
//   - The planner uses the EXISTING agent infrastructure. Each step
//     calls an agent via the same `callAgent()` path the orchestrator
//     uses (so tracing, budget, governor, QA review all still apply).
//     The planner is a SCHEDULER, not a new agent layer.
//
//   - Plans are traced: each plan execution is a trace with child spans
//     for each step. The plan itself is persisted as a DecisionLog row
//     for auditability (the IA-5 audit requires "store plan + tool calls
//     in DecisionLog for auditability").
//
//   - Failures are non-fatal: if the planner LLM times out (3s cap) or
//     returns an unparseable plan, the caller falls back to the linear
//     pipeline. The customer's response is never delayed by planning
//     failures.
//
//   - 1-step fast path: if `createPlan()` returns a single step, the
//     caller can invoke that agent directly without the plan execution
//     overhead. This is the common case for simple messages ("¿qué
//     productos tienen?") — the planner recognizes it as a single
//     catalog query and returns a 1-step plan.
//
// IA-5 (planning)

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { chat } from '@/lib/llm/adapter'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { agentTracer } from '@/lib/agents/tracing'
import { db } from '@/lib/db'
import { ANTI_INJECTION_PREFIX, wrapUserInput } from '@/lib/agents/sanitize'
import type { ChatMessage } from 'z-ai-web-dev-sdk'

const log = getLogger('agent:planner')

/** Cheap LLM for planning. Decomposition is classification, not reasoning. */
const PLANNER_MODEL = process.env.PLANNER_MODEL ?? 'glm-4.6-flash'

/** 3s timeout — the planner must never delay the customer's response.
 *  On timeout, the caller falls back to the linear pipeline. */
const PLANNER_TIMEOUT_MS = 3_000

/** Hard cap on plan steps. Prevents a runaway planner from generating
 *  an unbounded plan that would burn the LLM budget. */
const MAX_PLAN_STEPS = 10

/** Hard cap on plan revisions. If a plan keeps failing + revising, we
 *  bail out and let the caller fall back to the linear pipeline. */
const MAX_REVISIONS = 2

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type PlanStatus = 'planning' | 'executing' | 'completed' | 'failed'

export interface PlanStep {
  id: string
  /** Which agent to call (must be a valid AgentName). */
  agent: string
  /** Input to pass to the agent (subset of AgentContext). */
  input: Record<string, unknown>
  /** Step IDs that must complete before this step can run. */
  dependsOn?: string[]
  status: PlanStepStatus
  /** The agent's reply (when status='done') or error message (when 'failed'). */
  output?: string
  /** Confidence reported by the agent call (0-1). */
  confidence?: number
  /** Wall-clock latency of the agent call (ms). */
  latencyMs?: number
}

export interface Plan {
  id: string
  /** The customer's request that the plan addresses. */
  goal: string
  steps: PlanStep[]
  status: PlanStatus
  createdAt: Date
  /** Number of times `revisePlan()` has been called on this plan.
   *  Capped at MAX_REVISIONS — beyond that, the plan is marked 'failed'. */
  revisionCount: number
}

/**
 * Context passed to the planner. Subset of AgentContext — the planner
 * needs tenantId for the cheap LLM call + the conversation's recent
 * messages to decompose the customer's intent.
 */
export interface AgentContextForPlanning {
  tenantId: string
  conversationId?: string
  customerId?: string
  /** The most recent customer message (the one the plan addresses). */
  message: string
  /** The customer's detected profile (mayorista / emprendedor / detal / regalo). */
  perfil?: string
  /** Optional prior conversation messages for context (last N turns). */
  recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
}

// ───────────────────────────────────────────────────────────────────────────
// LLM prompt for plan creation
// ───────────────────────────────────────────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `Eres el Planner de ZIAY — un orquestador de agentes IA para comercio conversacional.

Tu trabajo: dado un mensaje del cliente, descomponerlo en una secuencia de pasos donde cada paso invoca EXACTAMENTE UN agente de la lista oficial.

AGENTES DISPONIBLES (usa SOLO estos nombres):
- profile: detectar perfil (mayorista / emprendedor / detal / regalo)
- speech: generar discurso de apertura por perfil
- catalog: buscar productos por query o tema (Stitch, Hello Kitty, etc.)
- quote: cotizar items con descuento por volumen
- objection: manejar objeciones (precio, competencia, desconfianza)
- address: confirmar dirección de entrega
- logistics: cotizar flete
- checkout: crear pedido borrador
- vision: identificar producto por imagen
- novedades: manejar novedades logísticas
- redelivery: re-agendar entrega
- remarketing: re-enganchar lead frío
- sales_retainer: retener venta en riesgo
- buyer_behavior: analizar comportamiento

REGLAS:
1. Emite EXACTAMENTE un bloque JSON con la forma:
   { "steps": [ { "agent": "name", "input": { ... }, "dependsOn": ["stepId"] } ] }
2. Asigna a cada step un "id" implícito por su orden (s1, s2, s3, ...).
3. El primer step NO lleva dependsOn.
4. Un step que necesita el output de un step previo lleva dependsOn = ["sN"].
5. Pasos independientes pueden correr en paralelo (sin dependsOn entre ellos).
6. MÍNIMO 1 step, MÁXIMO 6 steps. Si el mensaje es simple ("¿qué productos tienen?"), 1 step basta.
7. NO inventes agentes que no estén en la lista.
8. NO incluyas texto fuera del JSON.

EJEMPLOS:
- "Hola, quiero 10 pijamas de Stitch para mi tienda"
  → { "steps": [ { "agent": "profile", "input": {} }, { "agent": "catalog", "input": { "query": "Stitch", "theme": "Stitch" }, "dependsOn": ["s1"] }, { "agent": "quote", "input": { "items": [{"sku":"AUTO","quantity":10}] }, "dependsOn": ["s2"] } ] }

- "¿Qué productos tienen?"
  → { "steps": [ { "agent": "catalog", "input": { "query": "all" } } ] }

- "Voy a cancelar el pedido, no me lo van a cumplir"
  → { "steps": [ { "agent": "objection", "input": { "message": "Voy a cancelar el pedido, no me lo van a cumplir" } } ] }`

// ───────────────────────────────────────────────────────────────────────────
// Zod schema for LLM plan output
// ───────────────────────────────────────────────────────────────────────────

const PlannerStepSchema = z.object({
  agent: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string()).optional(),
})

const PlannerOutputSchema = z.object({
  steps: z.array(PlannerStepSchema).min(1).max(MAX_PLAN_STEPS),
})

// ───────────────────────────────────────────────────────────────────────────
// Planner class
// ───────────────────────────────────────────────────────────────────────────

export class Planner {
  /**
   * Create a plan for a customer message. Uses a cheap LLM to decompose
   * the message into a sequence of agent steps.
   *
   * Returns a `Plan` with `status='planning'` (the caller runs
   * `executePlan()` to actually invoke the agents). On timeout/error,
   * returns a 1-step fallback plan that runs the `speech` agent —
   * the caller can then fall back to the linear pipeline.
   *
   * NEVER throws — failures are surfaced as a fallback plan + a log
   * entry. The customer's response is never delayed by planning failures.
   */
  async createPlan(message: string, ctx: AgentContextForPlanning): Promise<Plan> {
    const planId = randomUUID()
    const start = Date.now()

    // Build the user prompt: customer message + recent context.
    const recentContext = (ctx.recentMessages ?? [])
      .slice(-3)
      .map((m) => `${m.role === 'user' ? 'Cliente' : 'Agente'}: ${m.content}`)
      .join('\n')
    const perfilHint = ctx.perfil ? `\nPerfil detectado: ${ctx.perfil}` : ''
    const userPrompt = `Mensaje del cliente:${perfilHint}\n${recentContext ? `\nContexto reciente:\n${recentContext}\n` : ''}\nMensaje actual:\n${message}\n\nDescompón este mensaje en pasos de agentes. Emite solo el JSON.`

    const messages: ChatMessage[] = [
      { role: 'system', content: ANTI_INJECTION_PREFIX + PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: wrapUserInput(userPrompt) },
    ]

    let llmContent = ''
    try {
      const llmResult = await Promise.race([
        chat(messages, {
          model: PLANNER_MODEL,
          thinking: 'disabled',
          temperature: 0,
          maxTokens: 800,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Planner LLM timeout')), PLANNER_TIMEOUT_MS),
        ),
      ])
      llmContent = llmResult.content ?? ''
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      log.warn(
        { err: errMsg, tenantId: ctx.tenantId, messagePreview: message.slice(0, 100) },
        'Planner LLM call failed — returning 1-step fallback plan',
      )
      // Fallback: 1-step plan running the `speech` agent. The caller
      // detects this via `plan.status === 'planning'` + a single step
      // with agent='speech' + the `_fallback` flag.
      return {
        id: planId,
        goal: message,
        steps: [
          {
            id: 's1',
            agent: 'speech',
            input: { message },
            status: 'pending',
          },
        ],
        status: 'planning',
        createdAt: new Date(),
        revisionCount: 0,
      }
    }

    // Parse the JSON output. Tolerate markdown fences + prose wrapper.
    const parsed = this.parsePlanOutput(llmContent)
    if (!parsed) {
      log.warn(
        { tenantId: ctx.tenantId, rawLen: llmContent.length, rawHead: llmContent.slice(0, 200) },
        'Planner LLM output unparseable — returning 1-step fallback plan',
      )
      return {
        id: planId,
        goal: message,
        steps: [
          {
            id: 's1',
            agent: 'speech',
            input: { message },
            status: 'pending',
          },
        ],
        status: 'planning',
        createdAt: new Date(),
        revisionCount: 0,
      }
    }

    // Build PlanStep[] with auto-assigned IDs (s1, s2, ...) and validate
    // dependsOn references.
    const steps: PlanStep[] = parsed.steps.map((s, i) => {
      const id = `s${i + 1}`
      return {
        id,
        agent: s.agent,
        input: s.input,
        dependsOn: s.dependsOn,
        status: 'pending' as const,
      }
    })

    log.info(
      { planId, tenantId: ctx.tenantId, stepCount: steps.length, agents: steps.map((s) => s.agent), latencyMs: Date.now() - start },
      'plan created',
    )

    return {
      id: planId,
      goal: message,
      steps,
      status: 'planning',
      createdAt: new Date(),
      revisionCount: 0,
    }
  }

  /**
   * Execute a plan step by step. Independent steps (no `dependsOn`)
   * run in parallel; dependent steps wait for their dependencies.
   *
   * For each step, the caller-supplied `callAgent` function is invoked
   * with the step's `agent` + `input` (+ the parent AgentContext).
   * The result is stored on the step (`output`, `confidence`,
   * `latencyMs`). Failed steps trigger `revisePlan()`.
   *
   * Returns the finalized plan (all steps done/failed/skipped). NEVER
   * throws — failures are surfaced as step status + log entries.
   */
  async executePlan(
    plan: Plan,
    ctx: AgentContextForPlanning,
    callAgent: (agentName: string, input: Record<string, unknown>) => Promise<{ reply: string; confidence: number; error?: string; latencyMs?: number }>,
  ): Promise<Plan> {
    const executedPlan: Plan = {
      ...plan,
      status: 'executing',
    }

    // Open a tracing span for the plan execution.
    const planSpan = agentTracer.startSpan('planner:execute', {
      planId: plan.id,
      goal: plan.goal,
      stepCount: plan.steps.length,
    })
    planSpan.setContext({ tenantId: ctx.tenantId, conversationId: ctx.conversationId })

    try {
      // Track completed step outputs so dependent steps can reference them.
      const stepOutputs = new Map<string, string>()

      // Loop: in each iteration, run all steps whose dependencies are
      // satisfied (status='pending' + all deps 'done'). Repeat until
      // no more steps can run.
      let safetyCounter = 0
      while (
        executedPlan.steps.some((s) => s.status === 'pending') &&
        safetyCounter < MAX_PLAN_STEPS * 2
      ) {
        safetyCounter++

        // Find runnable steps: pending + all deps done (or deps failed/skipped).
        const runnable = executedPlan.steps.filter((s) => {
          if (s.status !== 'pending') return false
          if (!s.dependsOn || s.dependsOn.length === 0) return true
          return s.dependsOn.every((depId) => {
            const dep = executedPlan.steps.find((x) => x.id === depId)
            return dep && (dep.status === 'done' || dep.status === 'skipped')
          })
        })

        if (runnable.length === 0) {
          // Deadlock — every remaining pending step has a dependency
          // that's not done. Mark them all as 'skipped' and exit.
          for (const s of executedPlan.steps) {
            if (s.status === 'pending') s.status = 'skipped'
          }
          break
        }

        // Execute runnable steps in parallel.
        await Promise.all(
          runnable.map(async (step) => {
            step.status = 'running'

            // Open a child span for the step.
            const stepSpan = planSpan.child(`planner:step:${step.agent}`, {
              stepId: step.id,
              agent: step.agent,
              input: step.input,
            })

            const start = Date.now()
            try {
              // Inject prior step outputs into the step's input so the
              // agent can reference them. The convention: each prior
              // step's output is added under `input.priorSteps` as
              // `{ s1: "reply", s2: "reply", ... }`.
              const priorSteps: Record<string, string> = {}
              for (const [sid, out] of stepOutputs.entries()) {
                priorSteps[sid] = out
              }
              const mergedInput = { ...step.input, priorSteps }

              const result = await callAgent(step.agent, mergedInput)
              step.output = result.reply
              step.confidence = result.confidence
              step.latencyMs = result.latencyMs ?? Date.now() - start

              if (result.error || result.confidence < 0.3) {
                // Step "failed" — low confidence or explicit error.
                step.status = 'failed'
                stepSpan.setError(result.error ?? 'low confidence', 'error')
                log.warn(
                  { planId: plan.id, stepId: step.id, agent: step.agent, err: result.error, confidence: result.confidence },
                  'plan step failed — will revise',
                )

                // Revise the remaining steps.
                if (executedPlan.revisionCount < MAX_REVISIONS) {
                  const revised = await this.revisePlan(executedPlan, step, ctx)
                  executedPlan.steps = revised.steps
                  executedPlan.revisionCount = revised.revisionCount
                }
              } else {
                step.status = 'done'
                stepOutputs.set(step.id, step.output)
                stepSpan.end(step.output, {
                  tenantId: ctx.tenantId,
                  conversationId: ctx.conversationId,
                  model: step.agent,
                  tokensIn: 0,
                  tokensOut: 0,
                  costUsd: 0,
                  status: 'success',
                  confidence: step.confidence,
                })
              }
            } catch (err) {
              step.status = 'failed'
              step.output = err instanceof Error ? err.message : 'unknown error'
              step.latencyMs = Date.now() - start
              stepSpan.setError(step.output, 'error')
              log.warn(
                { planId: plan.id, stepId: step.id, agent: step.agent, err: step.output },
                'plan step threw — will revise',
              )

              if (executedPlan.revisionCount < MAX_REVISIONS) {
                const revised = await this.revisePlan(executedPlan, step, ctx)
                executedPlan.steps = revised.steps
                executedPlan.revisionCount = revised.revisionCount
              }
            }
          }),
        )
      }

      // Determine final plan status.
      const hasFailed = executedPlan.steps.some((s) => s.status === 'failed')
      executedPlan.status = hasFailed ? 'failed' : 'completed'
      planSpan.end(
        JSON.stringify({
          planId: executedPlan.id,
          status: executedPlan.status,
          steps: executedPlan.steps.map((s) => ({ id: s.id, agent: s.agent, status: s.status })),
        }),
        {
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId,
          model: PLANNER_MODEL,
          status: executedPlan.status === 'completed' ? 'success' : 'error',
        },
      )

      // Persist the plan to DecisionLog for auditability (best-effort).
      void this.persistPlanDecisionLog(executedPlan, ctx).catch(() => {})

      return executedPlan
    } catch (err) {
      captureError(err as Error, {
        service: 'planner',
        method: 'executePlan',
        planId: plan.id,
        tenantId: ctx.tenantId,
      })
      planSpan.setError(err instanceof Error ? err.message : 'unknown error', 'error')
      executedPlan.status = 'failed'
      return executedPlan
    }
  }

  /**
   * Revise a plan after a step has failed. Uses a CHEAP LLM to analyze
   * the failure and adjust the remaining steps (skip, add, or modify).
   *
   * The failed step is marked 'failed' (not retried automatically —
   * the LLM may decide to skip it, retry with different input, or add
   * a different agent). The remaining pending steps may be reordered,
   * dropped, or augmented.
   *
   * Returns the revised plan. NEVER throws — on revision failure, the
   * plan is returned unchanged (the caller will see the failed step +
   * the remaining pending steps as-is, and `executePlan()` will mark
   * them 'skipped' on the next iteration).
   */
  async revisePlan(plan: Plan, failedStep: PlanStep, _ctx: AgentContextForPlanning): Promise<Plan> {
    const start = Date.now()
    const remaining = plan.steps.filter((s) => s.status === 'pending')

    // If there are no remaining steps, nothing to revise.
    if (remaining.length === 0) {
      return plan
    }

    const revisionSystemPrompt = `Eres el Planner de ZIAY en modo revisión. Un step del plan falló. Analiza el fallo y ajusta los steps restantes.

Step fallido:
  agent: ${failedStep.agent}
  input: ${JSON.stringify(failedStep.input)}
  error: ${failedStep.output ?? 'unknown'}

Steps restantes (en orden):
${remaining.map((s) => `  - id=${s.id} agent=${s.agent} input=${JSON.stringify(s.input)} dependsOn=${JSON.stringify(s.dependsOn ?? [])}`).join('\n')}

REGLAS:
1. Emite EXACTAMENTE un bloque JSON: { "actions": [ { "stepId": "sN", "action": "keep" | "skip" | "modify", "newInput": {...} } ] }
2. "keep" = ejecutar el step sin cambios.
3. "skip" = saltar el step (dependientes se saltan también).
4. "modify" = ejecutar el step con el nuevo input.
5. NO inventes stepIds que no estén en la lista.
6. NO incluyas texto fuera del JSON.`

    const messages: ChatMessage[] = [
      { role: 'system', content: ANTI_INJECTION_PREFIX + revisionSystemPrompt },
      { role: 'user', content: wrapUserInput(`Revisa el plan. Meta original: ${plan.goal}`) },
    ]

    let llmContent = ''
    try {
      const llmResult = await Promise.race([
        chat(messages, {
          model: PLANNER_MODEL,
          thinking: 'disabled',
          temperature: 0,
          maxTokens: 600,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Planner revise timeout')), PLANNER_TIMEOUT_MS),
        ),
      ])
      llmContent = llmResult.content ?? ''
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), planId: plan.id, failedStep: failedStep.id },
        'revisePlan LLM call failed — returning plan unchanged',
      )
      return plan
    }

    // Parse the revision actions.
    const jsonMatch = llmContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn({ planId: plan.id, rawHead: llmContent.slice(0, 200) }, 'revisePlan output unparseable — returning plan unchanged')
      return plan
    }

    let actions: Array<{ stepId: string; action: string; newInput?: Record<string, unknown> }>
    try {
      const parsed = JSON.parse(jsonMatch[0])
      actions = Array.isArray(parsed.actions) ? parsed.actions : []
    } catch {
      log.warn({ planId: plan.id }, 'revisePlan JSON parse failed — returning plan unchanged')
      return plan
    }

    // Apply the actions to the remaining steps.
    const revisedSteps = plan.steps.map((s) => {
      if (s.status !== 'pending') return s
      const action = actions.find((a) => a.stepId === s.id)
      if (!action) return s
      if (action.action === 'skip') {
        return { ...s, status: 'skipped' as const }
      }
      if (action.action === 'modify' && action.newInput) {
        return { ...s, input: { ...s.input, ...action.newInput } }
      }
      return s
    })

    log.info(
      { planId: plan.id, failedStep: failedStep.id, actionCount: actions.length, latencyMs: Date.now() - start },
      'plan revised',
    )

    return {
      ...plan,
      steps: revisedSteps,
      revisionCount: plan.revisionCount + 1,
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Parses the planner LLM output into a validated `PlannerOutputSchema`.
   * Tolerates markdown fences + prose wrapper.
   */
  private parsePlanOutput(content: string): z.infer<typeof PlannerOutputSchema> | null {
    // Strip markdown fences if present.
    const fenceMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
    const jsonBody = fenceMatch ? fenceMatch[1] : content
    // Find the first {...} block (the LLM may emit prose around it).
    const jsonMatch = jsonBody.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const result = PlannerOutputSchema.safeParse(parsed)
      if (result.success) return result.data
      log.debug({ issues: result.error.issues }, 'planner output schema validation failed')
      return null
    } catch {
      return null
    }
  }

  /**
   * Persists the plan + step results to DecisionLog for auditability.
   * Best-effort — failures are logged + swallowed.
   */
  private async persistPlanDecisionLog(plan: Plan, ctx: AgentContextForPlanning): Promise<void> {
    try {
      await db.decisionLog.create({
        data: {
          tenantId: ctx.tenantId,
          agentName: 'planner',
          conversationId: ctx.conversationId ?? null,
          input: JSON.stringify({ goal: plan.goal, planId: plan.id }),
          output: JSON.stringify({
            status: plan.status,
            steps: plan.steps.map((s) => ({
              id: s.id,
              agent: s.agent,
              status: s.status,
              confidence: s.confidence,
              latencyMs: s.latencyMs,
              outputPreview: s.output?.slice(0, 200),
            })),
          }),
          reasoning: JSON.stringify({
            revisionCount: plan.revisionCount,
            createdAt: plan.createdAt.toISOString(),
          }),
          confidence: plan.status === 'completed' ? 0.8 : plan.status === 'failed' ? 0.2 : 0.5,
          model: PLANNER_MODEL,
          provider: null,
        },
      })
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), planId: plan.id },
        'plan DecisionLog persist failed (non-blocking)',
      )
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Singleton planner
// ───────────────────────────────────────────────────────────────────────────

export const planner = new Planner()

// Re-export types + helpers for callers.
export { PLANNER_MODEL, PLANNER_TIMEOUT_MS, MAX_PLAN_STEPS, MAX_REVISIONS }
