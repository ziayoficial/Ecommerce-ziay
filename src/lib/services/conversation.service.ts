// ZIAY — Conversation service layer.
//
// Wraps ALL DB access for conversations + messages. API routes that
// currently call `db.conversation.*` / `db.message.*` directly should
// migrate to call this service in a follow-up sprint.
//
// SPRINT6-ARCH-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:conversation')

export interface ConversationFilters {
  status?: string
  channel?: string
  q?: string
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
   * Used by `/api/conversations`.
   */
  async getConversations(tenantId: string | undefined, filters?: ConversationFilters) {
    try {
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
        take: 200,
      })
    } catch (err) {
      captureError(err as Error, { service: 'conversation', method: 'getConversations', tenantId })
      throw new Error('Failed to fetch conversations')
    }
  },

  /**
   * Single conversation with full message history + recent orders.
   * Used by `/api/conversations/[id]`.
   */
  async getConversationById(id: string) {
    try {
      const conv = await db.conversation.findUnique({
        where: { id },
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
   * Note: the actual WhatsApp/Messenger delivery is handled by the
   * channel adapter layer — this only persists the local message.
   */
  async sendMessage(input: SendMessageInput) {
    try {
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
   */
  async updateStatus(
    id: string,
    patch: { status?: string; priority?: string; assigneeId?: string | null },
  ) {
    try {
      const updated = await db.conversation.update({
        where: { id },
        data: {
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.priority ? { priority: patch.priority } : {}),
          ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
        },
      })
      log.info({ conversationId: id, patch }, 'Conversation updated')
      return updated
    } catch (err) {
      captureError(err as Error, { service: 'conversation', method: 'updateStatus', id })
      throw new Error('Failed to update conversation')
    }
  },
}

export type ConversationService = typeof conversationService
