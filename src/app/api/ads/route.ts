import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Ad-level performance: per-ad sales qty, revenue, spend, CPA, ROAS, ROI,
// cannibalization detection + kill recommendation.
export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get('days') || '14')
  const platform = req.nextUrl.searchParams.get('platform') || undefined
  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined
  const since = new Date()
  since.setDate(since.getDate() - days)

  const ads = await db.ad.findMany({
    where: {
      ...(platform && platform !== 'all' ? { campaign: { platformId: `ap-${platform}` } } : {}),
      ...(tenantId ? { campaign: { tenantId } } : {}),
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

  // Global CPA target + ROAS kill threshold from settings
  const settings = await db.setting.findMany()
  const cfg = Object.fromEntries(settings.map(s => [s.key, s.value]))
  const roasKill = Number(cfg.roas_kill_threshold || 0.8)
  const cpaTarget = Number(cfg.cpa_target || 35000)

  const rows = ads.map(ad => {
    const spend = ad.spend.reduce((s, x) => s + x.spend, 0)
    const impressions = ad.spend.reduce((s, x) => s + x.impressions, 0)
    const clicks = ad.spend.reduce((s, x) => s + x.clicks, 0)
    const convReported = ad.spend.reduce((s, x) => s + x.convReported, 0)

    const orders = ad.orders
    const orderCount = orders.length
    const revenue = orders.reduce((s, o) => s + o.total, 0)
    const paidRevenue = orders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0)
    const units = orders.reduce((s, o) => s + o.items.reduce((ss, it) => ss + it.quantity, 0), 0)
    const cogs = orders.reduce((s, o) => s + o.items.reduce((ss, it) => ss + it.cost * it.quantity, 0), 0)
    const grossProfit = paidRevenue - cogs
    const netProfit = grossProfit - spend

    const cpa = orderCount > 0 ? spend / orderCount : spend > 0 ? Infinity : 0
    const cpl = convReported > 0 ? spend / convReported : 0  // cost per lead (platform-reported conv)
    const roas = spend > 0 ? paidRevenue / spend : 0
    const roi = spend > 0 ? netProfit / spend : 0
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
    const cpc = clicks > 0 ? spend / clicks : 0
    const cvr = clicks > 0 ? (orderCount / clicks) * 100 : 0
    const aov = orderCount > 0 ? revenue / orderCount : 0

    // Cannibalization: high spend, low ROAS, and convReported high but real orders low
    // (platform is "stealing credit" — spending without converting real sales)
    const platformVsRealGap = convReported - orderCount
    const cannibalizing =
      spend > 0 &&
      roas < roasKill &&
      orderCount === 0 &&
      convReported > 0

    const verdict = (() => {
      if (orderCount === 0 && spend > cpaTarget) return 'kill'        // burning money, no sales
      if (cannibalizing) return 'cannibalize'                          // spending, crediting but not selling
      if (roas < roasKill && spend > cpaTarget * 2) return 'pause'    // under threshold & material spend
      if (roas >= 2) return 'scale'                                    // strong — scale up
      if (roas >= 1) return 'optimize'                                 // break-even-ish — optimize
      return 'watch'
    })()

    return {
      id: ad.id,
      externalId: ad.externalId,
      name: ad.name,
      creative: ad.creative,
      status: ad.status,
      autoKill: ad.autoKill,
      killReason: ad.killReason,
      campaign: { id: ad.campaign.id, name: ad.campaign.name, externalId: ad.campaign.externalId },
      platform: { id: ad.campaign.platform.id, name: ad.campaign.platform.name, displayName: ad.campaign.platform.displayName },
      metrics: {
        spend: Math.round(spend),
        impressions,
        clicks,
        ctr: Number(ctr.toFixed(2)),
        cpc: Math.round(cpc),
        convReported,
        orderCount,
        units,
        revenue: Math.round(revenue),
        paidRevenue: Math.round(paidRevenue),
        aov: Math.round(aov),
        cogs: Math.round(cogs),
        grossProfit: Math.round(grossProfit),
        netProfit: Math.round(netProfit),
        cpa: cpa === Infinity ? null : Math.round(cpa),
        cpl: Math.round(cpl),
        cvr: Number(cvr.toFixed(2)),
        roas: Number(roas.toFixed(2)),
        roi: Number(roi.toFixed(2)),
      },
      verdict,
      cannibalizing,
      flags: {
        burning: orderCount === 0 && spend > cpaTarget,
        underRoas: roas < roasKill,
        platformGap: platformVsRealGap,
        scalesWell: roas >= 2 && orderCount >= 2,
      },
    }
  })

  // Totals
  const totals = rows.reduce((acc, r) => {
    acc.spend += r.metrics.spend
    acc.revenue += r.metrics.revenue
    acc.paidRevenue += r.metrics.paidRevenue
    acc.orders += r.metrics.orderCount
    acc.units += r.metrics.units
    acc.netProfit += r.metrics.netProfit
    return acc
  }, { spend: 0, revenue: 0, paidRevenue: 0, orders: 0, units: 0, netProfit: 0, roas: 0, roi: 0, cpa: 0 })
  totals.roas = totals.spend > 0 ? Number((totals.paidRevenue / totals.spend).toFixed(2)) : 0
  totals.roi = totals.spend > 0 ? Number((totals.netProfit / totals.spend).toFixed(2)) : 0
  totals.cpa = totals.orders > 0 ? Math.round(totals.spend / totals.orders) : 0

  // Daily spend series (for trend chart)
  const dayMap = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0)
    dayMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (const r of rows) {
    const ad = ads.find(a => a.id === r.id)!
    for (const s of ad.spend) {
      const key = s.date.toISOString().slice(0, 10)
      const e = dayMap.get(key); if (e != null) dayMap.set(key, e + s.spend)
    }
  }
  const series = Array.from(dayMap.entries()).map(([date, spend]) => ({ date, spend }))

  return NextResponse.json({
    range: { days, since: since.toISOString() },
    thresholds: { roasKill, cpaTarget },
    totals,
    series,
    rows: rows.sort((a, b) => b.metrics.spend - a.metrics.spend),
  })
}
