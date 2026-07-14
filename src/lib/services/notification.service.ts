// ZIAY — Notification service layer.
//
// Wraps CustomerNotification access — manual + auto-generated customer-facing
// messages (shipping updates, delivery confirmations, remarketing nudges).
// Auto-generation reaches into GuideTracking (logistics domain) to detect
// guides that are `in_transit` but lack a notification yet.
//
// SPRINT8-SERVICES-REST-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:notifications')

export interface CreateNotificationInput {
  tenantId: string
  customerPhone: string
  customerName?: string | null
  type: string
  channel?: string
  body: string
  scheduledAt?: Date | null
  metadata?: string | null
}

export const notificationService = {
  /**
   * List notifications for a tenant + status filter, capped at 200.
   * Also returns global stats (all-status counts) so the UI badges stay
   * accurate regardless of the active filter.
   */
  async getNotifications(tenantId: string, status?: string) {
    try {
      const where: { tenantId: string; status?: string } = { tenantId }
      if (status) where.status = status

      const [notifications, all] = await Promise.all([
        db.customerNotification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        db.customerNotification.findMany({ where: { tenantId } }),
      ])

      const stats = {
        total: all.length,
        pending: all.filter((n) => n.status === 'pending').length,
        sent: all.filter((n) => n.status === 'sent').length,
        delivered: all.filter((n) => n.status === 'delivered').length,
        failed: all.filter((n) => n.status === 'failed').length,
      }
      return { notifications, stats }
    } catch (err) {
      captureError(err as Error, {
        service: 'notifications',
        method: 'getNotifications',
        tenantId,
      })
      throw new Error('Failed to fetch notifications')
    }
  },

  /**
   * Persist a new notification row. Default channel is `whatsapp` and
   * default status is `pending` — matches the route's pre-migration shape.
   */
  async createNotification(input: CreateNotificationInput) {
    try {
      return await db.customerNotification.create({
        data: {
          tenantId: input.tenantId,
          customerPhone: input.customerPhone,
          customerName: input.customerName ?? null,
          type: input.type,
          channel: input.channel || 'whatsapp',
          body: input.body,
          status: 'pending',
          scheduledAt: input.scheduledAt ?? null,
          metadata: input.metadata ?? null,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'notifications',
        method: 'createNotification',
        tenantId: input.tenantId,
      })
      throw new Error('Failed to create notification')
    }
  },

  /**
   * Update a notification's status (sent / delivered / failed). When
   * transitioning to `sent`, stamps `sentAt` — mirroring the prior
   * inline route behaviour.
   */
  async updateStatus(id: string, status: string, opts?: { sentAt?: Date }) {
    try {
      const data: Record<string, unknown> = { status }
      if (status === 'sent' || status === 'delivered') {
        data.sentAt = opts?.sentAt ?? new Date()
      }
      return await db.customerNotification.update({
        where: { id },
        data,
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'notifications',
        method: 'updateStatus',
        id,
        status,
      })
      throw new Error('Failed to update notification status')
    }
  },

  /**
   * Bulk-cancel stale pending notifications older than `cutoff`. Marks them
   * `failed` so they don't pile up in the outbox. Returns the number of rows
   * affected (Prisma `updateMany` count).
   */
  async cancelPendingBefore(tenantId: string, cutoff: Date) {
    try {
      const result = await db.customerNotification.updateMany({
        where: {
          tenantId,
          status: 'pending',
          createdAt: { lt: cutoff },
        },
        data: { status: 'failed' },
      })
      return result.count
    } catch (err) {
      captureError(err as Error, {
        service: 'notifications',
        method: 'cancelPendingBefore',
        tenantId,
      })
      throw new Error('Failed to cancel pending notifications')
    }
  },

  /**
   * Auto-generate shipping-update notifications for guides that are
   * `in_transit` but don't yet have a notification. Looks up GuideTracking
   * rows for the tenant (capped at 50), skips any whose guideNumber already
   * appears in a `shipping_update` notification's metadata, and creates
   * the rest.
   *
   * Returns the created notification rows.
   */
  async autoGenerateShippingUpdates(tenantId: string) {
    try {
      const guides = await db.guideTracking.findMany({
        where: { tenantId, status: 'in_transit' },
        take: 50,
      })
      const created: Awaited<ReturnType<typeof db.customerNotification.create>>[] = []
      for (const g of guides) {
        const exists = await db.customerNotification.findFirst({
          where: {
            tenantId,
            type: 'shipping_update',
            metadata: { contains: g.guideNumber },
          },
          select: { id: true },
        })
        if (exists) continue
        const n = await db.customerNotification.create({
          data: {
            tenantId,
            // The original route persisted `carrierName || 'unknown'` here.
            // Preserving the exact shape for backward compat.
            customerPhone: g.carrierName || 'unknown',
            customerName: null,
            type: 'shipping_update',
            channel: 'whatsapp',
            body: `Tu pedido con guía ${g.guideNumber} está en camino.`,
            status: 'pending',
            metadata: JSON.stringify({ guideNumber: g.guideNumber }),
          },
        })
        created.push(n)
      }
      log.info(
        { tenantId, candidates: guides.length, created: created.length },
        'auto-generated shipping notifications',
      )
      return created
    } catch (err) {
      captureError(err as Error, {
        service: 'notifications',
        method: 'autoGenerateShippingUpdates',
        tenantId,
      })
      throw new Error('Failed to auto-generate notifications')
    }
  },
}

export type NotificationService = typeof notificationService
