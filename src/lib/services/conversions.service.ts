// ZIAY — Conversions service layer.
//
// Wraps server-side pixel firing persistence: PixelConfig + ConversionEvent.
// The actual platform firing (Meta CAPI / Google MP / TikTok Events API) lives
// in `src/lib/queue.ts` (`capi-fire` job) — this service owns the persistence
// seam so routes never touch `db.conversionEvent.*` / `db.pixelConfig.*` directly.
//
// SPRINT8-SERVICES-REST-001 — service layer.

import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'

// TD-7: `log` was declared but never used (the service uses `captureError`
// for error reporting instead of structured logging). Removed to silence
// `@typescript-eslint/no-unused-vars`. Re-add `getLogger('service:conversions')`
// here if you add structured log calls in the future.

export const conversionsService = {
  /**
   * List conversion events for a tenant (capped at 100) + status counts.
   * Used by `/api/conversions` GET.
   *
   * Returns `{ events, stats }` — `stats` is computed in-process so the
   * shape stays backward-compatible with the previous inline route logic.
   */
  async getEvents(tenantId: string) {
    try {
      const events = await db.conversionEvent.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      const sent = events.filter((e) => e.status === 'sent').length
      const failed = events.filter((e) => e.status === 'failed').length
      const pending = events.filter((e) => e.status === 'pending').length
      return {
        events,
        stats: { total: events.length, sent, failed, pending },
      }
    } catch (err) {
      captureError(err as Error, {
        service: 'conversions',
        method: 'getEvents',
        tenantId,
      })
      throw new Error('Failed to fetch conversion events')
    }
  },

  /**
   * Load all active pixel configs for a tenant. Returns the rows verbatim
   * (including apiToken) — callers are expected to treat the token as opaque
   * and only forward it to the queue handler. The handler redacts it from
   * any persisted response payload.
   */
  async getActivePixels(tenantId: string) {
    try {
      return await db.pixelConfig.findMany({
        where: { tenantId, active: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'conversions',
        method: 'getActivePixels',
        tenantId,
      })
      throw new Error('Failed to fetch pixel configs')
    }
  },

  /**
   * Persist a single ConversionEvent row. Used by the
   * "no active pixels" path and the per-pixel fan-out path.
   */
  async createEvent(input: {
    tenantId: string
    pixelConfigId: string | null
    eventType: string
    value?: number | null
    currency?: string
    status?: string
    response?: string
  }) {
    try {
      return await db.conversionEvent.create({
        data: {
          tenantId: input.tenantId,
          pixelConfigId: input.pixelConfigId,
          eventType: input.eventType,
          value: input.value ?? null,
          currency: input.currency ?? 'COP',
          status: input.status ?? 'pending',
          response: input.response ?? null,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'conversions',
        method: 'createEvent',
        tenantId: input.tenantId,
      })
      throw new Error('Failed to create conversion event')
    }
  },

  /**
   * Read back the freshly-created events by id. Used after the `capi-fire`
   * job runs inline so the HTTP response reflects the final status
   * ('sent' / 'failed' in inline mode, 'pending' in BullMQ mode).
   */
  async getEventsByIds(ids: string[]) {
    try {
      if (ids.length === 0) return []
      return await db.conversionEvent.findMany({
        where: { id: { in: ids } },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'conversions',
        method: 'getEventsByIds',
        count: ids.length,
      })
      throw new Error('Failed to fetch conversion events by id')
    }
  },
}

export type ConversionsService = typeof conversionsService
