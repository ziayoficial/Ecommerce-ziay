// ZIAY — Logistics intelligence service layer.
//
// Wraps CustomerScore, CarrierScore, GuideTracking, BehaviorAlert, and
// BuyerBehavior reads — the intelligence-layer tables that power the
// logistics-intelligence dashboard.
//
// SPRINT6-ARCH-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:logistics')

export const logisticsService = {
  /**
   * Customer-score leaderboard for the tenant. Used to flag devolvedores
   * (returners) vs. confiables (reliable buyers).
   */
  async getScores(tenantId: string) {
    try {
      return await db.customerScore.findMany({
        where: { tenantId },
        orderBy: { score: 'desc' },
      })
    } catch (err) {
      captureError(err as Error, { service: 'logistics', method: 'getScores', tenantId })
      throw new Error('Failed to fetch customer scores')
    }
  },

  /**
   * Stuck guides — either status='stuck' OR daysStuck > 3.
   * Capped at 100 so the dashboard never renders thousands of rows.
   */
  async getStuckGuides(tenantId: string) {
    try {
      return await db.guideTracking.findMany({
        where: {
          tenantId,
          OR: [{ status: 'stuck' }, { daysStuck: { gt: 3 } }],
        },
        orderBy: { daysStuck: 'desc' },
        take: 100,
      })
    } catch (err) {
      captureError(err as Error, { service: 'logistics', method: 'getStuckGuides', tenantId })
      throw new Error('Failed to fetch stuck guides')
    }
  },

  /**
   * Behavior alerts (anomalous buyer patterns). Hydrates the
   * buyerBehavior relation manually since the schema uses a raw
   * `buyerBehaviorId` String instead of a Prisma relation.
   */
  async getAlerts(tenantId: string) {
    try {
      const alerts = await db.behaviorAlert.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      const behaviorIds = Array.from(
        new Set(alerts.map((a) => a.buyerBehaviorId).filter(Boolean)),
      )
      const behaviors = behaviorIds.length
        ? await db.buyerBehavior.findMany({ where: { id: { in: behaviorIds } } })
        : []
      const behaviorMap = new Map(behaviors.map((b) => [b.id, b]))
      return alerts.map((a) => ({
        ...a,
        buyerBehavior: a.buyerBehaviorId ? behaviorMap.get(a.buyerBehaviorId) ?? null : null,
      }))
    } catch (err) {
      captureError(err as Error, { service: 'logistics', method: 'getAlerts', tenantId })
      throw new Error('Failed to fetch alerts')
    }
  },

  /**
   * Carrier scores — used by the carrier-performance panel. Returns
   * all carriers for the tenant sorted by score.
   */
  async getCarrierScores(tenantId: string) {
    try {
      return await db.carrierScore.findMany({
        where: { tenantId },
        orderBy: { score: 'desc' },
      })
    } catch (err) {
      captureError(err as Error, { service: 'logistics', method: 'getCarrierScores', tenantId })
      throw new Error('Failed to fetch carrier scores')
    }
  },

  /**
   * Convenience: load scores + stuck guides + alerts in parallel — the
   * dashboard always needs all three. Hydrates behaviors on alerts.
   * Returns the same shape as `/api/logistics-intelligence`.
   */
  async getDashboardData(tenantId: string) {
    try {
      const [customerScores, carrierScores, stuckGuides, alerts] = await Promise.all([
        this.getScores(tenantId),
        this.getCarrierScores(tenantId),
        this.getStuckGuides(tenantId),
        this.getAlerts(tenantId),
      ])

      const confiables = customerScores.filter(
        (c) => c.category === 'confiable' || c.score >= 50,
      ).length
      const riesgo = customerScores.filter(
        (c) => c.category === 'riesgo' || (c.score >= 1 && c.score < 50),
      ).length
      const devolvedores = customerScores.filter(
        (c) => c.category === 'devolvedor' || c.score === 0,
      ).length

      return {
        customerScores,
        carrierScores,
        stuckGuides,
        alerts,
        stats: {
          confiables,
          riesgo,
          devolvedores,
          stuckCount: stuckGuides.length,
          totalCustomers: customerScores.length,
          totalCarriers: carrierScores.length,
          totalAlerts: alerts.length,
        },
      }
    } catch (err) {
      captureError(err as Error, { service: 'logistics', method: 'getDashboardData', tenantId })
      throw new Error('Failed to fetch logistics dashboard data')
    }
  },
}

export type LogisticsService = typeof logisticsService
