// Unit tests for src/lib/services/notification.service.ts
// TASK: SPRINT-AUDITLOG-TESTS-001
//
// Covers the 4 task-listed methods (mapped to actual method names where they
// differ from the task description):
//   - getNotifications            → returns { notifications, stats } with
//                                    groupBy counts for pending/sent/delivered/failed
//   - createNotification          → persists a row with status='pending'
//   - markAsSent / markAsDelivered → unified as `updateStatus` (single method
//                                    that stamps sentAt when transitioning to
//                                    'sent' or 'delivered')
//   - cancelPending               → unified as `cancelPendingBefore(tenantId, cutoff)`
//                                    bulk-updates stale pending rows to 'failed'
//
// Mock pattern mirrors wallet.service.test.ts — vi.hoisted + deep vi.fn mock
// for every db delegate the service touches.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    customerNotification: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    guideTracking: {
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

import { notificationService } from '@/lib/services/notification.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getNotifications — returns notifications + stats (groupBy)
// ─────────────────────────────────────────────────────────────────────────────
describe('notificationService.getNotifications', () => {
  it('returns the notifications list + stats derived from the groupBy counts', async () => {
    const notifications = [
      {
        id: 'n-1',
        type: 'shipping_update',
        status: 'pending',
        body: 'En camino',
      },
      {
        id: 'n-2',
        type: 'delivery_confirmation',
        status: 'delivered',
        body: 'Entregado',
      },
    ]
    db.customerNotification.findMany.mockResolvedValue(notifications)
    db.customerNotification.groupBy.mockResolvedValue([
      { status: 'pending', _count: { _all: 5 } },
      { status: 'sent', _count: { _all: 3 } },
      { status: 'delivered', _count: { _all: 12 } },
      { status: 'failed', _count: { _all: 2 } },
    ])

    const result = await notificationService.getNotifications('ten-1')

    expect(result.notifications).toEqual(notifications)
    expect(result.stats).toEqual({
      total: 22, // 5 + 3 + 12 + 2
      pending: 5,
      sent: 3,
      delivered: 12,
      failed: 2,
    })

    // findMany should be capped at 200 + ordered by createdAt desc
    expect(db.customerNotification.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    // groupBy should run against ALL statuses (not filtered by status)
    expect(db.customerNotification.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { tenantId: 'ten-1' },
      _count: { _all: true },
    })
  })

  it('injects status filter into findMany when supplied (but groupBy stays unfiltered)', async () => {
    db.customerNotification.findMany.mockResolvedValue([])
    db.customerNotification.groupBy.mockResolvedValue([])

    await notificationService.getNotifications('ten-1', 'pending')

    expect(db.customerNotification.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    // groupBy is ALWAYS unfiltered (so badges stay accurate across filters)
    expect(db.customerNotification.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { tenantId: 'ten-1' },
      _count: { _all: true },
    })
  })

  it('returns zeroed stats when no notifications exist for the tenant', async () => {
    db.customerNotification.findMany.mockResolvedValue([])
    db.customerNotification.groupBy.mockResolvedValue([])

    const result = await notificationService.getNotifications('ten-empty')

    expect(result.notifications).toEqual([])
    expect(result.stats).toEqual({
      total: 0,
      pending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
    })
  })

  it('computes total as the sum of returned per-status counts (not a separate query)', async () => {
    db.customerNotification.findMany.mockResolvedValue([])
    db.customerNotification.groupBy.mockResolvedValue([
      { status: 'pending', _count: { _all: 7 } },
      // Only pending rows exist — sent/delivered/failed should default to 0
    ])

    const result = await notificationService.getNotifications('ten-1')

    expect(result.stats).toEqual({
      total: 7,
      pending: 7,
      sent: 0,
      delivered: 0,
      failed: 0,
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.customerNotification.findMany.mockRejectedValue(new Error('db down'))

    await expect(notificationService.getNotifications('ten-1')).rejects.toThrow(
      'Failed to fetch notifications',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createNotification — persists with status='pending' + defaults channel
// ─────────────────────────────────────────────────────────────────────────────
describe('notificationService.createNotification', () => {
  it('creates a row with status=pending + channel=whatsapp (default) + customerName=null fallback', async () => {
    const created = { id: 'n-1', status: 'pending' }
    db.customerNotification.create.mockResolvedValue(created)

    const result = await notificationService.createNotification({
      tenantId: 'ten-1',
      customerPhone: '3001234567',
      type: 'shipping_update',
      body: 'En camino',
    })

    expect(result).toEqual(created)
    expect(db.customerNotification.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        customerPhone: '3001234567',
        customerName: null, // default when omitted
        type: 'shipping_update',
        channel: 'whatsapp', // default
        body: 'En camino',
        status: 'pending',
        scheduledAt: null, // default when omitted
        metadata: null, // default when omitted
      },
    })
  })

  it('honors explicit channel / customerName / scheduledAt / metadata when provided', async () => {
    db.customerNotification.create.mockResolvedValue({ id: 'n-2' })

    const scheduled = new Date('2025-12-01T10:00:00Z')
    await notificationService.createNotification({
      tenantId: 'ten-1',
      customerPhone: '3001',
      customerName: 'Jane Doe',
      type: 'remarketing',
      channel: 'sms',
      body: 'Vuelve!',
      scheduledAt: scheduled,
      metadata: JSON.stringify({ campaignId: 'cmp-1' }),
    })

    expect(db.customerNotification.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        customerPhone: '3001',
        customerName: 'Jane Doe',
        type: 'remarketing',
        channel: 'sms',
        body: 'Vuelve!',
        status: 'pending',
        scheduledAt: scheduled,
        metadata: JSON.stringify({ campaignId: 'cmp-1' }),
      },
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.customerNotification.create.mockRejectedValue(new Error('db down'))

    await expect(
      notificationService.createNotification({
        tenantId: 'ten-1',
        customerPhone: '3001',
        type: 'shipping_update',
        body: 'x',
      }),
    ).rejects.toThrow('Failed to create notification')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateStatus — markAsSent / markAsDelivered (unified method)
// ─────────────────────────────────────────────────────────────────────────────
describe('notificationService.updateStatus', () => {
  it('marks as sent + stamps sentAt (default = now) when status=sent', async () => {
    const updated = { id: 'n-1', status: 'sent', sentAt: new Date() }
    db.customerNotification.update.mockResolvedValue(updated)

    const result = await notificationService.updateStatus('n-1', 'sent')

    expect(result).toEqual(updated)
    expect(db.customerNotification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { status: 'sent', sentAt: expect.any(Date) },
    })
  })

  it('marks as delivered + stamps sentAt (default = now) when status=delivered', async () => {
    db.customerNotification.update.mockResolvedValue({ id: 'n-1', status: 'delivered' })

    await notificationService.updateStatus('n-1', 'delivered')

    expect(db.customerNotification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { status: 'delivered', sentAt: expect.any(Date) },
    })
  })

  it('honors opts.sentAt when supplied (does not overwrite with now())', async () => {
    db.customerNotification.update.mockResolvedValue({ id: 'n-1' })
    const explicit = new Date('2025-06-15T08:00:00Z')

    await notificationService.updateStatus('n-1', 'sent', { sentAt: explicit })

    expect(db.customerNotification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { status: 'sent', sentAt: explicit },
    })
  })

  it('does NOT stamp sentAt when transitioning to failed (no sentAt field)', async () => {
    db.customerNotification.update.mockResolvedValue({ id: 'n-1', status: 'failed' })

    await notificationService.updateStatus('n-1', 'failed')

    expect(db.customerNotification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { status: 'failed' }, // no sentAt key
    })
  })

  it('does NOT stamp sentAt when transitioning to pending', async () => {
    db.customerNotification.update.mockResolvedValue({ id: 'n-1', status: 'pending' })

    await notificationService.updateStatus('n-1', 'pending')

    expect(db.customerNotification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { status: 'pending' },
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.customerNotification.update.mockRejectedValue(new Error('db down'))

    await expect(
      notificationService.updateStatus('n-1', 'sent'),
    ).rejects.toThrow('Failed to update notification status')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// cancelPendingBefore — bulk fails stale pending
// ─────────────────────────────────────────────────────────────────────────────
describe('notificationService.cancelPendingBefore', () => {
  it('bulk-updates pending rows older than cutoff to status=failed and returns count', async () => {
    db.customerNotification.updateMany.mockResolvedValue({ count: 17 })

    const cutoff = new Date('2025-01-01')
    const result = await notificationService.cancelPendingBefore('ten-1', cutoff)

    expect(result).toBe(17)
    expect(db.customerNotification.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'ten-1',
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      data: { status: 'failed' },
    })
  })

  it('returns 0 when no rows match (updateMany resolves with count: 0)', async () => {
    db.customerNotification.updateMany.mockResolvedValue({ count: 0 })

    const result = await notificationService.cancelPendingBefore(
      'ten-1',
      new Date(),
    )
    expect(result).toBe(0)
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.customerNotification.updateMany.mockRejectedValue(new Error('db down'))

    await expect(
      notificationService.cancelPendingBefore('ten-1', new Date()),
    ).rejects.toThrow('Failed to cancel pending notifications')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// autoGenerateShippingUpdates — bonus coverage (GuideTracking → CustomerNotification)
// ─────────────────────────────────────────────────────────────────────────────
describe('notificationService.autoGenerateShippingUpdates', () => {
  it('creates notifications for in_transit guides that do not yet have a shipping_update row', async () => {
    const guides = [
      {
        guideNumber: 'GUIDE-1',
        carrierName: 'Servientrega',
        tenantId: 'ten-1',
      },
      {
        guideNumber: 'GUIDE-2',
        carrierName: 'Envia',
        tenantId: 'ten-1',
      },
    ]
    db.guideTracking.findMany.mockResolvedValue(guides)
    // First guide has no existing notification; second guide does
    db.customerNotification.findFirst
      .mockResolvedValueOnce(null) // GUIDE-1: not found
      .mockResolvedValueOnce({ id: 'existing' }) // GUIDE-2: already exists
    db.customerNotification.create.mockResolvedValue({
      id: 'n-new',
      type: 'shipping_update',
    })

    const result = await notificationService.autoGenerateShippingUpdates('ten-1')

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ id: 'n-new', type: 'shipping_update' })

    // Only one create call (for GUIDE-1)
    expect(db.customerNotification.create).toHaveBeenCalledTimes(1)
    expect(db.customerNotification.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        customerPhone: 'Servientrega', // legacy shape: carrierName || 'unknown'
        customerName: null,
        type: 'shipping_update',
        channel: 'whatsapp',
        body: 'Tu pedido con guía GUIDE-1 está en camino.',
        status: 'pending',
        metadata: JSON.stringify({ guideNumber: 'GUIDE-1' }),
      },
    })
  })

  it('uses "unknown" as customerPhone when carrierName is null', async () => {
    db.guideTracking.findMany.mockResolvedValue([
      { guideNumber: 'G-1', carrierName: null, tenantId: 'ten-1' },
    ])
    db.customerNotification.findFirst.mockResolvedValue(null)
    db.customerNotification.create.mockResolvedValue({ id: 'n-1' })

    await notificationService.autoGenerateShippingUpdates('ten-1')

    expect(db.customerNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerPhone: 'unknown' }),
      }),
    )
  })

  it('returns empty array when no in_transit guides exist', async () => {
    db.guideTracking.findMany.mockResolvedValue([])

    const result = await notificationService.autoGenerateShippingUpdates('ten-1')
    expect(result).toEqual([])
    expect(db.customerNotification.create).not.toHaveBeenCalled()
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.guideTracking.findMany.mockRejectedValue(new Error('db down'))

    await expect(
      notificationService.autoGenerateShippingUpdates('ten-1'),
    ).rejects.toThrow('Failed to auto-generate notifications')
  })
})
