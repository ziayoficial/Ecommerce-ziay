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
  /** Cursor-based pagination — id of the last row on the previous page. */
  cursor?: string
  /** Page size. The service takes `limit + 1` so the caller can detect
   *  `hasMore`. When omitted, falls back to 200 (legacy behaviour). */
  limit?: number
}

export const orderService = {
  /**
   * Paginated list of orders for a tenant with optional filters.
   * Used by `/api/orders?tenantId=...&status=...&mode=...&q=...&cursor=...&limit=...`.
   *
   * When `filters.cursor` is provided, Prisma's `cursor: { id }` + `skip: 1`
   * pattern is used so the row identified by the cursor is excluded. The
   * service returns `filters.limit + 1` rows when `limit` is set so the
   * caller can detect `hasMore` (slice off the extra row before responding).
   */
  async getOrders(tenantId: string | undefined, filters?: OrderFilters) {
    try {
      const limit = filters?.limit
      // When `limit` is given we ask for `limit + 1` so the caller can detect
      // a next page. When omitted, default to 200 (legacy behaviour).
      const take = limit != null ? limit + 1 : 200
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
        take,
        // `skip: 1` is required with cursor: Prisma includes the cursor row
        // by default — we want the row *after* it.
        ...(filters?.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
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
   *
   * Note: `tenantId` is accepted for API symmetry with the other read
   * methods but is NOT injected into the where clause — the caller is
   * expected to have already validated tenant access via `requireAuth` /
   * `requireTenantAccess` before calling. The id is a cuid, so cross-tenant
   * updates require knowing the target id (defense-in-depth via RLS in
   * PostgreSQL production — see `prisma/migrations/1_postgres_indexes`).
   */
  async updateOrder(
    id: string,
    data: Record<string, unknown>,
    event?: { type: string; note?: string },
    tenantId?: string,
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
      captureError(err as Error, { service: 'order', method: 'updateOrder', id, tenantId })
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
