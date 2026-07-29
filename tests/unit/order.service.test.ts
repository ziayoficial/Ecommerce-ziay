// Unit tests for src/lib/services/order.service.ts
// TASK: SPRINT-AUDITLOG-TESTS-001
//
// Covers the 4 task-listed methods (mapped to actual method names where they
// differ from the task description):
//   - getOrders        → paginated list with cursor + filters
//   - getOrderById     → single order with relations (items, events, etc.)
//   - updateOrder      → updates fields, optionally + OrderEvent in a $transaction
//   - getOrdersForKanban / getRevenueSince are bonus coverage (lightweight
//     projections used by other routes — included for symmetry)
//
// Mock pattern mirrors wallet.service.test.ts — vi.hoisted + deep vi.fn mock
// for every db delegate the service touches.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    order: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    orderEvent: {
      create: vi.fn(),
    },
    // Prisma's $transaction with an array of promises returns an array of
    // results in order. The service uses the array form for updateOrder when
    // an event is supplied.
    $transaction: vi.fn(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input)
      // callback form (not used by this service, but kept for safety)
      const cb = input as (tx: typeof mockDb) => Promise<unknown>
      return cb(mockDb)
    }),
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

import { orderService } from '@/lib/services/order.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getOrders — paginated list with filters + cursor
// ─────────────────────────────────────────────────────────────────────────────
describe('orderService.getOrders', () => {
  it('returns orders with customer + items + sourceAd.campaign, ordered by createdAt desc', async () => {
    const orders = [
      {
        id: 'o-1',
        number: '1001',
        total: 1000,
        customer: { id: 'c-1' },
        items: [],
        sourceAd: null,
      },
    ]
    db.order.findMany.mockResolvedValue(orders)

    const result = await orderService.getOrders('ten-1')

    expect(result).toEqual(orders)
    expect(db.order.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      include: {
        customer: true,
        items: true,
        sourceAd: { include: { campaign: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // default when limit is omitted
    })
  })

  it('applies status / mode / channel / q filters when provided', async () => {
    db.order.findMany.mockResolvedValue([])

    await orderService.getOrders('ten-1', {
      status: 'paid',
      mode: 'cod',
      channel: 'ch-1',
      q: '1001',
    })

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'ten-1',
          status: 'paid',
          paymentMode: 'cod',
          channelId: 'ch-1',
          number: { contains: '1001' },
        },
      }),
    )
  })

  it('ignores status / mode / channel filters when value is "all"', async () => {
    db.order.findMany.mockResolvedValue([])

    await orderService.getOrders('ten-1', {
      status: 'all',
      mode: 'all',
      channel: 'all',
    })

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'ten-1' }, // none of the "all" filters leaked in
      }),
    )
  })

  it('uses cursor + skip:1 when cursor is provided', async () => {
    db.order.findMany.mockResolvedValue([])

    await orderService.getOrders('ten-1', { cursor: 'o-99' })

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'o-99' },
        skip: 1,
      }),
    )
  })

  it('requests limit + 1 rows when limit is provided (so caller can detect hasMore)', async () => {
    db.order.findMany.mockResolvedValue([])

    await orderService.getOrders('ten-1', { limit: 25 })

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 26 }),
    )
  })

  it('does NOT inject tenantId into the where clause when tenantId is undefined', async () => {
    db.order.findMany.mockResolvedValue([])

    await orderService.getOrders(undefined)

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.order.findMany.mockRejectedValue(new Error('db down'))

    await expect(orderService.getOrders('ten-1')).rejects.toThrow(
      'Failed to fetch orders',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getOrderById — single order with full relations
// ─────────────────────────────────────────────────────────────────────────────
describe('orderService.getOrderById', () => {
  it('returns the order with customer + items + events + shipments + sourceAd.campaign', async () => {
    const order = {
      id: 'o-1',
      number: '1001',
      customer: { id: 'c-1' },
      items: [{ id: 'i-1' }],
      events: [{ id: 'e-1', type: 'created' }],
      shipments: [],
      sourceAd: { id: 'ad-1', campaign: { id: 'cmp-1' } },
    }
    db.order.findFirst.mockResolvedValue(order)

    const result = await orderService.getOrderById('o-1', 'ten-1')

    expect(result).toEqual(order)
    expect(db.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'o-1', tenantId: 'ten-1' },
      include: {
        customer: true,
        items: true,
        events: { orderBy: { createdAt: 'desc' } },
        shipments: true,
        sourceAd: { include: { campaign: true } },
      },
    })
  })

  it('returns null when the order does not exist', async () => {
    db.order.findFirst.mockResolvedValue(null)

    const result = await orderService.getOrderById('nope')
    expect(result).toBeNull()
  })

  it('omits tenantId from the where clause when not provided', async () => {
    db.order.findFirst.mockResolvedValue(null)

    await orderService.getOrderById('o-1')

    expect(db.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      include: expect.any(Object),
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.order.findFirst.mockRejectedValue(new Error('db down'))

    await expect(orderService.getOrderById('o-1')).rejects.toThrow(
      'Failed to fetch order',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateOrder — atomic order + OrderEvent in a $transaction
// ─────────────────────────────────────────────────────────────────────────────
describe('orderService.updateOrder', () => {
  it('wraps order.update + orderEvent.create in a $transaction when event is supplied', async () => {
    const updated = { id: 'o-1', status: 'shipped' }
    const createdEvent = { id: 'e-1', orderId: 'o-1', type: 'shipped' }
    db.order.update.mockResolvedValue(updated)
    db.orderEvent.create.mockResolvedValue(createdEvent)

    const result = await orderService.updateOrder(
      'o-1',
      { status: 'shipped' },
      { type: 'shipped', note: 'Order dispatched' },
      'ten-1',
    )

    expect(result).toEqual(updated)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.$transaction).toHaveBeenCalledWith([
      expect.any(Promise),
      expect.any(Promise),
    ])
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      data: { status: 'shipped' },
    })
    expect(db.orderEvent.create).toHaveBeenCalledWith({
      data: {
        orderId: 'o-1',
        type: 'shipped',
        note: 'Order dispatched',
      },
    })
  })

  it('skips the $transaction + OrderEvent create when no event is supplied', async () => {
    const updated = { id: 'o-1', status: 'paid' }
    db.order.update.mockResolvedValue(updated)

    const result = await orderService.updateOrder('o-1', { status: 'paid' })

    expect(result).toEqual(updated)
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.orderEvent.create).not.toHaveBeenCalled()
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      data: { status: 'paid' },
    })
  })

  it('passes event.note=undefined through (OrderEvent.note is optional)', async () => {
    db.order.update.mockResolvedValue({ id: 'o-1' })
    db.orderEvent.create.mockResolvedValue({ id: 'e-1' })

    await orderService.updateOrder('o-1', { status: 'paid' }, { type: 'paid' })

    expect(db.orderEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'o-1', type: 'paid', note: undefined },
    })
  })

  it('throws a wrapped Error when the $transaction rejects', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('tx failed'))

    await expect(
      orderService.updateOrder(
        'o-1',
        { status: 'paid' },
        { type: 'paid' },
      ),
    ).rejects.toThrow('Failed to update order')
  })

  it('throws a wrapped Error when a plain update rejects (no event path)', async () => {
    db.order.update.mockRejectedValue(new Error('not found'))

    await expect(
      orderService.updateOrder('o-1', { status: 'paid' }),
    ).rejects.toThrow('Failed to update order')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getOrdersForKanban — lightweight projection capped at 200
// ─────────────────────────────────────────────────────────────────────────────
describe('orderService.getOrdersForKanban', () => {
  it('returns the kanban projection (no items, no events) capped at 200', async () => {
    const orders = [
      {
        id: 'o-1',
        number: '1001',
        status: 'pending',
        total: 1000,
        customer: { id: 'c-1', name: 'Jane', phone: '3001' },
      },
    ]
    db.order.findMany.mockResolvedValue(orders)

    const result = await orderService.getOrdersForKanban('ten-1')

    expect(result).toEqual(orders)
    expect(db.order.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      select: expect.objectContaining({
        id: true,
        number: true,
        status: true,
        total: true,
        paymentMode: true,
        paymentStatus: true,
        createdAt: true,
        customer: { select: { id: true, name: true, phone: true } },
        sourceAd: { select: { id: true, name: true, externalId: true } },
        sourceCampaign: true,
        sourcePlatform: true,
      }),
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.order.findMany.mockRejectedValue(new Error('db down'))

    await expect(orderService.getOrdersForKanban('ten-1')).rejects.toThrow(
      'Failed to fetch kanban orders',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getRevenueSince — revenue + funnel aggregation
// ─────────────────────────────────────────────────────────────────────────────
describe('orderService.getRevenueSince', () => {
  it('returns orders (with items) created since the given date', async () => {
    const since = new Date('2025-01-01')
    const orders = [
      { id: 'o-1', total: 1000, items: [{ id: 'i-1' }] },
    ]
    db.order.findMany.mockResolvedValue(orders)

    const result = await orderService.getRevenueSince('ten-1', since)

    expect(result).toEqual(orders)
    expect(db.order.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', createdAt: { gte: since } },
      include: { items: true },
    })
  })

  it('omits tenantId from the where clause when not provided', async () => {
    db.order.findMany.mockResolvedValue([])
    const since = new Date('2025-01-01')

    await orderService.getRevenueSince(undefined, since)

    expect(db.order.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: since } },
      include: { items: true },
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.order.findMany.mockRejectedValue(new Error('db down'))

    await expect(
      orderService.getRevenueSince('ten-1', new Date('2025-01-01')),
    ).rejects.toThrow('Failed to fetch revenue orders')
  })
})
