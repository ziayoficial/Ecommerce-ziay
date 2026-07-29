// Unit tests for src/lib/services/conversions.service.ts
// TASK: SPRINT-AUDITLOG-TESTS-001
//
// NOTE on method-name mapping: the task description referenced
// `fireConversionEvent` and `getConversions`, but the actual service exposes:
//   - createEvent(input)   → persists a single ConversionEvent row (the closest
//                            equivalent to "fireConversionEvent" — the actual
//                            platform POST lives in the `capi-fire` queue worker,
//                            not in this service. The service owns the
//                            persistence seam only, per the file header).
//   - getEvents(tenantId)  → returns { events, stats } (the closest equivalent
//                            to "getConversions"). The task description's name
//                            is a slight mismatch — we test the actual API.
//   - getActivePixels     → load active PixelConfig rows (used before fan-out)
//   - getEventsByIds      → read-back by id (used after inline queue exec)
//
// "Handles failed fire (marks as 'failed')" is covered by:
//   - createEvent(status='failed') writes a row already in the failed state
//     (the queue worker also transitions existing rows to 'failed', but that
//     path is in queue.ts, not in this service).
//
// Mock pattern mirrors wallet.service.test.ts — vi.hoisted + deep vi.fn mock
// for every db delegate the service touches.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    conversionEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    pixelConfig: {
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

import { conversionsService } from '@/lib/services/conversions.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getEvents — returns events + stats (sent/failed/pending)
// ─────────────────────────────────────────────────────────────────────────────
describe('conversionsService.getEvents', () => {
  it('returns the most-recent 100 events + JS-derived stats {total, sent, failed, pending}', async () => {
    const events = [
      { id: 'ce-1', status: 'sent', eventType: 'Purchase', value: 1000 },
      { id: 'ce-2', status: 'sent', eventType: 'Purchase', value: 2000 },
      { id: 'ce-3', status: 'failed', eventType: 'Purchase', value: 500 },
      { id: 'ce-4', status: 'pending', eventType: 'Lead', value: null },
    ]
    db.conversionEvent.findMany.mockResolvedValue(events)

    const result = await conversionsService.getEvents('ten-1')

    expect(result.events).toEqual(events)
    expect(result.stats).toEqual({
      total: 4,
      sent: 2,
      failed: 1,
      pending: 1,
    })

    expect(db.conversionEvent.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  })

  it('returns zeroed stats when no events exist for the tenant', async () => {
    db.conversionEvent.findMany.mockResolvedValue([])

    const result = await conversionsService.getEvents('ten-empty')

    expect(result.events).toEqual([])
    expect(result.stats).toEqual({ total: 0, sent: 0, failed: 0, pending: 0 })
  })

  it('counts unknown statuses only in total (not in sent/failed/pending)', async () => {
    db.conversionEvent.findMany.mockResolvedValue([
      { id: 'ce-1', status: 'unknown_status' },
    ])

    const result = await conversionsService.getEvents('ten-1')

    expect(result.stats).toEqual({
      total: 1,
      sent: 0,
      failed: 0,
      pending: 0,
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.conversionEvent.findMany.mockRejectedValue(new Error('db down'))

    await expect(conversionsService.getEvents('ten-1')).rejects.toThrow(
      'Failed to fetch conversion events',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getActivePixels — loads active PixelConfig rows for fan-out
// ─────────────────────────────────────────────────────────────────────────────
describe('conversionsService.getActivePixels', () => {
  it('returns the active PixelConfig rows for the tenant', async () => {
    const pixels = [
      {
        id: 'px-1',
        platform: 'meta',
        pixelId: '123',
        apiToken: 'secret',
        active: true,
      },
      {
        id: 'px-2',
        platform: 'google',
        pixelId: 'G-XXX',
        apiToken: 'secret2',
        active: true,
      },
    ]
    db.pixelConfig.findMany.mockResolvedValue(pixels)

    const result = await conversionsService.getActivePixels('ten-1')

    expect(result).toEqual(pixels)
    expect(db.pixelConfig.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', active: true },
    })
  })

  it('returns empty array when no active pixels exist', async () => {
    db.pixelConfig.findMany.mockResolvedValue([])

    const result = await conversionsService.getActivePixels('ten-empty')
    expect(result).toEqual([])
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.pixelConfig.findMany.mockRejectedValue(new Error('db down'))

    await expect(conversionsService.getActivePixels('ten-1')).rejects.toThrow(
      'Failed to fetch pixel configs',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createEvent — persists a ConversionEvent (default status=pending)
// ─────────────────────────────────────────────────────────────────────────────
describe('conversionsService.createEvent', () => {
  it('creates a row with status=pending + currency=COP defaults when omitted', async () => {
    const created = {
      id: 'ce-1',
      tenantId: 'ten-1',
      pixelConfigId: null,
      eventType: 'Purchase',
      value: null,
      currency: 'COP',
      status: 'pending',
      response: null,
    }
    db.conversionEvent.create.mockResolvedValue(created)

    const result = await conversionsService.createEvent({
      tenantId: 'ten-1',
      pixelConfigId: null,
      eventType: 'Purchase',
    })

    expect(result).toEqual(created)
    expect(db.conversionEvent.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        pixelConfigId: null,
        eventType: 'Purchase',
        value: null,
        currency: 'COP',
        status: 'pending',
        response: null,
      },
    })
  })

  it('honors explicit value / currency / status / response when provided', async () => {
    db.conversionEvent.create.mockResolvedValue({ id: 'ce-2' })

    await conversionsService.createEvent({
      tenantId: 'ten-1',
      pixelConfigId: 'px-1',
      eventType: 'Lead',
      value: 1234.56,
      currency: 'USD',
      status: 'sent',
      response: '{"id":"meta_evt_1"}',
    })

    expect(db.conversionEvent.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        pixelConfigId: 'px-1',
        eventType: 'Lead',
        value: 1234.56,
        currency: 'USD',
        status: 'sent',
        response: '{"id":"meta_evt_1"}',
      },
    })
  })

  it('persists a row with status=failed (marks the conversion as failed on creation)', async () => {
    db.conversionEvent.create.mockResolvedValue({ id: 'ce-failed' })

    const result = await conversionsService.createEvent({
      tenantId: 'ten-1',
      pixelConfigId: 'px-1',
      eventType: 'Purchase',
      status: 'failed',
      response: '{"error":"invalid pixel token"}',
    })

    expect(result).toEqual({ id: 'ce-failed' })
    expect(db.conversionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'failed',
        response: '{"error":"invalid pixel token"}',
      }),
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.conversionEvent.create.mockRejectedValue(new Error('db down'))

    await expect(
      conversionsService.createEvent({
        tenantId: 'ten-1',
        pixelConfigId: null,
        eventType: 'Purchase',
      }),
    ).rejects.toThrow('Failed to create conversion event')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getEventsByIds — read-back after inline queue exec
// ─────────────────────────────────────────────────────────────────────────────
describe('conversionsService.getEventsByIds', () => {
  it('returns the rows matching the supplied ids', async () => {
    const rows = [
      { id: 'ce-1', status: 'sent' },
      { id: 'ce-2', status: 'failed' },
    ]
    db.conversionEvent.findMany.mockResolvedValue(rows)

    const result = await conversionsService.getEventsByIds(['ce-1', 'ce-2'])

    expect(result).toEqual(rows)
    expect(db.conversionEvent.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['ce-1', 'ce-2'] } },
    })
  })

  it('short-circuits with an empty array when ids is empty (avoids a useless query)', async () => {
    const result = await conversionsService.getEventsByIds([])

    expect(result).toEqual([])
    expect(db.conversionEvent.findMany).not.toHaveBeenCalled()
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.conversionEvent.findMany.mockRejectedValue(new Error('db down'))

    await expect(
      conversionsService.getEventsByIds(['ce-1']),
    ).rejects.toThrow('Failed to fetch conversion events by id')
  })
})
