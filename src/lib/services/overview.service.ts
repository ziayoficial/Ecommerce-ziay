// ZIAY — Overview service layer.
//
// Aggregates KPIs across orders, conversations, ad spend, channels.
// Returns the same payload shape as `/api/overview` so the route can
// migrate to call this service without touching the frontend.
//
// SPRINT6-ARCH-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:overview')

export const overviewService = {
  /**
   * Compute overview KPIs + chart series for a tenant over `days`.
   * Returns: { range, kpis, channelSplit, series }
   *
   * Used by `/api/overview`.
   */
  async getKPIs(days: number, tenantId?: string) {
    try {
      const since = new Date()
      since.setDate(since.getDate() - days)

      const tenantFilter = tenantId ? { tenantId } : {}
      const orderWhere = { ...tenantFilter, createdAt: { gte: since } }
      const adSpendWhere = {
        date: { gte: since },
        ...(tenantId ? { ad: { campaign: { tenantId } } } : {}),
      }

      // AUDIT-GAP-4-DB N+1 #6: previously loaded ALL tenant orders (with items +
      // sourceAd JOIN) into memory and JS-reduced on totals/cost/channelSplit/day-series.
      // Push all sums/counts/groupBy to the DB:
      //   · revenue / revenuePaid / ordersCount → db.order.aggregate + count
      //   · paymentMode + channelSplit → db.order.groupBy
      //   · ad totals → db.adSpend.aggregate
      //   · cogs → db.orderItem.findMany (light select; Prisma can't sum(cost*quantity))
      //   · per-day series → minimal order/adSpend selects (no JOINs, no relations)
      const [
        revenueAgg,
        revenuePaidAgg,
        ordersCount,
        paymentModeGroups,
        channelGroups,
        channels,
        adSpendAgg,
        conversations,
        cogsItems,
        seriesOrders,
        seriesAdSpends,
      ] = await Promise.all([
        db.order.aggregate({
          where: orderWhere,
          _sum: { total: true },
        }),
        db.order.aggregate({
          where: { ...orderWhere, paymentStatus: 'paid' },
          _sum: { total: true },
        }),
        db.order.count({ where: orderWhere }),
        db.order.groupBy({
          by: ['paymentMode'],
          where: orderWhere,
          _count: { _all: true },
        }),
        db.order.groupBy({
          by: ['channelId'],
          where: orderWhere,
          _sum: { total: true },
          _count: { _all: true },
        }),
        db.channel.findMany({ where: tenantFilter }),
        db.adSpend.aggregate({
          where: adSpendWhere,
          _sum: { spend: true, impressions: true, clicks: true },
        }),
        db.conversation.count({
          where: { ...tenantFilter, createdAt: { gte: since } },
        }),
        // Light select (cost + quantity only) — Prisma can't express
        // `SUM(cost * quantity)` in aggregate, so we still JS-reduce but on a
        // much smaller payload (2 fields, no JOINs to Product/Order).
        db.orderItem.findMany({
          where: { order: orderWhere },
          select: { cost: true, quantity: true },
        }),
        db.order.findMany({
          where: orderWhere,
          select: { total: true, createdAt: true },
        }),
        db.adSpend.findMany({
          where: adSpendWhere,
          select: { spend: true, date: true },
        }),
      ])

      const revenue = revenueAgg._sum.total ?? 0
      const revenuePaid = revenuePaidAgg._sum.total ?? 0
      const totalSpend = adSpendAgg._sum.spend ?? 0
      const totalImpressions = adSpendAgg._sum.impressions ?? 0
      const totalClicks = adSpendAgg._sum.clicks ?? 0
      const cogs = cogsItems.reduce(
        (s, it) => s + it.cost * it.quantity,
        0,
      )
      const codOrders = paymentModeGroups.find((g) => g.paymentMode === 'cod')?._count._all ?? 0
      const advanceOrders = paymentModeGroups.find((g) => g.paymentMode === 'advance')?._count._all ?? 0

      const grossProfit = revenuePaid - cogs
      const netProfit = grossProfit - totalSpend
      const roi = totalSpend > 0 ? netProfit / totalSpend : 0
      const roas = totalSpend > 0 ? revenuePaid / totalSpend : 0
      const cpa = ordersCount > 0 ? totalSpend / ordersCount : 0

      const channelSplit = channels.map((ch) => {
        const grp = channelGroups.find((g) => g.channelId === ch.id)
        return {
          id: ch.id,
          name: ch.displayName,
          type: ch.type,
          orders: grp?._count._all ?? 0,
          revenue: grp?._sum.total ?? 0,
          strategy: ch.paymentStrategy,
        }
      })

      const dayMap = new Map<string, { revenue: number; spend: number; orders: number }>()
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        d.setHours(0, 0, 0, 0)
        const key = d.toISOString().slice(0, 10)
        dayMap.set(key, { revenue: 0, spend: 0, orders: 0 })
      }
      for (const o of seriesOrders) {
        const key = o.createdAt.toISOString().slice(0, 10)
        const e = dayMap.get(key)
        if (e) {
          e.revenue += o.total
          e.orders += 1
        }
      }
      for (const s of seriesAdSpends) {
        const key = s.date.toISOString().slice(0, 10)
        const e = dayMap.get(key)
        if (e) e.spend += s.spend
      }
      const series = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }))

      return {
        range: { days, since: since.toISOString() },
        kpis: {
          revenue,
          revenuePaid,
          orders: ordersCount,
          conversations,
          totalSpend,
          grossProfit,
          netProfit,
          roi: Number(roi.toFixed(2)),
          roas: Number(roas.toFixed(2)),
          cpa: Math.round(cpa),
          ctr:
            totalImpressions > 0
              ? Number(((totalClicks / totalImpressions) * 100).toFixed(2))
              : 0,
          aov: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
          advanceOrders,
          codOrders,
          advanceRate:
            ordersCount > 0
              ? Number(((advanceOrders / ordersCount) * 100).toFixed(1))
              : 0,
        },
        channelSplit,
        series,
      }
    } catch (err) {
      captureError(err as Error, { service: 'overview', method: 'getKPIs', tenantId, days })
      throw new Error('Failed to fetch overview KPIs')
    }
  },

  /**
   * Chart series only (no KPI cards) — used by the smaller charts that
   * don't need the full overview payload.
   */
  async getChartData(days: number, tenantId?: string) {
    try {
      const kpis = await this.getKPIs(days, tenantId)
      return { range: kpis.range, series: kpis.series }
    } catch (err) {
      captureError(err as Error, { service: 'overview', method: 'getChartData', tenantId, days })
      throw new Error('Failed to fetch chart data')
    }
  },
}

export type OverviewService = typeof overviewService
