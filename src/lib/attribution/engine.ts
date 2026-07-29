// CommerceFlow OS — Multi-touch attribution engine (Saramantha §5.2)
// Supports 4 attribution models:
//   - last_click (default): 100% credit to the last ad touched
//   - first_click: 100% credit to the first ad touched
//   - linear: equal credit across all ads touched
//   - time_decay: exponential decay, more recent ads get more credit
//
// The Attribution model already stores weight + model per touchpoint.
// This engine recomputes weights when the model changes and exposes per-ad
// credited revenue for the ads dashboard.

import { db } from '@/lib/db'

export type AttributionModel = 'last_click' | 'first_click' | 'linear' | 'time_decay'

/**
 * Recompute Attribution.weight for all attributions of a tenant, using the given model.
 * One order may have multiple Attribution rows (multi-touch). Weights sum to 1.0 per order.
 */
export async function recomputeAttributionWeights(tenantId: string, model: AttributionModel): Promise<{ ordersProcessed: number; attributionsUpdated: number }> {
  // Get all order IDs for this tenant
  const orders = await db.order.findMany({ where: { tenantId }, select: { id: true } })
  const orderIds = orders.map(o => o.id)

  // Get all attributions for those orders
  const allAttributions = await db.attribution.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: { createdAt: 'asc' },
  })

  // Group by orderId
  const byOrder = new Map<string, typeof allAttributions>()
  for (const a of allAttributions) {
    if (!byOrder.has(a.orderId)) byOrder.set(a.orderId, [])
    byOrder.get(a.orderId)!.push(a)
  }

  let updated = 0
  for (const [orderId, touches] of byOrder) {
    if (touches.length === 0) continue
    const weights = computeWeights(touches.map(t => t.createdAt), model)
    for (let i = 0; i < touches.length; i++) {
      await db.attribution.update({
        where: { id: touches[i].id },
        data: { weight: weights[i], model },
      })
      updated++
    }
  }

  return { ordersProcessed: byOrder.size, attributionsUpdated: updated }
}

/**
 * Compute weights for a set of touchpoints given the attribution model.
 * Returns an array of weights (summing to 1.0) aligned with the input timestamps.
 */
export function computeWeights(timestamps: Date[], model: AttributionModel): number[] {
  const n = timestamps.length
  if (n === 0) return []
  if (n === 1) return [1.0]

  switch (model) {
    case 'last_click': {
      const w = new Array(n).fill(0)
      w[n - 1] = 1.0
      return w
    }
    case 'first_click': {
      const w = new Array(n).fill(0)
      w[0] = 1.0
      return w
    }
    case 'linear': {
      return new Array(n).fill(1.0 / n)
    }
    case 'time_decay': {
      // Exponential decay: more recent touches get exponentially more credit.
      // Half-life = 7 days (touches older than 7 days get half the credit of recent ones).
      const sorted = timestamps.map((t, i) => ({ t, i })).sort((a, b) => a.t.getTime() - b.t.getTime())
      const halfLifeMs = 7 * 24 * 60 * 60 * 1000
      const earliest = sorted[0].t.getTime()
      const raw = sorted.map(s => Math.pow(2, -(earliest + (sorted[sorted.length - 1].t.getTime() - s.t.getTime()) ) / halfLifeMs))
      // Simpler: weight = 2^(-age_days / 7) where age = days since earliest
      const rawWeights = timestamps.map(t => {
        const ageDays = (timestamps[timestamps.length - 1].getTime() - t.getTime()) / (24 * 60 * 60 * 1000)
        return Math.pow(2, -ageDays / 7)
      })
      const sum = rawWeights.reduce((a, b) => a + b, 0)
      return rawWeights.map(w => w / sum)
    }
    default:
      return new Array(n).fill(1.0 / n)
  }
}

/**
 * Get credited revenue per ad for a tenant, using the given attribution model.
 * creditedRevenue = sum(order.total * attribution.weight) for all attributions of that ad.
 */
export async function getCreditedRevenueByAd(tenantId: string, model: AttributionModel): Promise<Array<{ adId: string; adName: string; creditedRevenue: number; creditedOrders: number }>> {
  // Attribution has no direct Order relation, so we fetch attributions + orders separately
  const attributions = await db.attribution.findMany({
    where: { model },
    include: { ad: { include: { campaign: true } } },
  })
  // Filter by tenant via ad.campaign.tenantId
  const tenantAttributions = attributions.filter(a => a.ad?.campaign?.tenantId === tenantId)
  // Load orders for these attributions
  const orderIds = [...new Set(tenantAttributions.map(a => a.orderId))]
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, total: true } })
  const orderMap = new Map(orders.map(o => [o.id, o.total]))

  const byAd = new Map<string, { adName: string; creditedRevenue: number; creditedOrders: number }>()
  for (const a of tenantAttributions) {
    const orderTotal = orderMap.get(a.orderId) || 0
    const entry = byAd.get(a.adId) || { adName: a.ad.name, creditedRevenue: 0, creditedOrders: 0 }
    entry.creditedRevenue += orderTotal * a.weight
    entry.creditedOrders += a.weight
    byAd.set(a.adId, entry)
  }

  return Array.from(byAd.entries()).map(([adId, v]) => ({
    adId,
    adName: v.adName,
    creditedRevenue: Math.round(v.creditedRevenue),
    creditedOrders: Number(v.creditedOrders.toFixed(2)),
  })).sort((a, b) => b.creditedRevenue - a.creditedRevenue)
}
