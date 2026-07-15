// ZIAY — Agents service layer.
//
// Wraps the DB side-effects of the `/api/agents/[agentName]` route:
//   - Tenant LLM-provider lookup (`proveedorIa`).
//   - Profile-detection side-effect (`Conversation.perfilConversacion` update).
//   - Vision-agent image-identification persistence (`ImageIdentification`).
//   - DecisionLog persistence (success + fallback paths).
//
// The route keeps the business logic: LLM call, prompt building, output
// validation, confidence scoring, low-confidence escalation. Only the DB
// access patterns live here — that way future callers (e.g. a batch
// governance sweeper, the orchestrator's per-step persistence) can share
// the same seam without re-implementing the Prisma calls.
//
// SPRINT-BACKEND-FINAL-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { calculateCost, type TokenUsage } from '@/lib/llm/costs'

const log = getLogger('service:agents')

export interface PersistDecisionLogInput {
  tenantId: string
  agentName: string
  conversationId?: string
  ctx: unknown
  result: { reply: string; confidence: number; error?: string }
  llmData?: {
    model?: string
    provider?: string
    usage?: TokenUsage
    latencyMs?: number
  }
}

export interface ImageIdentificationInput {
  tenantId: string
  customerId?: string
  imageUrl: string
  skuDetectado?: string | null
  metodo?: string | null
  confianza?: number
}

export const agentsService = {
  /**
   * Fetch the tenant's LLM provider (`proveedorIa`). Returns null when the
   * tenant doesn't exist — the route falls back to the adapter's default
   * provider (env var or 'zai').
   */
  async getTenantLlmProvider(tenantId: string) {
    try {
      return await db.tenant.findUnique({
        where: { id: tenantId },
        select: { proveedorIa: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'agents',
        method: 'getTenantLlmProvider',
        tenantId,
      })
      // Non-blocking: the route can fall back to the default provider.
      // Returning null mirrors "tenant not found" — the route handles both
      // by using the adapter's default.
      return null
    }
  },

  /**
   * Update `Conversation.perfilConversacion` with a detected profile. Used
   * by the `profile` agent's side-effect. Best-effort: failure is captured
   * but not propagated (the agent's reply is still returned to the caller).
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
        service: 'agents',
        method: 'persistDetectedProfile',
        conversationId,
      })
      // Non-blocking — the agent's reply is still valid.
    }
  },

  /**
   * Persist a `ImageIdentification` row for the vision agent. Used when
   * the agent's reply parses as JSON with `{ sku, metodo, confianza }`.
   * Best-effort: failure is captured but not propagated.
   */
  async persistImageIdentification(input: ImageIdentificationInput): Promise<void> {
    try {
      await db.imageIdentification.create({
        data: {
          tenantId: input.tenantId,
          contactoId: input.customerId ?? null,
          imagenUrl: input.imageUrl,
          skuDetectado: input.skuDetectado ?? null,
          metodo: input.metodo ?? 'vlm',
          confianza: input.confianza ?? 0,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'agents',
        method: 'persistImageIdentification',
        tenantId: input.tenantId,
      })
      // Non-blocking.
    }
  },

  /**
   * Persist a DecisionLog row for an agent invocation (success or
   * fallback). Best-effort: if the persistence fails, the agent still
   * responds — the call is non-blocking.
   *
   * SPRINT-AI-LLM-ADAPTER-001 §A-6 — persists model, provider, tokens
   * and USD cost from the LLM result (when available; fallback paths
   * leave them null).
   */
  async persistDecisionLog(input: PersistDecisionLogInput): Promise<void> {
    try {
      const usage = input.llmData?.usage
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
          // El SDK actual no expone reasoning por separado — lo dejamos en null
          // para futuras integraciones con modelos con chain-of-thought visible.
          reasoning: null,
          confidence: input.result.confidence,
          // §A-6: tracking de tokens/costo/latencia (null cuando el LLM
          // falló antes de responder — no hay usage disponible).
          model: input.llmData?.model ?? null,
          provider: input.llmData?.provider ?? null,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          costUsd: usage
            ? calculateCost(input.llmData?.provider ?? 'zai', usage)
            : null,
          latencyMs: input.llmData?.latencyMs ?? null,
        },
      })
    } catch (err) {
      // Non-blocking: el log de decisión es secundario a la respuesta del
      // agente. Se captura para observabilidad pero no se propaga.
      log.warn(
        { err, agentName: input.agentName, tenantId: input.tenantId },
        'No se pudo persistir DecisionLog (non-blocking)',
      )
    }
  },
}

export type AgentsService = typeof agentsService
