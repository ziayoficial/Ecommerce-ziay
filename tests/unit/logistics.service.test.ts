// Unit tests for src/lib/services/logistics.service.ts
// TASK: SPRINT-TESTS-001
//
// Covers the 4 task-listed methods (mapped to actual method names where they
// differ from the task description):
//   - getScores          → customer-score leaderboard (top 200)
//   - getCarrierScores   → carrier-score leaderboard (top 200)
//   - persistShipmentGuide → atomic-ish Shipment + Order update + OrderEvent +
//                          AuditLog writes (sequential — no $transaction
//                          because the carrier adapter already created the
//                          guide on the carrier side)
//   - upsertBuyerBehavior → upserts a BuyerBehavior row keyed by
//                          (tenantId, phone), creates a BehaviorAlert when the
//                          new risk level is `high_risk` or `blacklist`
//
// Mock pattern mirrors wallet.service.test.ts — vi.hoisted + deep vi.fn mock
// for the db delegates the service touches.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    customerScore: {
      findMany: vi.fn(),
    },
    carrierScore: {
      findMany: vi.fn(),
    },
    guideTracking: {
      findMany: vi.fn(),
    },
    guideMovement: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    behaviorAlert: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    buyerBehavior: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      upsert: vi.fn(),
    },
    shipment: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    order: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    orderEvent: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Stub logger so tests don't print pino output.
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

import { logisticsService } from '@/lib/services/logistics.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getScores
// ─────────────────────────────────────────────────────────────────────────────
describe('logisticsService.getScores', () => {
  it('returns the customer-score leaderboard sorted by score desc, capped at 200', async () => {
    const scores = [
      { id: 'cs-1', tenantId: 'ten-1', phone: '3001', score: 95, category: 'confiable' },
      { id: 'cs-2', tenantId: 'ten-1', phone: '3002', score: 50, category: 'riesgo' },
      { id: 'cs-3', tenantId: 'ten-1', phone: '3003', score: 0, category: 'devolvedor' },
    ]
    db.customerScore.findMany.mockResolvedValue(scores)

    const result = await logisticsService.getScores('ten-1')

    expect(result).toEqual(scores)
    expect(db.customerScore.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      orderBy: { score: 'desc' },
      take: 200,
    })
  })

  it('returns an empty array when the tenant has no scored customers', async () => {
    db.customerScore.findMany.mockResolvedValue([])
    const result = await logisticsService.getScores('ten-empty')
    expect(result).toEqual([])
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.customerScore.findMany.mockRejectedValue(new Error('boom'))
    await expect(logisticsService.getScores('ten-1')).rejects.toThrow(
      'Failed to fetch customer scores',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getCarrierScores
// ─────────────────────────────────────────────────────────────────────────────
describe('logisticsService.getCarrierScores', () => {
  it('returns the carrier-score leaderboard sorted by score desc, capped at 200', async () => {
    const scores = [
      { id: 'crs-1', tenantId: 'ten-1', carrierName: 'dropi', score: 92 },
      { id: 'crs-2', tenantId: 'ten-1', carrierName: '99envios', score: 88 },
    ]
    db.carrierScore.findMany.mockResolvedValue(scores)

    const result = await logisticsService.getCarrierScores('ten-1')

    expect(result).toEqual(scores)
    expect(db.carrierScore.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      orderBy: { score: 'desc' },
      take: 200,
    })
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.carrierScore.findMany.mockRejectedValue(new Error('boom'))
    await expect(logisticsService.getCarrierScores('ten-1')).rejects.toThrow(
      'Failed to fetch carrier scores',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// persistShipmentGuide — sequential writes (no $transaction by design)
// ─────────────────────────────────────────────────────────────────────────────
describe('logisticsService.persistShipmentGuide', () => {
  it('creates Shipment, updates Order status + shipping, writes OrderEvent + AuditLog', async () => {
    const shipment = {
      id: 'ship-1',
      tenantId: 'ten-1',
      orderId: 'ord-1',
      proveedor: 'dropi',
      numeroGuia: 'GUIDE-001',
      estado: 'generada',
    }
    db.shipment.create.mockResolvedValue(shipment)
    db.order.update.mockResolvedValue({ id: 'ord-1' })
    db.orderEvent.create.mockResolvedValue({ id: 'oe-1' })
    db.auditLog.create.mockResolvedValue({ id: 'al-1' })

    const result = await logisticsService.persistShipmentGuide({
      tenantId: 'ten-1',
      orderId: 'ord-1',
      customerId: 'cus-1',
      proveedor: 'dropi',
      numeroGuia: 'GUIDE-001',
      urlSeguimiento: 'https://track.example/GUIDE-001',
      transportadora: 'Dropi',
      transportadoraCanonica: 'dropi',
      tarifa: 9500,
      tiempoEstimadoDias: 3,
      orderNumber: 'ORD-2024-001',
    })

    expect(result.shipment).toEqual(shipment)
    // The eventNote format is part of the public contract (used by the API
    // response) — assert the structure so a regression is caught.
    expect(result.eventNote).toBe(
      'Guía GUIDE-001 (dropi) — $9500 COP, ETA 3 días',
    )

    // Shipment.create with estado='generada'
    expect(db.shipment.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        orderId: 'ord-1',
        proveedor: 'dropi',
        numeroGuia: 'GUIDE-001',
        urlSeguimiento: 'https://track.example/GUIDE-001',
        transportadora: 'Dropi',
        transportadoraCanonica: 'dropi',
        tarifa: 9500,
        tiempoEstimadoDias: 3,
        estado: 'generada',
      },
    })

    // Order.update flips status='shipped' + shipping=tarifa
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { status: 'shipped', shipping: 9500 },
    })

    // OrderEvent.create with type='shipped'
    expect(db.orderEvent.create).toHaveBeenCalledWith({
      data: {
        orderId: 'ord-1',
        type: 'shipped',
        note: 'Guía GUIDE-001 (dropi) — $9500 COP, ETA 3 días',
      },
    })

    // AuditLog.create with the canonical action + JSON metadata
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        action: 'shipping_guide_generated',
        entity: 'shipment',
        entityId: 'ship-1',
        metadata: expect.stringContaining('"numero_guia":"GUIDE-001"'),
      }),
    })

    // No $transaction — the writes are sequential by design (carrier adapter
    // already pushed the guide to the carrier, so a rollback would not
    // un-generate the carrier-side guide).
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('defaults urlSeguimiento to null when not provided', async () => {
    db.shipment.create.mockResolvedValue({ id: 'ship-2' })
    db.order.update.mockResolvedValue({})
    db.orderEvent.create.mockResolvedValue({})
    db.auditLog.create.mockResolvedValue({})

    await logisticsService.persistShipmentGuide({
      tenantId: 'ten-1',
      orderId: 'ord-2',
      customerId: 'cus-2',
      proveedor: 'dropi',
      numeroGuia: 'GUIDE-002',
      transportadora: 'Dropi',
      transportadoraCanonica: 'dropi',
      tarifa: 5000,
      tiempoEstimadoDias: 2,
      orderNumber: 'ORD-2024-002',
    })

    expect(db.shipment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ urlSeguimiento: null }),
    })
  })

  it('throws a wrapped Error when shipment.create rejects', async () => {
    db.shipment.create.mockRejectedValue(new Error('db'))
    await expect(
      logisticsService.persistShipmentGuide({
        tenantId: 'ten-1',
        orderId: 'ord-x',
        customerId: 'cus-x',
        proveedor: 'dropi',
        numeroGuia: 'GUIDE-X',
        transportadora: 'Dropi',
        transportadoraCanonica: 'dropi',
        tarifa: 1000,
        tiempoEstimadoDias: 1,
        orderNumber: 'ORD-X',
      }),
    ).rejects.toThrow('Failed to persist shipment guide')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// upsertBuyerBehavior
// ─────────────────────────────────────────────────────────────────────────────
describe('logisticsService.upsertBuyerBehavior', () => {
  it('upserts the behavior and returns alert=null for normal risk', async () => {
    const behavior = {
      id: 'bb-1',
      tenantId: 'ten-1',
      phone: '5712345678',
      riskLevel: 'normal',
      patternDetails: null,
    }
    db.buyerBehavior.upsert.mockResolvedValue(behavior)

    const result = await logisticsService.upsertBuyerBehavior({
      tenantId: 'ten-1',
      phone: '5712345678',
      riskLevel: 'normal',
    })

    expect(result.behavior).toEqual(behavior)
    expect(result.alert).toBeNull()

    // No alert created for normal/caution levels.
    expect(db.behaviorAlert.create).not.toHaveBeenCalled()

    // Upsert keyed by the (tenantId, phone) compound unique.
    expect(db.buyerBehavior.upsert).toHaveBeenCalledWith({
      where: {
        tenantId_phone: { tenantId: 'ten-1', phone: '5712345678' },
      },
      create: {
        tenantId: 'ten-1',
        phone: '5712345678',
        riskLevel: 'normal',
        patternDetails: null,
      },
      update: {
        riskLevel: 'normal',
        patternDetails: null,
      },
    })
  })

  it('returns alert=null for caution risk (also non-alerting)', async () => {
    db.buyerBehavior.upsert.mockResolvedValue({
      id: 'bb-2',
      riskLevel: 'caution',
    })

    const result = await logisticsService.upsertBuyerBehavior({
      tenantId: 'ten-1',
      phone: '572',
      riskLevel: 'caution',
      patternDetails: '2 returns in 7 days',
    })

    expect(result.alert).toBeNull()
    expect(db.behaviorAlert.create).not.toHaveBeenCalled()
  })

  it('creates a BehaviorAlert when riskLevel=high_risk', async () => {
    const behavior = {
      id: 'bb-3',
      tenantId: 'ten-1',
      phone: '573',
      riskLevel: 'high_risk',
    }
    db.buyerBehavior.upsert.mockResolvedValue(behavior)
    db.behaviorAlert.create.mockResolvedValue({ id: 'alert-1' })

    const result = await logisticsService.upsertBuyerBehavior({
      tenantId: 'ten-1',
      phone: '573',
      riskLevel: 'high_risk',
      patternDetails: '5 returns in last month',
    })

    expect(result.behavior).toEqual(behavior)
    expect(result.alert).toEqual({ id: 'alert-1' })

    // Alert created with alertType=riskLevel + message including phone + reason.
    expect(db.behaviorAlert.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        buyerBehaviorId: 'bb-3',
        alertType: 'high_risk',
        message:
          'Cliente 573 marcado como high_risk: 5 returns in last month',
      },
      select: { id: true },
    })
  })

  it('creates a BehaviorAlert when riskLevel=blacklist', async () => {
    db.buyerBehavior.upsert.mockResolvedValue({
      id: 'bb-4',
      riskLevel: 'blacklist',
    })
    db.behaviorAlert.create.mockResolvedValue({ id: 'alert-2' })

    const result = await logisticsService.upsertBuyerBehavior({
      tenantId: 'ten-1',
      phone: '574',
      riskLevel: 'blacklist',
    })

    expect(result.alert).toEqual({ id: 'alert-2' })

    // Without patternDetails, the message omits the trailing `: <reason>`.
    expect(db.behaviorAlert.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        buyerBehaviorId: 'bb-4',
        alertType: 'blacklist',
        message: 'Cliente 574 marcado como blacklist',
      },
      select: { id: true },
    })
  })

  it('defaults patternDetails to null when not provided', async () => {
    db.buyerBehavior.upsert.mockResolvedValue({
      id: 'bb-5',
      riskLevel: 'normal',
    })

    await logisticsService.upsertBuyerBehavior({
      tenantId: 'ten-1',
      phone: '575',
      riskLevel: 'normal',
    })

    expect(db.buyerBehavior.upsert).toHaveBeenCalledWith({
      where: {
        tenantId_phone: { tenantId: 'ten-1', phone: '575' },
      },
      create: expect.objectContaining({
        patternDetails: null,
      }),
      update: expect.objectContaining({
        patternDetails: null,
      }),
    })
  })

  it('throws a wrapped Error when the upsert rejects', async () => {
    db.buyerBehavior.upsert.mockRejectedValue(new Error('db'))
    await expect(
      logisticsService.upsertBuyerBehavior({
        tenantId: 'ten-1',
        phone: '576',
        riskLevel: 'normal',
      }),
    ).rejects.toThrow('Failed to upsert buyer behavior')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getStuckGuides — added in SPRINT-TESTS-COMPLETE-001
//
// Stuck-guide leaderboard: rows where status='stuck' OR daysStuck>3, capped
// at 100 so the dashboard never renders thousands of rows.
// ─────────────────────────────────────────────────────────────────────────────
describe('logisticsService.getStuckGuides', () => {
  it('returns guides stuck for >3 days OR with status=stuck, capped at 100, ordered by daysStuck desc', async () => {
    const stuck = [
      {
        id: 'gt-1',
        tenantId: 'ten-1',
        guideNumber: 'GUIDE-001',
        status: 'stuck',
        daysStuck: 8,
      },
      {
        id: 'gt-2',
        tenantId: 'ten-1',
        guideNumber: 'GUIDE-002',
        status: 'in_transit',
        daysStuck: 5,
      },
    ]
    db.guideTracking.findMany.mockResolvedValue(stuck)

    const result = await logisticsService.getStuckGuides('ten-1')

    expect(result).toEqual(stuck)
    expect(db.guideTracking.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'ten-1',
        OR: [{ status: 'stuck' }, { daysStuck: { gt: 3 } }],
      },
      orderBy: { daysStuck: 'desc' },
      take: 100,
    })
  })

  it('returns an empty array when the tenant has no stuck guides', async () => {
    db.guideTracking.findMany.mockResolvedValue([])
    const result = await logisticsService.getStuckGuides('ten-clean')
    expect(result).toEqual([])
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.guideTracking.findMany.mockRejectedValue(new Error('boom'))
    await expect(logisticsService.getStuckGuides('ten-1')).rejects.toThrow(
      'Failed to fetch stuck guides',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getGuideMovements — added in SPRINT-TESTS-COMPLETE-001
//
// Lists GuideMovement rows for a tenant, optionally filtered by guideNumber.
// Caps at 200 rows when a guideNumber is given (full history) or 100
// (tenant-wide).
// ─────────────────────────────────────────────────────────────────────────────
describe('logisticsService.getGuideMovements', () => {
  it('returns tenant-wide movements capped at 100 when no guideNumber is provided', async () => {
    const movements = [
      {
        id: 'gm-1',
        tenantId: 'ten-1',
        guideNumber: 'GUIDE-001',
        eventType: 'in_transit',
        createdAt: new Date(),
      },
      {
        id: 'gm-2',
        tenantId: 'ten-1',
        guideNumber: 'GUIDE-002',
        eventType: 'delivered',
        createdAt: new Date(),
      },
    ]
    db.guideMovement.findMany.mockResolvedValue(movements)

    const result = await logisticsService.getGuideMovements('ten-1')

    expect(result).toEqual(movements)
    expect(db.guideMovement.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  })

  it('filters by guideNumber + caps at 200 when guideNumber is provided (full history)', async () => {
    db.guideMovement.findMany.mockResolvedValue([])

    await logisticsService.getGuideMovements('ten-1', 'GUIDE-001')

    expect(db.guideMovement.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', guideNumber: 'GUIDE-001' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  })

  it('returns an empty array when the tenant has no movements', async () => {
    db.guideMovement.findMany.mockResolvedValue([])
    const result = await logisticsService.getGuideMovements('ten-empty')
    expect(result).toEqual([])
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.guideMovement.findMany.mockRejectedValue(new Error('db down'))
    await expect(logisticsService.getGuideMovements('ten-1')).rejects.toThrow(
      'Failed to fetch guide movements',
    )
  })
})
