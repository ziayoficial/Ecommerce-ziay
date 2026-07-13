import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { withCache } from '@/lib/cache'
import { captureError } from '@/lib/capture-error'

// Overview KPIs: revenue, orders, conversations, ad spend, ROAS, CPA, channel split.
// Cached for 60s per (tenantId, days) — heavy multi-table aggregation that
// doesn't need to be re-run on every page reload. Cache key includes the
// tenantId to avoid cross-tenant data leaks.
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const days = Number(req.nextUrl.searchParams.get('days') || '14')
    const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined

    const payload = await withCache(
      `overview:${tenantId ?? 'all'}:${days}`,
      60_000,
      () => computeOverview(days, tenantId),
    )
    return NextResponse.json(payload)
  } catch (err) {
    captureError(err as Error, { path: '/api/overview', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

async function computeOverview(days: number, tenantId: string | undefined) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const tenantFilter = tenantId ? { tenantId } : {}
  const [orders, conversations, adSpends, channels] = await Promise.all([
    db.order.findMany({
      where: { ...tenantFilter, createdAt: { gte: since } },
      include: { items: true, sourceAd: true },
    }),
    db.conversation.count({ where: { ...tenantFilter, createdAt: { gte: since } } }),
    db.adSpend.findMany({
      where: { date: { gte: since }, ...(tenantId ? { ad: { campaign: { tenantId } } } : {}) },
      include: { ad: { include: { campaign: true } } },
    }),
    db.channel.findMany({ where: tenantFilter }),
  ])

  const revenue = orders.reduce((s, o) => s + o.total, 0)
  const paidOrders = orders.filter(o => o.paymentStatus === 'paid')
  const revenuePaid = paidOrders.reduce((s, o) => s + o.total, 0)
  const codOrders = orders.filter(o => o.paymentMode === 'cod')
  const advanceOrders = orders.filter(o => o.paymentMode === 'advance')
  const totalSpend = adSpends.reduce((s, a) => s + a.spend, 0)
  const totalImpressions = adSpends.reduce((s, a) => s + a.impressions, 0)
  const totalClicks = adSpends.reduce((s, a) => s + a.clicks, 0)

  const cogs = orders.reduce((s, o) => s + o.items.reduce((ss, it) => ss + it.cost * it.quantity, 0), 0)
  const grossProfit = revenuePaid - cogs
  const netProfit = grossProfit - totalSpend
  const roi = totalSpend > 0 ? netProfit / totalSpend : 0
  const roas = totalSpend > 0 ? revenuePaid / totalSpend : 0
  const cpa = orders.length > 0 ? totalSpend / orders.length : 0

  const channelSplit = channels.map(ch => {
    const chOrders = orders.filter(o => o.channelId === ch.id)
    const chRev = chOrders.reduce((s, o) => s + o.total, 0)
    return { id: ch.id, name: ch.displayName, type: ch.type, orders: chOrders.length, revenue: chRev, strategy: ch.paymentStrategy }
  })

  const dayMap = new Map<string, { revenue: number; spend: number; orders: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0)
    const key = d.toISOString().slice(0, 10)
    dayMap.set(key, { revenue: 0, spend: 0, orders: 0 })
  }
  for (const o of orders) {
    const key = o.createdAt.toISOString().slice(0, 10)
    const e = dayMap.get(key); if (e) { e.revenue += o.total; e.orders += 1 }
  }
  for (const s of adSpends) {
    const key = s.date.toISOString().slice(0, 10)
    const e = dayMap.get(key); if (e) { e.spend += s.spend }
  }
  const series = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }))

  return {
    range: { days, since: since.toISOString() },
    kpis: {
      revenue,
      revenuePaid,
      orders: orders.length,
      conversations,
      totalSpend,
      grossProfit,
      netProfit,
      roi: Number(roi.toFixed(2)),
      roas: Number(roas.toFixed(2)),
      cpa: Math.round(cpa),
      ctr: totalImpressions > 0 ? Number((totalClicks / totalImpressions * 100).toFixed(2)) : 0,
      aov: orders.length > 0 ? Math.round(revenue / orders.length) : 0,
      advanceOrders: advanceOrders.length,
      codOrders: codOrders.length,
      advanceRate: orders.length > 0 ? Number((advanceOrders.length / orders.length * 100).toFixed(1)) : 0,
    },
    channelSplit,
    series,
  }
}
