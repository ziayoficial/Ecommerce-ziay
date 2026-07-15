// ZIAY — Conversation service layer.
//
// Wraps ALL DB access for conversations + messages. API routes that
// currently call `db.conversation.*` / `db.message.*` directly should
// migrate to call this service in a follow-up sprint.
//
// SPRINT6-ARCH-001 — service layer.
// SPRINT-WHATSAPP-FUNCTIONAL-001 — sendMessage now also delivers outbound
//   via the WhatsApp Cloud API adapter when the conversation's channel is
//   `whatsapp`, and records TTR (firstReplyAt) on the conversation.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { getWhatsAppAdapter } from '@/lib/adapters/whatsapp-cloud'
import { recordFirstReply } from '@/lib/metrics/ttr'

const log = getLogger('service:conversation')

export interface ConversationFilters {
  status?: string
  channel?: string
  q?: string
  /** Cursor-based pagination — id of the last row on the previous page. */
  cursor?: string
  /** Page size. The service takes `limit + 1` so the caller can detect
   *  `hasMore`. When omitted, falls back to 200 (legacy behaviour). */
  limit?: number
}

export interface SendMessageInput {
  tenantId: string
  conversationId: string
  body: string
  direction?: 'inbound' | 'outbound'
  type?: string
  mediaUrl?: string | null
  aiSuggested?: boolean
  aiConfidence?: number
}

export const conversationService = {
  /**
   * List conversations for a tenant with the most recent message hydrated.
   * Used by `/api/conversations?tenantId=...&status=...&channel=...&q=...&cursor=...&limit=...`.
   *
   * Cursor-based pagination: pass `filters.cursor` (id of the last row on
   * the previous page) + `filters.limit`. The service returns `limit + 1`
   * rows so the caller can detect `hasMore`. When `limit` is omitted it
   * falls back to a hard cap of 200 (legacy behaviour).
   */
  async getConversations(tenantId: string | undefined, filters?: ConversationFilters) {
    try {
      const limit = filters?.limit
      const take = limit != null ? limit + 1 : 200
      return await db.conversation.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          ...(filters?.status && filters.status !== 'all' ? { status: filters.status } : {}),
          ...(filters?.channel && filters.channel !== 'all' ? { channelId: filters.channel } : {}),
          ...(filters?.q ? { customer: { name: { contains: filters.q } } } : {}),
        },
        include: {
          customer: true,
          channel: true,
          assignee: true,
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { lastMessageAt: 'desc' },
        take,
        ...(filters?.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
      })
    } catch (err) {
      captureError(err as Error, { service: 'conversation', method: 'getConversations', tenantId })
      throw new Error('Failed to fetch conversations')
    }
  },

  /**
   * Single conversation with full message history + recent orders.
   * Used by `/api/conversations/[id]`.
   *
   * When `tenantId` is provided, the lookup is constrained to that tenant
   * (defense-in-depth — the route should have already validated tenant
   * access via `requireAuth` / `requireTenantAccess`). When omitted, the
   * lookup is by id only (legacy behaviour).
   */
  async getConversationById(id: string, tenantId?: string) {
    try {
      const conv = await db.conversation.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
        include: {
          customer: true,
          channel: true,
          assignee: true,
          messages: { orderBy: { createdAt: 'asc' } },
          orders: {
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      })
      if (conv && conv.unreadCount > 0) {
        // Best-effort: clear unread badge on open. Don't fail the request
        // if this write errors — the user still gets the conversation.
        try {
          await db.conversation.update({ where: { id }, data: { unreadCount: 0 } })
        } catch (clearErr) {
          captureError(clearErr as Error, {
            service: 'conversation',
            method: 'getConversationById:clearUnread',
            id,
          })
        }
      }
      return conv
    } catch (err) {
      captureError(err as Error, { service: 'conversation', method: 'getConversationById', id })
      throw new Error('Failed to fetch conversation')
    }
  },

  /**
   * Send (persist) an outbound message into a conversation. Updates
   * `lastMessageAt` + resets unreadCount in the same logical operation.
   *
   * SPRINT-WHATSAPP-FUNCTIONAL-001 — when the conversation's channel is
   * `whatsapp`, ALSO delivers the message via the WhatsApp Cloud API
   * adapter (POST /{phoneNumberId}/messages). The persisted `Message`
   * row's `waMessageId` is updated with the ID Meta echoes back. The
   * first outbound reply also stamps `conversation.firstReplyAt` for
   * TTR analytics (study §14.4).
   *
   * Delivery failures are non-fatal: the local `Message` row is still
   * persisted (status='failed') so the agent sees their attempted reply
   * in the inbox and can retry. The error is captured + logged.
   */
  async sendMessage(input: SendMessageInput) {
    try {
      // Fetch the conversation + channel to know whether we need to
      // deliver via the WhatsApp adapter and which customer phone to
      // send to. Single query — keeps the happy path fast.
      const conv = await db.conversation.findUnique({
        where: { id: input.conversationId },
        select: {
          id: true,
          tenantId: true,
          channelId: true,
          customerPhone: true,
          customer: { select: { phone: true } },
          channel: { select: { type: true } },
        },
      })
      if (!conv) {
        throw new Error(`Conversación no encontrada: ${input.conversationId}`)
      }

      const isOutbound = (input.direction ?? 'outbound') === 'outbound'

      // Persist the local Message row first — the agent needs to see
      // their reply in the inbox immediately, even if the WA delivery
      // is slow or fails.
      const msg = await db.message.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          direction: input.direction ?? 'outbound',
          body: input.body,
          type: input.type ?? 'text',
          mediaUrl: input.mediaUrl ?? null,
          status: 'sent',
          aiSuggested: input.aiSuggested ?? false,
          aiConfidence: input.aiConfidence ?? null,
        },
      })

      await db.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date(), unreadCount: 0 },
      })

      // ── WhatsApp Cloud API delivery (outbound only) ─────────────────
      // For inbound messages persisted via this service (rare — the WA
      // webhook writes directly), there's nothing to deliver.
      if (isOutbound && conv.channel?.type === 'whatsapp') {
        const adapter = await getWhatsAppAdapter(conv.tenantId)
        const recipientPhone = conv.customerPhone || conv.customer?.phone || ''
        if (adapter && recipientPhone) {
          try {
            const result = await adapter.sendText(recipientPhone, input.body)
            if (result.messageId) {
              await db.message.update({
                where: { id: msg.id },
                data: { waMessageId: result.messageId },
              })
            }
            log.info(
              { conversationId: input.conversationId, messageId: msg.id, waMessageId: result.messageId },
              'Message delivered via WhatsApp Cloud API',
            )
          } catch (deliveryErr) {
            // Mark the local message as failed but DON'T rethrow —
            // the agent should still see their attempted reply. The
            // error is captured for observability.
            captureError(deliveryErr as Error, {
              service: 'conversation',
              method: 'sendMessage:wa-deliver',
              conversationId: input.conversationId,
              messageId: msg.id,
            })
            await db.message
              .update({ where: { id: msg.id }, data: { status: 'failed' } })
              .catch(() => {})
            log.error(
              { conversationId: input.conversationId, messageId: msg.id, err: deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr) },
              'WhatsApp delivery failed — message persisted locally as failed',
            )
          }
        } else if (!adapter) {
          log.warn(
            { conversationId: input.conversationId, tenantId: conv.tenantId },
            'WhatsApp adapter not configured — message persisted locally only',
          )
        } else if (!recipientPhone) {
          log.warn(
            { conversationId: input.conversationId },
            'Cannot deliver outbound: conversation has no customerPhone',
          )
        }
      }

      // ── TTR: stamp firstReplyAt on first outbound reply ─────────────
      // Idempotent — `recordFirstReply` checks + short-circuits when
      // already set. Best-effort + non-blocking.
      if (isOutbound) {
        await recordFirstReply(input.conversationId).catch(() => {})
      }

      log.info(
        { conversationId: input.conversationId, messageId: msg.id, direction: msg.direction },
        'Message sent',
      )
      return msg
    } catch (err) {
      captureError(err as Error, {
        service: 'conversation',
        method: 'sendMessage',
        conversationId: input.conversationId,
      })
      throw new Error('Failed to send message')
    }
  },

  /**
   * Update status / priority / assignee. Used by the agent inbox.
   *
   * `tenantId` is accepted for symmetry with the read methods but is NOT
   * injected into the where clause — the caller is expected to have already
   * validated tenant access. (Defense-in-depth via RLS in PostgreSQL prod.)
   *
   * SPRINT-AI-FRONTEND-001 §3 — cuando el status cambia a `closed`, se
   * anula `pipelineMemory`. La memoria del orquestador es para
   * continuidad multi-turno en conversaciones activas; al cerrar, el
   * contexto persistente ya no aporta nada (un nuevo pipeline sobre la
   * misma conversación cerrada debería empezar desde cero). También
   * libera el storage JSON (~30 entries × ~500 bytes ≈ 15KB por
   * conversación cerrada — pequeño pero acumulativo en tablas grandes).
   *
   * Implementación: para saber si hay memoria que limpiar, hacemos un
   * `findUnique` select-only antes del update. Si la conversación ya
   * tiene `pipelineMemory: null` (la mayoría — sólo las conversaciones
   * que pasaron por `/api/orchestrate` con `action='full'` lo tienen
   * poblado), omitimos el campo del `update` para evitar writes
   * innecesarios. Best-effort: si el findUnique falla, omitimos la
   * limpieza (no rompemos el update de status).
   */
  async updateStatus(
    id: string,
    patch: { status?: string; priority?: string; assigneeId?: string | null },
    tenantId?: string,
  ) {
    try {
      // Construimos el `data` antes del update para poder inyectar
      // `pipelineMemory: null` condicionalmente al cerrar la conversación.
      const data: {
        status?: string
        priority?: string
        assigneeId?: string | null
        pipelineMemory?: null
      } = {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.priority ? { priority: patch.priority } : {}),
        ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
      }
      // SPRINT-AI-FRONTEND-001 §3 — al cerrar la conversación, limpiar la
      // pipeline memory persistida. Sólo incluimos el campo en el update
      // si la conversación tenía memoria poblada (evita writes
      // innecesarios y mantiene compatibilidad con callers que esperan
      // un `data` mínimo cuando no hay nada que limpiar). Idempotente.
      if (patch.status === 'closed') {
        try {
          const existing = await db.conversation.findUnique({
            where: { id },
            select: { pipelineMemory: true },
          })
          if (existing?.pipelineMemory) {
            data.pipelineMemory = null
          }
        } catch {
          // Best-effort: si el findUnique falla, proseguimos sin limpiar
          // — el update de status no debe fallar por esto.
        }
      }
      const updated = await db.conversation.update({
        where: { id },
        data,
      })
      log.info({ conversationId: id, patch, tenantId }, 'Conversation updated')
      return updated
    } catch (err) {
      captureError(err as Error, { service: 'conversation', method: 'updateStatus', id, tenantId })
      throw new Error('Failed to update conversation')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // LLM context reads — SPRINT-BACKEND-FINAL-001.
  //
  // Used by `/api/ai-reply` to load everything the LLM needs in a single
  // service seam: the conversation (with the 12 most recent messages +
  // customer + channel), the tenant's LLM provider, and a small catalog
  // slice for the system prompt.
  //
  // These are "context-only" reads — they do NOT clear the unread badge
  // (unlike `getConversationById` which does, on the assumption that the
  // caller is opening the thread in the UI). The ai-reply route runs in
  // the background of an already-open thread — clearing the badge would
  // be a side-effect the caller doesn't expect.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load a conversation with its 12 most recent messages + customer +
   * channel — the LLM context for the ai-reply route. Does NOT clear the
   * unread badge (see comment above).
   */
  async getConversationContextForAiReply(conversationId: string) {
    try {
      return await db.conversation.findUnique({
        where: { id: conversationId },
        include: {
          customer: true,
          channel: true,
          messages: { orderBy: { createdAt: 'asc' }, take: 12 },
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'conversation',
        method: 'getConversationContextForAiReply',
        conversationId,
      })
      throw new Error('Failed to fetch conversation context')
    }
  },

  /**
   * Fetch the tenant's LLM provider (`proveedorIa`). Used by the ai-reply
   * route to resolve the provider before the LLM call. Returns null when
   * the tenant doesn't exist — the route falls back to the adapter's
   * default provider.
   */
  async getTenantLlmProvider(tenantId: string) {
    try {
      return await db.tenant.findUnique({
        where: { id: tenantId },
        select: { proveedorIa: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'conversation',
        method: 'getTenantLlmProvider',
        tenantId,
      })
      // Non-blocking — the route can fall back to the default provider.
      return null
    }
  },

  /**
   * Fetch a small slice of the tenant's active catalog for the LLM system
   * prompt. Caps at `limit` (default 8) to keep the prompt compact.
   */
  async getCatalogContext(tenantId: string, limit = 8) {
    try {
      return await db.product.findMany({
        where: { active: true, tenantId },
        take: limit,
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'conversation',
        method: 'getCatalogContext',
        tenantId,
      })
      throw new Error('Failed to fetch catalog context')
    }
  },
}

export type ConversationService = typeof conversationService
