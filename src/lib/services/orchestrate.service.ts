// ZIAY — Orchestrate service layer.
//
// Wraps the DB side-effects of the `/api/orchestrate` route:
//   - Tenant LLM-provider lookup (`proveedorIa`).
//   - Pipeline-memory load + persist (`Conversation.pipelineMemory`).
//   - Profile-detection side-effect (`Conversation.perfilConversacion` update).
//   - DecisionLog persistence (low-confidence escalation only — the
//     orchestrator does NOT log every step to avoid DecisionLog spam).
//
// The route keeps the business logic: the 9-step pipeline walk, the LLM
// calls per step, the confidence scoring, the escalation emit. Only the
// DB access patterns live here so future callers (e.g. a batch orchestrator
// runner, a governance sweeper that replays pipelines) can share the seam.
//
// SPRINT-BACKEND-FINAL-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { calculateCost, type TokenUsage } from '@/lib/llm/costs'

const log = getLogger('service:orchestrate')

export interface PersistOrchestratorDecisionLogInput {
  tenantId: string
  agentName: string
  conversationId?: string
  ctx: unknown
  result: {
    reply: string
    confidence: number
    rawReply?: string
    error?: string
    model?: string
    provider?: string
    usage?: TokenUsage
    latencyMs?: number
  }
}

export const orchestrateService = {
  /**
   * Fetch the tenant's LLM provider + confirm the tenant exists. Returns
   * null when the tenant doesn't exist — the route maps that to a 404.
   */
  async getTenantForOrchestration(tenantId: string) {
    try {
      return await db.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, proveedorIa: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'orchestrate',
        method: 'getTenantForOrchestration',
        tenantId,
      })
      throw new Error('Failed to fetch tenant for orchestration')
    }
  },

  /**
   * Load the persisted pipeline memory for a conversation. Returns null
   * when the conversation has no memory yet (first invocation). The
   * caller is responsible for parsing + TTL eviction — this method just
   * returns the raw JSON string.
   */
  async getPipelineMemory(conversationId: string): Promise<string | null> {
    try {
      const conv = await db.conversation.findUnique({
        where: { id: conversationId },
        select: { pipelineMemory: true },
      })
      return conv?.pipelineMemory ?? null
    } catch (err) {
      captureError(err as Error, {
        service: 'orchestrate',
        method: 'getPipelineMemory',
        conversationId,
      })
      throw new Error('Failed to fetch pipeline memory')
    }
  },

  /**
   * Persist the pipeline memory back to the conversation at the end of a
   * `full` action. Best-effort: failure is captured but not propagated
   * (the response has already been built by the caller).
   */
  async persistPipelineMemory(
    conversationId: string,
    memory: string,
  ): Promise<void> {
    try {
      await db.conversation.update({
        where: { id: conversationId },
        data: { pipelineMemory: memory },
      })
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), conversationId },
        'No se pudo persistir pipelineMemory en Conversation (non-blocking)',
      )
    }
  },

  /**
   * Update `Conversation.perfilConversacion` with a detected profile.
   * Used by the `profile` step's side-effect (runs once per pipeline
   * invocation that reaches the profile step). Best-effort.
   */
  async persistDetectedProfile(
    conversationId: string,
    profile: string,
  ): Promise<void> {
    try {
      await db.conversation.update({
        where: { id: conversationId },
        data: { perfilConversacion: profile },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'orchestrate',
        method: 'persistDetectedProfile',
        conversationId,
      })
      // Non-blocking — the orchestrator's response is still valid.
    }
  },

  /**
   * Persist a DecisionLog row when an orchestrator step escalates
   * (confidence < 0.6). The orchestrator does NOT log every step — only
   * escalations — to keep DecisionLog focused on cases needing human
   * review. Best-effort: failure is captured but not propagated.
   *
   * SPRINT-AI-LLM-ADAPTER-001 §A-6 — persists model, provider, tokens
   * and USD cost from the LLM result when available.
   */
  async persistDecisionLog(input: PersistOrchestratorDecisionLogInput): Promise<void> {
    try {
      const usage = input.result.usage
      await db.decisionLog.create({
        data: {
          tenantId: input.tenantId,
          agentName: input.agentName,
          conversationId: input.conversationId ?? null,
          input: JSON.stringify(input.ctx),
          output: JSON.stringify({
            reply: input.result.reply,
            confidence: input.result.confidence,
            error: input.result.error ?? null,
          }),
          reasoning: null,
          confidence: input.result.confidence,
          model: input.result.model ?? null,
          provider: input.result.provider ?? null,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          costUsd: usage
            ? calculateCost(input.result.provider ?? 'zai', usage)
            : null,
          latencyMs: input.result.latencyMs ?? null,
        },
      })
    } catch (err) {
      log.warn(
        { err, agentName: input.agentName, tenantId: input.tenantId },
        'No se pudo persistir DecisionLog en escalación (non-blocking)',
      )
    }
  },
}

export type OrchestrateService = typeof orchestrateService
