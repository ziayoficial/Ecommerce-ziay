// ZIAY — Order service layer.
//
// Encapsulates ALL database access for orders. API routes should call
// `orderService` instead of `db.order.*` directly so that:
//   1. Every read/write is wrapped in try/catch + captureError.
//   2. The error surface is uniform ("Failed to fetch orders" etc.) —
//      callers never see raw Prisma errors.
//   3. Future refactors (caching, multi-tenant RLS hooks, observability)
//      have a single seam to land in.
//
// SPRINT6-ARCH-001 — service layer.
//
// NOTE: This file is NEW. The API routes still call `db` directly today;
// they will be migrated to call this service in a follow-up sprint. The
// signatures here match the read/write patterns used by the top routes
// (`/api/orders`, `/api/orders/[id]`, `/api/overview`, kanban view).

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:order')

export interface OrderFilters {
  status?: string
  channel?: string
  mode?: string
  q?: string
}

export const orderService = {
  /**
   * Paginated list of orders for a tenant with optional filters.
   * Used by `/api/orders?tenantId=...&status=...&mode=...&q=...`.
   */
  async getOrders(tenantId: string | undefined, filters?: OrderFilters) {
    try {
      return await db.order.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          ...(filters?.status && filters.status !== 'all' ? { status: filters.status } : {}),
          ...(filters?.mode && filters.mode !== 'all' ? { paymentMode: filters.mode } : {}),
          ...(filters?.channel && filters.channel !== 'all' ? { channelId: filters.channel } : {}),
          ...(filters?.q ? { number: { contains: filters.q } } : {}),
        },
        include: {
          customer: true,
          items: true,
          sourceAd: { include: { campaign: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    } catch (err) {
      captureError(err as Error, { service: 'order', method: 'getOrders', tenantId })
      throw new Error('Failed to fetch orders')
    }
  },

  /**
   * Single order with full relations for the detail view.
   */
  async getOrderById(id: string, tenantId?: string) {
    try {
      return await db.order.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
        include: {
          customer: true,
          items: true,
          events: { orderBy: { createdAt: 'desc' } },
          shipments: true,
          sourceAd: { include: { campaign: true } },
        },
      })
    } catch (err) {
      captureError(err as Error, { service: 'order', method: 'getOrderById', id, tenantId })
      throw new Error('Failed to fetch order')
    }
  },

  /**
   * Update order fields. When an `event` is supplied the update + event
   * insert are wrapped in a single `$transaction` so the audit trail can
   * never diverge from the order state.
   */
  async updateOrder(
    id: string,
    data: Record<string, unknown>,
    event?: { type: string; note?: string },
  ) {
    try {
      if (event) {
        // Two writes that must be atomic: order update + event insert.
        const [updated] = await db.$transaction([
          db.order.update({ where: { id }, data }),
          db.orderEvent.create({
            data: { orderId: id, type: event.type, note: event.note },
          }),
        ])
        log.info({ orderId: id, eventType: event.type }, 'Order updated with event')
        return updated
      }
      const updated = await db.order.update({ where: { id }, data })
      log.info({ orderId: id }, 'Order updated')
      return updated
    } catch (err) {
      captureError(err as Error, { service: 'order', method: 'updateOrder', id })
      throw new Error('Failed to update order')
    }
  },

  /**
   * Lightweight projection used by the kanban view (no items, no events).
   * Caps at 200 so the board never renders thousands of cards.
   */
  async getOrdersForKanban(tenantId: string) {
    try {
      return await db.order.findMany({
        where: { tenantId },
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          paymentMode: true,
          paymentStatus: true,
          createdAt: true,
          customer: { select: { id: true, name: true, phone: true } },
          sourceAd: { select: { id: true, name: true, externalId: true } },
          sourceCampaign: true,
          sourcePlatform: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    } catch (err) {
      captureError(err as Error, { service: 'order', method: 'getOrdersForKanban', tenantId })
      throw new Error('Failed to fetch kanban orders')
    }
  },

  /**
   * Revenue + funnel aggregation for the overview KPI cards. Kept here
   * (rather than overview.service.ts) because it is a pure order query.
   */
  async getRevenueSince(tenantId: string | undefined, since: Date) {
    try {
      return await db.order.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          createdAt: { gte: since },
        },
        include: { items: true },
      })
    } catch (err) {
      captureError(err as Error, { service: 'order', method: 'getRevenueSince', tenantId })
      throw new Error('Failed to fetch revenue orders')
    }
  },
}

export type OrderService = typeof orderService
