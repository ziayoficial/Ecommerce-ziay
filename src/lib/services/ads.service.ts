// ZIAY — Ads service layer.
//
// Wraps ad performance reads + the kill / pause / resume action surface.
// The platform-facing API calls (Meta / Google / TikTok) are still
// stubbed in the adapters — this service owns persistence only.
//
// SPRINT6-ARCH-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:ads')

export interface AdPerformanceFilters {
  days?: number
  platform?: string
  tenantId?: string
}

export const adsService = {
  /**
   * Performance breakdown per ad: spend, orders, CPA, ROAS, cannibalization
   * flag. Used by `/api/ads`.
   *
   * Returns the raw ads + spend + orders — the metric math (CPA, ROAS, …)
   * is intentionally NOT in the service so the route can keep its
   * presentation logic. The service only guarantees a safe DB read.
   */
  async getAds(filters: AdPerformanceFilters) {
    try {
      const days = filters.days ?? 14
      const since = new Date()
      since.setDate(since.getDate() - days)

      const ads = await db.ad.findMany({
        where: {
          ...(filters.platform && filters.platform !== 'all'
            ? { campaign: { platformId: `ap-${filters.platform}` } }
            : {}),
          ...(filters.tenantId ? { campaign: { tenantId: filters.tenantId } } : {}),
        },
        include: {
          campaign: { include: { platform: true } },
          spend: { where: { date: { gte: since } } },
          orders: {
            where: { createdAt: { gte: since } },
            include: { items: true },
          },
        },
      })
      return ads
    } catch (err) {
      captureError(err as Error, { service: 'ads', method: 'getAds', filters })
      throw new Error('Failed to fetch ads')
    }
  },

  /**
   * Update ad status (pause / kill / resume / scale) + write an audit log
   * entry. Both writes are best-effort: a missing audit log should not
   * roll back the actual ad status change.
   */
  async updateAd(
    id: string,
    patch: {
      status: string
      autoKill?: boolean
      killReason?: string | null
      userId?: string | null
      action?: string
      reason?: string
    },
  ) {
    try {
      const updated = await db.ad.update({
        where: { id },
        data: {
          status: patch.status,
          autoKill: patch.autoKill ?? false,
          killReason: patch.killReason ?? null,
        },
      })
      try {
        await db.auditLog.create({
          data: {
            userId: patch.userId || null,
            action: `ad.${patch.action || 'update'}`,
            entity: 'Ad',
            entityId: id,
            metadata: JSON.stringify({
              reason: patch.reason,
              status: updated.status,
            }),
          },
        })
      } catch (auditErr) {
        // Audit failure is non-fatal — capture but don't surface to caller.
        captureError(auditErr as Error, {
          service: 'ads',
          method: 'updateAd:audit',
          adId: id,
        })
      }
      log.info({ adId: id, action: patch.action, status: patch.status }, 'Ad updated')
      return updated
    } catch (err) {
      captureError(err as Error, { service: 'ads', method: 'updateAd', id })
      throw new Error('Failed to update ad')
    }
  },

  /**
   * Lookup an Ad by its external platform id (e.g. the Meta/Google/TikTok
   * ad id returned by the adapter). Includes the parent Campaign so the
   * caller can verify the ad belongs to the right tenant.
   *
   * Used by `/api/ads/import` to map adapter-reported ad ids to internal
   * Ad rows before upserting AdSpend.
   */
  async findAdByExternalId(externalId: string) {
    try {
      return await db.ad.findUnique({
        where: { externalId },
        include: { campaign: { select: { tenantId: true } } },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'ads',
        method: 'findAdByExternalId',
        externalId,
      })
      throw new Error('Failed to fetch ad by external id')
    }
  },

  /**
   * Bulk import ad spend rows from an adapter (Meta / Google / TikTok).
   * Each row is keyed by (adId, date) — duplicates are upserted.
   */
  async importAdSpend(
    rows: Array<{
      adId: string
      date: Date
      spend: number
      impressions: number
      clicks: number
      convReported?: number
    }>,
  ) {
    try {
      const result = await db.$transaction(
        rows.map((r) =>
          db.adSpend.upsert({
            where: { adId_date: { adId: r.adId, date: r.date } },
            update: {
              spend: r.spend,
              impressions: r.impressions,
              clicks: r.clicks,
              convReported: r.convReported ?? 0,
            },
            create: {
              adId: r.adId,
              date: r.date,
              spend: r.spend,
              impressions: r.impressions,
              clicks: r.clicks,
              convReported: r.convReported ?? 0,
            },
          }),
        ),
      )
      log.info({ count: result.length }, 'Ad spend imported')
      return result
    } catch (err) {
      captureError(err as Error, { service: 'ads', method: 'importAdSpend' })
      throw new Error('Failed to import ad spend')
    }
  },
}

export type AdsService = typeof adsService
