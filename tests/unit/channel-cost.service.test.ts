// Unit tests for src/lib/services/channel-cost.service.ts
// TASK: SPRINT-AUDITLOG-TESTS-001
//
// Covers the 3 task-listed items:
//   - getChannelContributions  → aggregates revenue + costs per channel from
//                                 `ChannelCost` rows over a date range, computes
//                                 totalCost, netContribution, marginPct, aov,
//                                 cac, cpl
//   - recordDailyChannelCosts  → upserts a single `ChannelCost` row per tracked
//                                 channel for the given day (idempotent — keyed
//                                 by (tenantId, channel, date))
//   - Margin calculation        → netContribution = revenue - totalCost (covered
//                                 as assertions inside the getChannelContributions
//                                 tests; totalCost = messageCost + aiTokenCost +
//                                 adSpend + supportCost + logisticsCost +
//                                 paymentFee)
//
// Mock pattern mirrors wallet.service.test.ts — vi.hoisted + deep vi.fn mock
// for every db delegate the service touches.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    channelCost: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    channel: {
      findMany: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
    },
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Stub logger so tests don't print pino output. captureError calls logger
// internally — silence it.
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

import {
  getChannelContributions,
  recordDailyChannelCosts,
  TRACKED_CHANNELS,
} from '@/lib/services/channel-cost.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getChannelContributions — aggregates revenue + costs per channel
// ─────────────────────────────────────────────────────────────────────────────
describe('getChannelContributions', () => {
  it('groups ChannelCost rows by channel + sums each cost component + revenue', async () => {
    const start = new Date('2025-01-01')
    const end = new Date('2025-01-31')

    // Two rows for whatsapp (should be summed together), one for messenger.
    db.channelCost.findMany.mockResolvedValue([
      {
        channel: 'whatsapp',
        revenue: 1000,
        messageCost: 10,
        aiTokenCost: 20,
        adSpend: 100,
        supportCost: 5,
        logisticsCost: 50,
        paymentFee: 30,
        ordersCount: 5,
      },
      {
        channel: 'whatsapp',
        revenue: 2000,
        messageCost: 15,
        aiTokenCost: 25,
        adSpend: 200,
        supportCost: 10,
        logisticsCost: 60,
        paymentFee: 60,
        ordersCount: 10,
      },
      {
        channel: 'messenger',
        revenue: 500,
        messageCost: 5,
        aiTokenCost: 10,
        adSpend: 50,
        supportCost: 2,
        logisticsCost: 25,
        paymentFee: 15,
        ordersCount: 2,
      },
    ])

    const result = await getChannelContributions('ten-1', start, end)

    expect(result).toHaveLength(2)

    // WhatsApp aggregate:
    //   revenue: 3000, ordersCount: 15
    //   messageCost: 25, aiTokenCost: 45, adSpend: 300, supportCost: 15,
    //   logisticsCost: 110, paymentFee: 90
    //   totalCost: 25+45+300+15+110+90 = 585
    //   netContribution: 3000 - 585 = 2415
    //   marginPct: (2415/3000) * 100 = 80.5
    //   aov: 3000/15 = 200
    //   cac: 300/15 = 20
    //   cpl: 300/15 = 20
    const wa = result.find((c) => c.channel === 'whatsapp')
    expect(wa).toBeDefined()
    expect(wa!.revenue).toBe(3000)
    expect(wa!.messageCost).toBe(25)
    expect(wa!.aiTokenCost).toBe(45)
    expect(wa!.adSpend).toBe(300)
    expect(wa!.supportCost).toBe(15)
    expect(wa!.logisticsCost).toBe(110)
    expect(wa!.paymentFee).toBe(90)
    expect(wa!.totalCost).toBe(585)
    expect(wa!.netContribution).toBe(2415)
    expect(wa!.marginPct).toBe(80.5)
    expect(wa!.aov).toBe(200)
    expect(wa!.cac).toBe(20)
    expect(wa!.cpl).toBe(20)
    expect(wa!.ordersCount).toBe(15)

    // Messenger aggregate:
    //   revenue: 500, ordersCount: 2
    //   totalCost: 5+10+50+2+25+15 = 107
    //   netContribution: 500 - 107 = 393
    //   marginPct: (393/500)*100 = 78.6
    const ms = result.find((c) => c.channel === 'messenger')
    expect(ms).toBeDefined()
    expect(ms!.totalCost).toBe(107)
    expect(ms!.netContribution).toBe(393)
    expect(ms!.marginPct).toBe(78.6)
  })

  it('passes tenantId + date range to the findMany query', async () => {
    db.channelCost.findMany.mockResolvedValue([])
    const start = new Date('2025-01-01')
    const end = new Date('2025-01-31')

    await getChannelContributions('ten-1', start, end)

    expect(db.channelCost.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'ten-1',
        date: { gte: start, lte: end },
      },
      orderBy: { channel: 'asc' },
    })
  })

  it('returns empty array when no ChannelCost rows exist for the window', async () => {
    db.channelCost.findMany.mockResolvedValue([])

    const result = await getChannelContributions(
      'ten-1',
      new Date('2025-01-01'),
      new Date('2025-01-31'),
    )

    expect(result).toEqual([])
  })

  it('handles a single channel with zero revenue (marginPct=0, no division by zero)', async () => {
    db.channelCost.findMany.mockResolvedValue([
      {
        channel: 'tiktok',
        revenue: 0,
        messageCost: 0,
        aiTokenCost: 0,
        adSpend: 100, // ad spend but no revenue → loss
        supportCost: 0,
        logisticsCost: 0,
        paymentFee: 0,
        ordersCount: 0,
      },
    ])

    const result = await getChannelContributions(
      'ten-1',
      new Date('2025-01-01'),
      new Date('2025-01-31'),
    )

    expect(result).toHaveLength(1)
    const ch = result[0]
    expect(ch.revenue).toBe(0)
    expect(ch.totalCost).toBe(100)
    expect(ch.netContribution).toBe(-100) // revenue - totalCost = 0 - 100
    expect(ch.marginPct).toBe(0) // revenue=0 → marginPct=0 (no division by zero)
    expect(ch.aov).toBe(0) // ordersCount=0 → aov=0
    expect(ch.cac).toBe(0) // ordersCount=0 → cac=0
    expect(ch.cpl).toBe(0) // ordersCount=0 → cpl=0
  })

  it('rounds all currency values to 2 decimals', async () => {
    // Sums that produce fractional values (e.g. 0.0085 * 3 = 0.0255)
    db.channelCost.findMany.mockResolvedValue([
      {
        channel: 'whatsapp',
        revenue: 100.005,
        messageCost: 0.0255,
        aiTokenCost: 0,
        adSpend: 0,
        supportCost: 0,
        logisticsCost: 0,
        paymentFee: 0,
        ordersCount: 1,
      },
    ])

    const result = await getChannelContributions(
      'ten-1',
      new Date('2025-01-01'),
      new Date('2025-01-31'),
    )

    // Each value should have at most 2 decimal places.
    const ch = result[0]
    expect(String(ch.revenue)).toMatch(/^\d+(\.\d{1,2})?$/)
    expect(String(ch.messageCost)).toMatch(/^\d+(\.\d{1,2})?$/)
    expect(String(ch.totalCost)).toMatch(/^\d+(\.\d{1,2})?$/)
    expect(String(ch.netContribution)).toMatch(/^\d+(\.\d{1,2})?$/)
    expect(String(ch.marginPct)).toMatch(/^-?\d+(\.\d{1,2})?$/)
    expect(String(ch.aov)).toMatch(/^\d+(\.\d{1,2})?$/)
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.channelCost.findMany.mockRejectedValue(new Error('db down'))

    await expect(
      getChannelContributions('ten-1', new Date('2025-01-01'), new Date('2025-01-31')),
    ).rejects.toThrow('No se pudo obtener el margen de contribución por canal')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// recordDailyChannelCosts — upserts a ChannelCost row per tracked channel
// ─────────────────────────────────────────────────────────────────────────────
describe('recordDailyChannelCosts', () => {
  // Helper: prime channel.findMany + order.findMany mocks so that the service
  // finds N channels of type `channelType` and M orders for that day.
  function primeChannelLookup(channelType: string, channelIds: string[], orders: { total: number }[]) {
    db.channel.findMany.mockImplementation((args: { where: { type: string } }) => {
      if (args.where.type === channelType) {
        return Promise.resolve(channelIds.map((id) => ({ id })))
      }
      return Promise.resolve([])
    })
    db.order.findMany.mockResolvedValue(orders)
  }

  it('upserts a ChannelCost row per tracked channel (4 channels → 4 upserts)', async () => {
    // Empty orders everywhere → still upserts zero rows so the dashboard shows
    // the channel as "tracked but idle" rather than missing.
    db.channel.findMany.mockResolvedValue([])
    db.order.findMany.mockResolvedValue([])
    db.channelCost.upsert.mockResolvedValue({ id: 'cc-1' })

    await recordDailyChannelCosts('ten-1', new Date('2025-01-15T12:00:00Z'))

    // 4 tracked channels (whatsapp, messenger, instagram, tiktok)
    expect(db.channelCost.upsert).toHaveBeenCalledTimes(TRACKED_CHANNELS.length)
  })

  it('passes the normalized start-of-day date to the upsert (not the original time)', async () => {
    db.channel.findMany.mockResolvedValue([])
    db.order.findMany.mockResolvedValue([])
    db.channelCost.upsert.mockResolvedValue({ id: 'cc-1' })

    const inputDate = new Date('2025-01-15T15:30:45.123Z')
    await recordDailyChannelCosts('ten-1', inputDate)

    // The date stored on the upsert should be normalized to 00:00:00.000 local.
    const firstCall = db.channelCost.upsert.mock.calls[0][0]
    const storedDate: Date = firstCall.where.tenantId_channel_date.date
    expect(storedDate.getHours()).toBe(0)
    expect(storedDate.getMinutes()).toBe(0)
    expect(storedDate.getSeconds()).toBe(0)
    expect(storedDate.getMilliseconds()).toBe(0)
    // Same calendar day as the input
    expect(storedDate.getDate()).toBe(inputDate.getDate())
    expect(storedDate.getMonth()).toBe(inputDate.getMonth())
    expect(storedDate.getFullYear()).toBe(inputDate.getFullYear())
  })

  it('aggregates revenue + ordersCount from the orders fetched for the day', async () => {
    // whatsapp has 2 channels → 3 orders total ($100 + $200 + $300 = $600)
    primeChannelLookup('whatsapp', ['ch-wa-1', 'ch-wa-2'], [
      { total: 100 },
      { total: 200 },
      { total: 300 },
    ])
    db.channelCost.upsert.mockResolvedValue({ id: 'cc-1' })

    await recordDailyChannelCosts('ten-1', new Date('2025-01-15T12:00:00Z'))

    // Find the whatsapp upsert call
    const waCall = db.channelCost.upsert.mock.calls.find(
      (call) => call[0].create.channel === 'whatsapp',
    )
    expect(waCall).toBeDefined()
    const createData = waCall![0].create
    expect(createData.revenue).toBe(600)
    expect(createData.ordersCount).toBe(3)
    // Estimated costs (per study §14.1):
    //   messageCost: 3 * 0.0085 = 0.0255
    //   aiTokenCost: 3 * 0.02   = 0.06
    //   logisticsCost: 3 * 2.5  = 7.5
    //   paymentFee:   600 * 0.029 + 0.3 = 17.4 + 0.3 = 17.7
    //   netContribution: 600 - 0.0255 - 0.06 - 7.5 - 17.7 = 574.7145
    expect(createData.messageCost).toBeCloseTo(0.0255, 5)
    expect(createData.aiTokenCost).toBeCloseTo(0.06, 5)
    expect(createData.logisticsCost).toBeCloseTo(7.5, 5)
    expect(createData.paymentFee).toBeCloseTo(17.7, 5)
    expect(createData.netContribution).toBeCloseTo(574.7145, 3)
    // marginPct = (netContribution / revenue) * 100 = (574.7145 / 600) * 100 ≈ 95.78575
    expect(createData.marginPct).toBeCloseTo(95.79, 1)
  })

  it('passes the same values to both `update` and `create` branches of the upsert (idempotent)', async () => {
    primeChannelLookup('whatsapp', ['ch-1'], [{ total: 500 }])
    db.channelCost.upsert.mockResolvedValue({ id: 'cc-1' })

    await recordDailyChannelCosts('ten-1', new Date('2025-01-15T12:00:00Z'))

    const waCall = db.channelCost.upsert.mock.calls.find(
      (call) => call[0].create.channel === 'whatsapp',
    )!
    // The update + create branches should have the same revenue + cost values
    // (the only difference is the unique-key fields: tenantId, channel, date
    // are NOT repeated inside `update` because they're part of the where).
    const update = waCall[0].update
    const create = waCall[0].create
    expect(update.revenue).toBe(create.revenue)
    expect(update.ordersCount).toBe(create.ordersCount)
    expect(update.messageCost).toBe(create.messageCost)
    expect(update.aiTokenCost).toBe(create.aiTokenCost)
    expect(update.logisticsCost).toBe(create.logisticsCost)
    expect(update.paymentFee).toBe(create.paymentFee)
    expect(update.netContribution).toBe(create.netContribution)
    expect(update.marginPct).toBe(create.marginPct)
  })

  it('queries orders with the day-window [startOfDay, startOfNextDay)', async () => {
    primeChannelLookup('whatsapp', ['ch-1'], [])
    db.channelCost.upsert.mockResolvedValue({ id: 'cc-1' })

    const inputDate = new Date('2025-01-15T15:30:00Z')
    await recordDailyChannelCosts('ten-1', inputDate)

    const orderCall = db.order.findMany.mock.calls[0][0]
    const gte: Date = orderCall.where.createdAt.gte
    const lt: Date = orderCall.where.createdAt.lt
    // gte = startOfDay (00:00:00), lt = startOfNextDay (00:00:00 next day)
    expect(gte.getHours()).toBe(0)
    expect(lt.getDate()).toBe(gte.getDate() + 1)
    expect(lt.getHours()).toBe(0)
    // Tenant + channelId IN filter
    expect(orderCall.where.tenantId).toBe('ten-1')
    expect(orderCall.where.channelId).toEqual({ in: ['ch-1'] })
  })

  it('upserts a zero row when no channels of the type exist (still tracked, no orders)', async () => {
    // No channels of any type registered
    db.channel.findMany.mockResolvedValue([])
    db.order.findMany.mockResolvedValue([])
    db.channelCost.upsert.mockResolvedValue({ id: 'cc-1' })

    await recordDailyChannelCosts('ten-1', new Date('2025-01-15T12:00:00Z'))

    // No order.findMany calls (because channelIds.length === 0 short-circuits)
    expect(db.order.findMany).not.toHaveBeenCalled()

    // The first upsert should still create a zero row
    const firstCall = db.channelCost.upsert.mock.calls[0][0]
    expect(firstCall.create.revenue).toBe(0)
    expect(firstCall.create.ordersCount).toBe(0)
    expect(firstCall.create.messageCost).toBe(0)
    expect(firstCall.create.aiTokenCost).toBe(0)
    expect(firstCall.create.logisticsCost).toBe(0)
    expect(firstCall.create.paymentFee).toBeCloseTo(0.3, 5) // 0 * 0.029 + 0.3
    expect(firstCall.create.netContribution).toBeCloseTo(-0.3, 5) // 0 - 0.3
    expect(firstCall.create.marginPct).toBe(0) // revenue=0 → marginPct=0
  })

  it('continues to the next channel when one channel throws (capture + continue)', async () => {
    // whatsapp throws (channel.findMany rejects); messenger succeeds.
    db.channel.findMany.mockImplementation((args: { where: { type: string } }) => {
      if (args.where.type === 'whatsapp') {
        return Promise.reject(new Error('wa lookup failed'))
      }
      return Promise.resolve([])
    })
    db.order.findMany.mockResolvedValue([])
    db.channelCost.upsert.mockResolvedValue({ id: 'cc-1' })

    // Should NOT throw — failures are captured per-channel + the loop continues
    await expect(
      recordDailyChannelCosts('ten-1', new Date('2025-01-15T12:00:00Z')),
    ).resolves.toBeUndefined()

    // 3 successful upserts (messenger, instagram, tiktok) — whatsapp threw
    expect(db.channelCost.upsert).toHaveBeenCalledTimes(3)
  })
})
