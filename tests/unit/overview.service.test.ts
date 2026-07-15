// Unit tests for src/lib/services/overview.service.ts
// TASK: SPRINT-AUDITLOG-TESTS-001
//
// Covers `overviewService.getKPIs()` (the only KPI aggregation entry point):
//   - Returns correct KPIs (revenue, revenuePaid, orders, ROAS, spend, etc.)
//   - Handles empty data (zero orders / zero spend)
//   - Aggregates by date range (only orders with createdAt >= since are counted)
//   - Returns channel split (one entry per Channel with revenue + orders count)
//
// Mock pattern mirrors wallet.service.test.ts — vi.hoisted + deep vi.fn mock
// for every db delegate the service touches. The service fires 11 queries in
// parallel via `Promise.all`, so each test sets all 11 mocks before invoking
// `getKPIs`.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    order: {
      aggregate: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    orderItem: {
      findMany: vi.fn(),
    },
    channel: {
      findMany: vi.fn(),
    },
    adSpend: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    conversation: {
      count: vi.fn(),
    },
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Stub logger so tests don't print pino output. captureError calls logger
// internally — silence it. Must export BOTH named `logger` (used by
// capture-error.ts) and `getLogger` + `default` (used by services).
const { loggerMock } = vi.hoisted(() => {
  const m: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
    child: () => unknown
  } = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => m,
  }
  return { loggerMock: m }
})
vi.mock('@/lib/logger', () => ({
  getLogger: () => loggerMock,
  logger: loggerMock,
  default: loggerMock,
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

import { overviewService } from '@/lib/services/overview.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// Helper: prime all 11 parallel mocks with sensible empty defaults. Each test
// overrides the mocks it cares about. The order matches the `Promise.all`
// array in the service: [revenueAgg, revenuePaidAgg, ordersCount,
// paymentModeGroups, channelGroups, channels, adSpendAgg, conversations,
// cogsItems, seriesOrders, seriesAdSpends].
function primeMocks(overrides: Partial<{
  revenueAgg: unknown
  revenuePaidAgg: unknown
  ordersCount: unknown
  paymentModeGroups: unknown
  channelGroups: unknown
  channels: unknown
  adSpendAgg: unknown
  conversations: unknown
  cogsItems: unknown
  seriesOrders: unknown
  seriesAdSpends: unknown
}> = {}) {
  db.order.aggregate
    // 1st call = revenueAgg, 2nd call = revenuePaidAgg
    .mockResolvedValueOnce(overrides.revenueAgg ?? { _sum: { total: 0 } })
    .mockResolvedValueOnce(overrides.revenuePaidAgg ?? { _sum: { total: 0 } })
  db.order.count.mockResolvedValue(overrides.ordersCount ?? 0)
  db.order.groupBy
    // 1st call = paymentModeGroups, 2nd call = channelGroups
    .mockResolvedValueOnce(overrides.paymentModeGroups ?? [])
    .mockResolvedValueOnce(overrides.channelGroups ?? [])
  db.channel.findMany.mockResolvedValue(overrides.channels ?? [])
  db.adSpend.aggregate.mockResolvedValue(
    overrides.adSpendAgg ?? { _sum: { spend: 0, impressions: 0, clicks: 0 } },
  )
  db.conversation.count.mockResolvedValue(overrides.conversations ?? 0)
  db.orderItem.findMany.mockResolvedValue(overrides.cogsItems ?? [])
  db.order.findMany.mockResolvedValue(overrides.seriesOrders ?? [])
  db.adSpend.findMany.mockResolvedValue(overrides.seriesAdSpends ?? [])
}

// ─────────────────────────────────────────────────────────────────────────────
// getKPIs — happy path with revenue + spend + multiple channels
// ─────────────────────────────────────────────────────────────────────────────
describe('overviewService.getKPIs — happy path', () => {
  it('aggregates revenue, orders, ROAS, spend, channelSplit from the 11 parallel queries', async () => {
    primeMocks({
      revenueAgg: { _sum: { total: 1_000_000 } },
      revenuePaidAgg: { _sum: { total: 800_000 } },
      ordersCount: 50,
      paymentModeGroups: [
        { paymentMode: 'cod', _count: { _all: 30 } },
        { paymentMode: 'advance', _count: { _all: 20 } },
      ],
      channelGroups: [
        { channelId: 'ch-1', _sum: { total: 600_000 }, _count: { _all: 30 } },
        { channelId: 'ch-2', _sum: { total: 400_000 }, _count: { _all: 20 } },
      ],
      channels: [
        {
          id: 'ch-1',
          displayName: 'WhatsApp Principal',
          type: 'whatsapp',
          paymentStrategy: 'advance',
        },
        {
          id: 'ch-2',
          displayName: 'Messenger Backup',
          type: 'messenger',
          paymentStrategy: 'cod',
        },
      ],
      adSpendAgg: { _sum: { spend: 200_000, impressions: 10_000, clicks: 500 } },
      conversations: 25,
      cogsItems: [
        { cost: 1000, quantity: 2 },
        { cost: 500, quantity: 4 },
      ], // cogs = 1000*2 + 500*4 = 4000
      seriesOrders: [],
      seriesAdSpends: [],
    })

    const result = await overviewService.getKPIs(7, 'ten-1')

    // range
    expect(result.range.days).toBe(7)
    expect(typeof result.range.since).toBe('string') // ISO date string

    // kpis
    expect(result.kpis.revenue).toBe(1_000_000)
    expect(result.kpis.revenuePaid).toBe(800_000)
    expect(result.kpis.orders).toBe(50)
    expect(result.kpis.conversations).toBe(25)
    expect(result.kpis.totalSpend).toBe(200_000)
    // cogs is an intermediate value — NOT exported on kpis (grossProfit already
    // factors it in: revenuePaid - cogs = 800_000 - 4_000 = 796_000)
    expect((result.kpis as Record<string, unknown>).cogs).toBeUndefined()
    expect(result.kpis.grossProfit).toBe(800_000 - 4000) // revenuePaid - cogs
    expect(result.kpis.netProfit).toBe(800_000 - 4000 - 200_000) // grossProfit - totalSpend
    // roi = netProfit / totalSpend = (796000 - 200000) / 200000 = 596000/200000 = 2.98
    expect(result.kpis.roi).toBe(2.98)
    // roas = revenuePaid / totalSpend = 800000 / 200000 = 4
    expect(result.kpis.roas).toBe(4)
    // cpa = totalSpend / ordersCount = 200000 / 50 = 4000
    expect(result.kpis.cpa).toBe(4000)
    // ctr = (clicks / impressions) * 100 = (500 / 10000) * 100 = 5
    expect(result.kpis.ctr).toBe(5)
    // aov = revenue / ordersCount = 1000000 / 50 = 20000
    expect(result.kpis.aov).toBe(20000)
    // advanceRate = advanceOrders / ordersCount * 100 = 20/50 * 100 = 40.0
    expect(result.kpis.advanceOrders).toBe(20)
    expect(result.kpis.codOrders).toBe(30)
    expect(result.kpis.advanceRate).toBe(40)

    // channelSplit — one entry per Channel, with revenue + orders from groupBy
    expect(result.channelSplit).toEqual([
      {
        id: 'ch-1',
        name: 'WhatsApp Principal',
        type: 'whatsapp',
        orders: 30,
        revenue: 600_000,
        strategy: 'advance',
      },
      {
        id: 'ch-2',
        name: 'Messenger Backup',
        type: 'messenger',
        orders: 20,
        revenue: 400_000,
        strategy: 'cod',
      },
    ])

    // series — 7 buckets (days=7), each with revenue:0, spend:0, orders:0
    expect(result.series).toHaveLength(7)
    expect(result.series[0]).toEqual({
      date: expect.any(String),
      revenue: 0,
      spend: 0,
      orders: 0,
    })

    // Verify tenantId was injected into all queries (when supplied)
    expect(db.order.aggregate).toHaveBeenNthCalledWith(1, {
      where: { tenantId: 'ten-1', createdAt: { gte: expect.any(Date) } },
      _sum: { total: true },
    })
    expect(db.order.count).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', createdAt: { gte: expect.any(Date) } },
    })
    expect(db.channel.findMany).toHaveBeenCalledWith({ where: { tenantId: 'ten-1' } })
  })

  it('aggregates ALL tenants when tenantId is omitted', async () => {
    primeMocks({
      revenueAgg: { _sum: { total: 5_000 } },
      revenuePaidAgg: { _sum: { total: 4_000 } },
      ordersCount: 10,
      channels: [],
    })

    const result = await overviewService.getKPIs(30)

    // The `where` should NOT contain tenantId (only createdAt)
    expect(db.order.aggregate).toHaveBeenNthCalledWith(1, {
      where: { createdAt: { gte: expect.any(Date) } },
      _sum: { total: true },
    })
    expect(db.channel.findMany).toHaveBeenCalledWith({ where: {} })
    expect(result.kpis.revenue).toBe(5_000)
    expect(result.kpis.orders).toBe(10)
    expect(result.channelSplit).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getKPIs — empty data (zero orders, zero spend, zero channels)
// ─────────────────────────────────────────────────────────────────────────────
describe('overviewService.getKPIs — empty data', () => {
  it('returns zeroed KPIs when there are no orders + no channels', async () => {
    primeMocks()

    const result = await overviewService.getKPIs(7, 'ten-empty')

    expect(result.kpis.revenue).toBe(0)
    expect(result.kpis.revenuePaid).toBe(0)
    expect(result.kpis.orders).toBe(0)
    expect(result.kpis.conversations).toBe(0)
    expect(result.kpis.totalSpend).toBe(0)
    expect(result.kpis.grossProfit).toBe(0)
    expect(result.kpis.netProfit).toBe(0)
    // When totalSpend=0, the service returns roi=0 and roas=0 (no division by zero)
    expect(result.kpis.roi).toBe(0)
    expect(result.kpis.roas).toBe(0)
    // When ordersCount=0, cpa=0, aov=0, advanceRate=0 (no division by zero)
    expect(result.kpis.cpa).toBe(0)
    expect(result.kpis.aov).toBe(0)
    expect(result.kpis.advanceRate).toBe(0)
    // ctr=0 when totalImpressions=0
    expect(result.kpis.ctr).toBe(0)
    expect(result.channelSplit).toEqual([])
    expect(result.series).toHaveLength(7)
  })

  it('returns 0 cogs when no OrderItem rows match the window', async () => {
    primeMocks({
      revenuePaidAgg: { _sum: { total: 1000 } },
      cogsItems: [],
    })

    const result = await overviewService.getKPIs(1, 'ten-1')
    expect(result.kpis.grossProfit).toBe(1000) // revenuePaid - cogs(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getKPIs — series aggregation by day
// ─────────────────────────────────────────────────────────────────────────────
describe('overviewService.getKPIs — series aggregation', () => {
  it('buckets orders + ad spend by calendar day (YYYY-MM-DD)', async () => {
    // Use 3-day window so we have 3 buckets. We need to construct order
    // + adSpend rows whose createdAt/date fall inside the window.
    const today = new Date()
    today.setHours(12, 0, 0, 0)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(15, 30, 0, 0)

    primeMocks({
      seriesOrders: [
        { total: 1000, createdAt: today },
        { total: 500, createdAt: today },
        { total: 2000, createdAt: yesterday },
      ],
      seriesAdSpends: [
        { spend: 100, date: today },
        { spend: 200, date: yesterday },
      ],
    })

    const result = await overviewService.getKPIs(3, 'ten-1')

    expect(result.series).toHaveLength(3)

    // Find the buckets matching today + yesterday (the third is two days ago
    // and should have zero revenue/spend/orders).
    const todayKey = today.toISOString().slice(0, 10)
    const yesterdayKey = yesterday.toISOString().slice(0, 10)

    const todayBucket = result.series.find((s) => s.date === todayKey)
    const yesterdayBucket = result.series.find((s) => s.date === yesterdayKey)

    expect(todayBucket).toEqual({
      date: todayKey,
      revenue: 1500, // 1000 + 500
      spend: 100,
      orders: 2,
    })
    expect(yesterdayBucket).toEqual({
      date: yesterdayKey,
      revenue: 2000,
      spend: 200,
      orders: 1,
    })

    // The remaining bucket has zeros
    const emptyBuckets = result.series.filter(
      (s) => s.date !== todayKey && s.date !== yesterdayKey,
    )
    expect(emptyBuckets).toHaveLength(1)
    expect(emptyBuckets[0]).toEqual({
      date: expect.any(String),
      revenue: 0,
      spend: 0,
      orders: 0,
    })
  })

  it('skips series rows whose date falls outside the window (key not in dayMap)', async () => {
    // Use a 1-day window, but inject a seriesOrders row dated 10 days ago —
    // it should be ignored (the dayMap only contains today's bucket).
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 10)

    primeMocks({
      seriesOrders: [{ total: 9999, createdAt: oldDate }],
      seriesAdSpends: [{ spend: 999, date: oldDate }],
    })

    const result = await overviewService.getKPIs(1, 'ten-1')

    expect(result.series).toHaveLength(1)
    expect(result.series[0].revenue).toBe(0) // the old row was ignored
    expect(result.series[0].spend).toBe(0)
    expect(result.series[0].orders).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getKPIs — channel split (one entry per Channel, with fallback zeros)
// ─────────────────────────────────────────────────────────────────────────────
describe('overviewService.getKPIs — channel split', () => {
  it('emits zero-revenue entries for channels with no matching channelGroups row', async () => {
    primeMocks({
      channels: [
        {
          id: 'ch-a',
          displayName: 'WhatsApp',
          type: 'whatsapp',
          paymentStrategy: 'advance',
        },
        {
          id: 'ch-b',
          displayName: 'Messenger',
          type: 'messenger',
          paymentStrategy: 'cod',
        },
      ],
      channelGroups: [
        // Only ch-a has matching orders; ch-b is missing
        { channelId: 'ch-a', _sum: { total: 250_000 }, _count: { _all: 5 } },
      ],
    })

    const result = await overviewService.getKPIs(7, 'ten-1')

    expect(result.channelSplit).toEqual([
      {
        id: 'ch-a',
        name: 'WhatsApp',
        type: 'whatsapp',
        orders: 5,
        revenue: 250_000,
        strategy: 'advance',
      },
      {
        id: 'ch-b',
        name: 'Messenger',
        type: 'messenger',
        orders: 0, // fallback when no groupBy row
        revenue: 0,
        strategy: 'cod',
      },
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getKPIs — error wrapping
// ─────────────────────────────────────────────────────────────────────────────
describe('overviewService.getKPIs — error handling', () => {
  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.order.aggregate.mockRejectedValueOnce(new Error('db down'))

    await expect(overviewService.getKPIs(7, 'ten-1')).rejects.toThrow(
      'Failed to fetch overview KPIs',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getChartData — delegates to getKPIs and returns range + series only
// ─────────────────────────────────────────────────────────────────────────────
describe('overviewService.getChartData', () => {
  it('returns { range, series } from getKPIs (discards kpis + channelSplit)', async () => {
    primeMocks()

    const result = await overviewService.getChartData(7, 'ten-1')

    expect(result).toHaveProperty('range')
    expect(result).toHaveProperty('series')
    expect(result.series).toHaveLength(7)
    // Should NOT have kpis / channelSplit keys
    expect(result).not.toHaveProperty('kpis')
    expect(result).not.toHaveProperty('channelSplit')
  })

  it('throws a wrapped Error when getKPIs rejects', async () => {
    db.order.aggregate.mockRejectedValueOnce(new Error('db down'))

    await expect(overviewService.getChartData(7, 'ten-1')).rejects.toThrow(
      'Failed to fetch chart data',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 15C edge cases (SPRINT-TESTS-COMPLETE-001)
//
// Additional coverage for the 4 task-listed branches beyond what the existing
// 10 tests already exercise:
//   - explicit "gap" test: orders on day 1 + day 3 of a 3-day window, with
//     day 2 empty — verifies the empty bucket still appears with zeros.
//   - channel split with 3 channels (one with revenue, two without).
//   - error wrapping via a different parallel query (not just order.aggregate).
// ─────────────────────────────────────────────────────────────────────────────
describe('overviewService.getKPIs — Sprint 15C edge cases', () => {
  it('fills empty buckets with zeros when there is a gap between filled days', async () => {
    // 3-day window with orders on day 1 and day 3, day 2 empty. The
    // dayMap populates all 3 buckets up-front with zeros, then the
    // seriesOrders loop only fills the buckets whose date matches.
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const twoDaysAgo = new Date(today)
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    twoDaysAgo.setHours(10, 0, 0, 0)

    primeMocks({
      seriesOrders: [
        { total: 1500, createdAt: today },
        { total: 3000, createdAt: twoDaysAgo },
      ],
      seriesAdSpends: [
        { spend: 100, date: today },
        { spend: 200, date: twoDaysAgo },
      ],
    })

    const result = await overviewService.getKPIs(3, 'ten-1')

    expect(result.series).toHaveLength(3)
    // Buckkets are ordered oldest → newest (the dayMap fills from
    // days-1 down to 0, so series[0] is two days ago, series[2] is today).
    const todayKey = today.toISOString().slice(0, 10)
    const twoDaysAgoKey = twoDaysAgo.toISOString().slice(0, 10)
    const gapKey = result.series.find(
      (s) => s.date !== todayKey && s.date !== twoDaysAgoKey,
    )?.date

    expect(result.series[0]).toEqual({
      date: twoDaysAgoKey,
      revenue: 3000,
      spend: 200,
      orders: 1,
    })
    // The middle bucket (yesterday) has no orders/spend — must still
    // appear with zeros (no div-by-zero, no missing bucket).
    expect(result.series[1]).toEqual({
      date: gapKey,
      revenue: 0,
      spend: 0,
      orders: 0,
    })
    expect(result.series[2]).toEqual({
      date: todayKey,
      revenue: 1500,
      spend: 100,
      orders: 1,
    })
  })

  it('channel split with 3 channels emits zero-revenue entries for channels with no matching groupBy row', async () => {
    primeMocks({
      channels: [
        { id: 'ch-a', displayName: 'WhatsApp', type: 'whatsapp', paymentStrategy: 'advance' },
        { id: 'ch-b', displayName: 'Messenger', type: 'messenger', paymentStrategy: 'cod' },
        { id: 'ch-c', displayName: 'Instagram', type: 'instagram', paymentStrategy: 'cod' },
      ],
      channelGroups: [
        // Only ch-b has matching orders
        { channelId: 'ch-b', _sum: { total: 750_000 }, _count: { _all: 12 } },
      ],
    })

    const result = await overviewService.getKPIs(7, 'ten-1')

    expect(result.channelSplit).toEqual([
      { id: 'ch-a', name: 'WhatsApp', type: 'whatsapp', orders: 0, revenue: 0, strategy: 'advance' },
      { id: 'ch-b', name: 'Messenger', type: 'messenger', orders: 12, revenue: 750_000, strategy: 'cod' },
      { id: 'ch-c', name: 'Instagram', type: 'instagram', orders: 0, revenue: 0, strategy: 'cod' },
    ])
  })

  it('throws a wrapped Error when any of the 11 parallel queries rejects (not just order.aggregate)', async () => {
    // Verify error wrapping fires for any query — exercise the
    // conversation.count path which is the 8th query in the Promise.all.
    primeMocks()
    db.conversation.count.mockRejectedValueOnce(new Error('conv count boom'))

    await expect(overviewService.getKPIs(7, 'ten-1')).rejects.toThrow(
      'Failed to fetch overview KPIs',
    )
  })

  it('empty data with zero orders + zero spend returns zeros for every derived KPI (no NaN, no Infinity)', async () => {
    // Belt-and-suspenders for the div-by-zero guard: explicitly verify
    // that BOTH spend=0 (roi/roas/cpa) AND orders=0 (aov/advanceRate)
    // paths return 0 (not NaN, not Infinity).
    primeMocks()

    const result = await overviewService.getKPIs(14, 'ten-empty')

    expect(result.kpis.revenue).toBe(0)
    expect(result.kpis.revenuePaid).toBe(0)
    expect(result.kpis.totalSpend).toBe(0)
    expect(result.kpis.orders).toBe(0)
    expect(result.kpis.roi).toBe(0)
    expect(result.kpis.roas).toBe(0)
    expect(result.kpis.cpa).toBe(0)
    expect(result.kpis.aov).toBe(0)
    expect(result.kpis.advanceRate).toBe(0)
    expect(result.kpis.ctr).toBe(0)
    expect(result.kpis.grossProfit).toBe(0)
    expect(result.kpis.netProfit).toBe(0)
    // No NaN / Infinity leaks — Number.isFinite returns false for both.
    expect(Number.isFinite(result.kpis.roi)).toBe(true)
    expect(Number.isFinite(result.kpis.roas)).toBe(true)
    expect(Number.isFinite(result.kpis.cpa)).toBe(true)
    expect(Number.isFinite(result.kpis.aov)).toBe(true)
  })
})
