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

  // ─────────────────────────────────────────────────────────────────────────
  // Guide movements + buyer behavior — added in SPRINT8-SERVICES-REST-001
  // to migrate `/api/guide-movements` and `/api/buyer-behavior`. Both
  // tables already belong to the logistics domain (GuideMovement extends
  // GuideTracking, BuyerBehavior powers the customer-score panel).
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List GuideMovement rows for a tenant, optionally filtered by guideNumber.
   * Caps at 200 when a guideNumber is given (full history) or 100 (tenant-wide).
   * Mirrors the prior inline route logic verbatim.
   */
  async getGuideMovements(tenantId: string, guideNumber?: string) {
    try {
      const where: { tenantId: string; guideNumber?: string } = { tenantId }
      if (guideNumber) where.guideNumber = guideNumber
      return await db.guideMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: guideNumber ? 200 : 100,
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'logistics',
        method: 'getGuideMovements',
        tenantId,
        guideNumber,
      })
      throw new Error('Failed to fetch guide movements')
    }
  },

  /**
   * Persist a GuideMovement + best-effort cascade the estado onto matching
   * Shipment rows. The Shipment updateMany is wrapped in a try/catch inside
   * the service — failure must not roll back the movement itself.
   */
  async createGuideMovement(input: {
    tenantId: string
    guideNumber: string
    eventType: string
    location?: string | null
    description?: string | null
    carrierName?: string | null
  }) {
    try {
      const movement = await db.guideMovement.create({
        data: {
          tenantId: input.tenantId,
          guideNumber: String(input.guideNumber),
          eventType: input.eventType,
          location: input.location ?? null,
          description: input.description ?? null,
          carrierName: input.carrierName ?? null,
        },
      })

      // Best-effort: if the movement is a delivery, also update the Shipment.estado.
      // Mirrors the prior inline route logic.
      if (
        input.eventType === 'delivered' ||
        input.eventType === 'in_transit' ||
        input.eventType === 'returned' ||
        input.eventType === 'exception'
      ) {
        try {
          const estadoMap: Record<string, string> = {
            in_transit: 'en_transito',
            delivered: 'entregada',
            returned: 'devuelta',
            exception: 'novedad',
          }
          const targetEstado = estadoMap[input.eventType]
          if (targetEstado) {
            await db.shipment.updateMany({
              where: { tenantId: input.tenantId, numeroGuia: String(input.guideNumber) },
              data: { estado: targetEstado },
            })
          }
        } catch {
          // Shipment update is best-effort; do not fail the movement creation.
        }
      }
      return movement
    } catch (err) {
      captureError(err as Error, {
        service: 'logistics',
        method: 'createGuideMovement',
        tenantId: input.tenantId,
        guideNumber: input.guideNumber,
      })
      throw new Error('Failed to create guide movement')
    }
  },

  /**
   * Lookup an order with its items + customer for shipment generation.
   * Used by `/api/shipping/guide` before calling the LogisticsAdapter.
   */
  async getOrderForShipment(tenantId: string, orderId: string) {
    try {
      return await db.order.findFirst({
        where: { tenantId, id: orderId },
        include: { items: true, customer: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'logistics',
        method: 'getOrderForShipment',
        tenantId,
        orderId,
      })
      throw new Error('Failed to fetch order for shipment')
    }
  },

  /**
   * Atomic shipment-guide generation: persist Shipment, update Order status
   * + shipping fee, write OrderEvent (shipped), write AuditLog. Mirrors the
   * prior inline route logic — every write is required, but the route keeps
   * them sequential (no $transaction) for the same reason as before: the
   * carrier adapter already pushed the guide to the carrier by the time we
   * get here, so a rollback wouldn't un-generate the carrier-side guide.
   *
   * Returns the persisted Shipment + the stamped OrderEvent note.
   */
  async persistShipmentGuide(input: {
    tenantId: string
    orderId: string
    customerId: string
    proveedor: string
    numeroGuia: string
    urlSeguimiento?: string | null
    transportadora: string
    transportadoraCanonica: string
    tarifa: number
    tiempoEstimadoDias: number
    orderNumber: string
  }) {
    try {
      const shipment = await db.shipment.create({
        data: {
          tenantId: input.tenantId,
          orderId: input.orderId,
          proveedor: input.proveedor,
          numeroGuia: input.numeroGuia,
          urlSeguimiento: input.urlSeguimiento ?? null,
          transportadora: input.transportadora,
          transportadoraCanonica: input.transportadoraCanonica,
          tarifa: input.tarifa,
          tiempoEstimadoDias: input.tiempoEstimadoDias,
          estado: 'generada',
        },
      })
      await db.order.update({
        where: { id: input.orderId },
        data: { status: 'shipped', shipping: input.tarifa },
      })
      const eventNote = `Guía ${input.numeroGuia} (${input.transportadoraCanonica}) — $${input.tarifa} COP, ETA ${input.tiempoEstimadoDias} días`
      await db.orderEvent.create({
        data: {
          orderId: input.orderId,
          type: 'shipped',
          note: eventNote,
        },
      })
      await db.auditLog.create({
        data: {
          tenantId: input.tenantId,
          action: 'shipping_guide_generated',
          entity: 'shipment',
          entityId: shipment.id,
          meta: JSON.stringify({
            orderId: input.orderId,
            numero_guia: input.numeroGuia,
            transportadora: input.transportadora,
            transportadoraCanonica: input.transportadoraCanonica,
            tarifa: input.tarifa,
          }),
        },
      })
      return { shipment, eventNote }
    } catch (err) {
      captureError(err as Error, {
        service: 'logistics',
        method: 'persistShipmentGuide',
        tenantId: input.tenantId,
        orderId: input.orderId,
      })
      throw new Error('Failed to persist shipment guide')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Buyer behavior — `/api/buyer-behavior` GET + POST.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List BuyerBehavior rows for a tenant + per-risk-level counts.
   * Returns `{ behaviors, stats }` — `stats` is a flat record keyed by
   * risk level (`normal` / `caution` / `high_risk` / `blacklist`).
   */
  async getBuyerBehaviors(tenantId: string) {
    try {
      const [rows, grouped] = await Promise.all([
        db.buyerBehavior.findMany({
          where: { tenantId },
          orderBy: { updatedAt: 'desc' },
        }),
        db.buyerBehavior.groupBy({
          by: ['riskLevel'],
          where: { tenantId },
          _count: { _all: true },
        }),
      ])
      const counts: Record<string, number> = {
        normal: 0,
        caution: 0,
        high_risk: 0,
        blacklist: 0,
      }
      for (const s of grouped) counts[s.riskLevel] = s._count._all
      return { behaviors: rows, stats: counts }
    } catch (err) {
      captureError(err as Error, {
        service: 'logistics',
        method: 'getBuyerBehaviors',
        tenantId,
      })
      throw new Error('Failed to fetch buyer behaviors')
    }
  },

  /**
   * Upsert a BuyerBehavior row keyed by (tenantId, phone). When the new
   * risk level is `high_risk` or `blacklist`, also create a BehaviorAlert
   * so the team is notified. Returns `{ behavior, alert }` — `alert` is
   * null for `normal` / `caution` levels.
   */
  async upsertBuyerBehavior(input: {
    tenantId: string
    phone: string
    riskLevel: string
    patternDetails?: string | null
  }) {
    try {
      const behavior = await db.buyerBehavior.upsert({
        where: { tenantId_phone: { tenantId: input.tenantId, phone: String(input.phone) } },
        create: {
          tenantId: input.tenantId,
          phone: String(input.phone),
          riskLevel: input.riskLevel,
          patternDetails: input.patternDetails ?? null,
        },
        update: {
          riskLevel: input.riskLevel,
          patternDetails: input.patternDetails ?? null,
        },
      })

      let alert: { id: string } | null = null
      if (input.riskLevel === 'high_risk' || input.riskLevel === 'blacklist') {
        alert = await db.behaviorAlert.create({
          data: {
            tenantId: input.tenantId,
            buyerBehaviorId: behavior.id,
            alertType: input.riskLevel,
            message: input.patternDetails
              ? `Cliente ${input.phone} marcado como ${input.riskLevel}: ${input.patternDetails}`
              : `Cliente ${input.phone} marcado como ${input.riskLevel}`,
          },
          select: { id: true },
        })
      }
      return { behavior, alert }
    } catch (err) {
      captureError(err as Error, {
        service: 'logistics',
        method: 'upsertBuyerBehavior',
        tenantId: input.tenantId,
        phone: input.phone,
      })
      throw new Error('Failed to upsert buyer behavior')
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
