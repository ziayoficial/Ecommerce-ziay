// Unit tests for src/lib/services/monetization.service.ts
// TASK: SPRINT-TESTS-001
//
// Covers the 4 public methods of `monetizationService`:
//   - getTramo (pure tier calculation, no DB)
//   - getGMV (5 parallel DB calls: tenant + 2 order aggregates + 1 commissionEntry
//     aggregate + 1 order groupBy + 1 invoice findFirst)
//   - getCommissions (parallel findMany + aggregate)
//   - generateInvoice (findMany → JS reduce → upsert via create/update → auditLog)
//
// Note: the task description showed decimal percentages (0.045 / 0.03 / 0.0175)
// but the actual service uses whole-number percentages (4.5 / 3.0 / 1.75). The
// tests below match the actual implementation per the rule "Read the actual
// service first to get the correct method signatures + return shapes".

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
// `vi.hoisted` ensures the mock object exists *before* vi.mock factories run
// (factories are hoisted to the top of the file by Vitest).
const { db } = vi.hoisted(() => {
  const mockDb = {
    tenant: {
      findUnique: vi.fn(),
    },
    order: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    commissionEntry: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    invoice: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    // Prisma's $transaction invokes the supplied async callback with a tx
    // client. The service uses the same `db` delegates inside the callback,
    // so we forward the mock object directly.
    $transaction: vi.fn(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
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

// Stub Sentry so captureError doesn't try to import the real Sentry SDK.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

// Import AFTER the vi.mock calls so the mocks take effect.
import { monetizationService, getTramo } from '@/lib/services/monetization.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getTramo — pure tier calculation
// ─────────────────────────────────────────────────────────────────────────────
describe('getTramo', () => {
  it('returns first tier (4.5%) for GMV < 10M', () => {
    const tramo = getTramo(5_000_000)
    expect(tramo.label).toBe('0-10M')
    expect(tramo.pct).toBe(4.5)
  })

  it('returns second tier (3.0%) for GMV 10M-40M', () => {
    const tramo = getTramo(20_000_000)
    expect(tramo.label).toBe('10-40M')
    expect(tramo.pct).toBe(3.0)
  })

  it('returns third tier (1.75%) for GMV > 40M', () => {
    const tramo = getTramo(50_000_000)
    expect(tramo.label).toBe('40M+')
    expect(tramo.pct).toBe(1.75)
  })

  it('returns first tier at exactly 0 GMV', () => {
    const tramo = getTramo(0)
    expect(tramo.label).toBe('0-10M')
    expect(tramo.pct).toBe(4.5)
  })

  it('returns second tier at exactly 10M (boundary: < 10M is tier 1, so 10M is tier 2)', () => {
    const tramo = getTramo(10_000_000)
    expect(tramo.label).toBe('10-40M')
    expect(tramo.pct).toBe(3.0)
  })

  it('returns third tier at exactly 40M (boundary)', () => {
    const tramo = getTramo(40_000_000)
    expect(tramo.label).toBe('40M+')
    expect(tramo.pct).toBe(1.75)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getGMV — 5 parallel DB calls + computation
// ─────────────────────────────────────────────────────────────────────────────
describe('monetizationService.getGMV', () => {
  it('returns aggregated GMV + funnel counts + commission math', async () => {
    // Stub tenant lookup
    db.tenant.findUnique.mockResolvedValue({
      id: 'ten-1',
      slug: 'ziay',
      nombreNegocio: 'Ziay Store',
      planMonetizacion: 'comision',
      feeBaseMensual: 100000,
    })

    // 1st order.aggregate — total GMV (sum of all agente_whatsapp order totals)
    // 2nd order.aggregate — gmvPaid (sum of paid orders)
    db.order.aggregate
      .mockResolvedValueOnce({ _sum: { total: 1_500_000 }, _count: 10 })
      .mockResolvedValueOnce({ _sum: { total: 900_000 } })

    // commissionEntry.aggregate — reconocida
    db.commissionEntry.aggregate.mockResolvedValue({
      _sum: { reconocidaMonto: 50000 },
    })

    // order.groupBy — status funnel (pending_confirmation / datos_completados /
    // despachado / intent_cancelacion)
    db.order.groupBy.mockResolvedValue([
      { status: 'pending_confirmation', _count: { _all: 3 } },
      { status: 'datos_completados', _count: { _all: 4 } },
      { status: 'despachado', _count: { _all: 2 } },
      { status: 'intent_cancelacion', _count: { _all: 1 } },
    ])

    // invoice.findFirst — current period invoice
    db.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      estado: 'borrador',
      total: 175000,
      emitidaAt: null,
    })

    const result = await monetizationService.getGMV('ten-1')

    // The service computes the tramo (1.5M < 10M → tier 1, 4.5%).
    // comisionCalculada = 1_500_000 * 4.5 / 100 = 67500.
    // pendiente = 67500 - 50000 = 17500.
    // totalEstimado = feeBaseMensual (100000) + comisionCalculada (67500) = 167500.
    expect(result).toEqual(
      expect.objectContaining({
        periodo: expect.any(String),
        gmv: 1_500_000,
        gmvPaid: 900_000,
        ordenes: 10,
        tramo: '0-10M',
        comisionPct: 4.5,
        comisionCalculada: 67500,
        comisionReconocida: 50000,
        comisionPendiente: 17500,
        feeBaseMensual: 100000,
        totalEstimado: 167500,
      }),
    )

    // Tenant sub-object
    expect(result!.tenant).toEqual({
      slug: 'ziay',
      nombreNegocio: 'Ziay Store',
      planMonetizacion: 'comision',
    })

    // Invoice sub-object
    expect(result!.invoice).toEqual({
      id: 'inv-1',
      estado: 'borrador',
      total: 175000,
      emitidaAt: null,
    })

    // Funnel counts
    expect(result!.embudo).toEqual({
      pendiente_confirmacion: 3,
      datos_completados: 4,
      despachado: 2,
      intento_cancelacion: 1,
    })

    // Verify the 2 order.aggregate calls — they should have the same shape but
    // different `where` (the 2nd filters on paymentStatus='paid').
    expect(db.order.aggregate).toHaveBeenCalledTimes(2)
    expect(db.order.aggregate).toHaveBeenNthCalledWith(1, {
      where: { tenantId: 'ten-1', origen: 'agente_whatsapp' },
      _sum: { total: true },
      _count: true,
    })
    expect(db.order.aggregate).toHaveBeenNthCalledWith(2, {
      where: {
        tenantId: 'ten-1',
        origen: 'agente_whatsapp',
        paymentStatus: 'paid',
      },
      _sum: { total: true },
    })

    expect(db.order.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { tenantId: 'ten-1', origen: 'agente_whatsapp' },
      _count: { _all: true },
    })
  })

  it('returns null when tenant does not exist', async () => {
    db.tenant.findUnique.mockResolvedValue(null)
    const result = await monetizationService.getGMV('ghost-tenant')
    expect(result).toBeNull()
    // The service returns BEFORE issuing any of the aggregate queries.
    expect(db.order.aggregate).not.toHaveBeenCalled()
    expect(db.commissionEntry.aggregate).not.toHaveBeenCalled()
    expect(db.order.groupBy).not.toHaveBeenCalled()
  })

  it('defaults _sum / _count to 0 when aggregate returns null (no rows match)', async () => {
    db.tenant.findUnique.mockResolvedValue({
      slug: 'ziay',
      nombreNegocio: 'Ziay',
      planMonetizacion: 'comision',
      feeBaseMensual: 0,
    })
    db.order.aggregate
      .mockResolvedValueOnce({ _sum: { total: null }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { total: null } })
    db.commissionEntry.aggregate.mockResolvedValue({ _sum: { reconocidaMonto: null } })
    db.order.groupBy.mockResolvedValue([])
    db.invoice.findFirst.mockResolvedValue(null)

    const result = await monetizationService.getGMV('ten-1')

    expect(result!.gmv).toBe(0)
    expect(result!.gmvPaid).toBe(0)
    expect(result!.ordenes).toBe(0)
    expect(result!.comisionCalculada).toBe(0)
    expect(result!.comisionReconocida).toBe(0)
    expect(result!.comisionPendiente).toBe(0)
    expect(result!.invoice).toBeNull()
    // Empty funnel — all 4 buckets default to 0.
    expect(result!.embudo).toEqual({
      pendiente_confirmacion: 0,
      datos_completados: 0,
      despachado: 0,
      intento_cancelacion: 0,
    })
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.tenant.findUnique.mockRejectedValue(new Error('db down'))
    await expect(monetizationService.getGMV('ten-1')).rejects.toThrow(
      'Failed to fetch GMV',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getCommissions — parallel findMany + aggregate
// ─────────────────────────────────────────────────────────────────────────────
describe('monetizationService.getCommissions', () => {
  it('returns entries + totals computed from a DB aggregate', async () => {
    const entries = [
      { id: 'ce-1', gmv: 100000, comisionTotal: 4500, reconocidaMonto: 2250 },
      { id: 'ce-2', gmv: 200000, comisionTotal: 9000, reconocidaMonto: 9000 },
    ]
    db.commissionEntry.findMany.mockResolvedValue(entries)
    db.commissionEntry.aggregate.mockResolvedValue({
      _sum: { gmv: 300000, comisionTotal: 13500, reconocidaMonto: 11250 },
    })

    const result = await monetizationService.getCommissions('ten-1')

    expect(result.entries).toEqual(entries)
    // totals: gmv=300000, comisionTotal=13500, reconocida=11250,
    // pendiente = 13500 - 11250 = 2250
    expect(result.totals).toEqual({
      gmv: 300000,
      comisionTotal: 13500,
      reconocida: 11250,
      pendiente: 2250,
    })

    // findMany is bounded at 50 entries, ordered by createdAt desc.
    expect(db.commissionEntry.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      include: {
        order: {
          select: { number: true, status: true, total: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    // Aggregate covers ALL rows (no `take`).
    expect(db.commissionEntry.aggregate).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      _sum: { gmv: true, comisionTotal: true, reconocidaMonto: true },
    })
  })

  it('defaults totals to 0 when aggregate returns null', async () => {
    db.commissionEntry.findMany.mockResolvedValue([])
    db.commissionEntry.aggregate.mockResolvedValue({
      _sum: { gmv: null, comisionTotal: null, reconocidaMonto: null },
    })

    const result = await monetizationService.getCommissions('ten-empty')
    expect(result.entries).toEqual([])
    expect(result.totals).toEqual({
      gmv: 0,
      comisionTotal: 0,
      reconocida: 0,
      pendiente: 0,
    })
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.commissionEntry.findMany.mockRejectedValue(new Error('boom'))
    await expect(monetizationService.getCommissions('ten-1')).rejects.toThrow(
      'Failed to fetch commissions',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateInvoice — findMany → reduce → upsert (create OR update) → auditLog
// ─────────────────────────────────────────────────────────────────────────────
describe('monetizationService.generateInvoice', () => {
  it('creates a new Invoice when none exists for the period + writes AuditLog', async () => {
    const orders = [
      { total: 100000, status: 'paid' },
      { total: 200000, status: 'shipped' },
      { total: 50000, status: 'cancelled' }, // filtered out
      { total: 30000, status: 'intent_cancelacion' }, // filtered out
    ]
    db.order.findMany.mockResolvedValue(orders)
    db.invoice.findFirst.mockResolvedValue(null) // no existing invoice
    db.invoice.create.mockResolvedValue({
      id: 'inv-new',
      tenantId: 'ten-1',
      periodo: '2025-01',
      gmvTotal: 300000,
      feeBase: 0,
      comisionTotal: 13500,
      tramoAplicado: '0-10M',
      total: 13500,
      estado: 'borrador',
    })
    db.auditLog.create.mockResolvedValue({ id: 'al-1' })

    const result = await monetizationService.generateInvoice('ten-1', '2025-01')

    // GMV = 100000 + 200000 = 300000 (cancelled + intent_cancelacion filtered)
    // tramo = 0-10M (300000 < 10M), pct = 4.5%
    // comisionTotal = round(300000 * 4.5 / 100) = 13500
    // total = feeBase (0) + comisionTotal (13500) = 13500
    expect(result.details).toEqual({
      periodo: '2025-01',
      orderCount: 2,
      gmv: 300000,
      tramo: '0-10M',
      comisionPct: 4.5,
      comisionTotal: 13500,
      total: 13500,
    })

    // Invoice created (not updated — findFirst returned null)
    expect(db.invoice.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        periodo: '2025-01',
        gmvTotal: 300000,
        feeBase: 0,
        comisionTotal: 13500,
        tramoAplicado: '0-10M',
        total: 13500,
        estado: 'borrador',
      },
    })
    expect(db.invoice.update).not.toHaveBeenCalled()

    // AuditLog recorded with the canonical 'invoice_generated' action.
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'invoice_generated',
        entity: 'invoice',
        entityId: 'inv-new',
        metadata: expect.stringContaining('"tenantId":"ten-1"'),
      }),
    })

    // order.findMany was scoped to the period (Jan 2025).
    expect(db.order.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'ten-1',
        createdAt: {
          gte: expect.any(Date),
          lte: expect.any(Date),
        },
      },
      select: { total: true, status: true },
    })
  })

  it('updates an existing Invoice when one already exists for the period', async () => {
    db.order.findMany.mockResolvedValue([{ total: 5000000, status: 'paid' }])
    db.invoice.findFirst.mockResolvedValue({
      id: 'inv-existing',
      tenantId: 'ten-1',
      periodo: '2025-02',
    })
    db.invoice.update.mockResolvedValue({
      id: 'inv-existing',
      gmvTotal: 5000000,
    })
    db.auditLog.create.mockResolvedValue({ id: 'al-2' })

    const result = await monetizationService.generateInvoice('ten-1', '2025-02')

    // GMV = 5M, tramo = 0-10M (5M < 10M), pct = 4.5%, comisionTotal = 225000
    expect(result.details.gmv).toBe(5000000)
    expect(result.details.comisionTotal).toBe(225000)
    expect(result.details.tramo).toBe('0-10M')

    // Invoice updated (not created — findFirst returned a row)
    expect(db.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-existing' },
      data: {
        gmvTotal: 5000000,
        feeBase: 0,
        comisionTotal: 225000,
        tramoAplicado: '0-10M',
        total: 225000,
      },
    })
    expect(db.invoice.create).not.toHaveBeenCalled()
  })

  it('uses higher commission tier (3.0%) when GMV crosses 10M', async () => {
    db.order.findMany.mockResolvedValue([{ total: 20_000_000, status: 'paid' }])
    db.invoice.findFirst.mockResolvedValue(null)
    db.invoice.create.mockResolvedValue({ id: 'inv-3' })
    db.auditLog.create.mockResolvedValue({ id: 'al-3' })

    const result = await monetizationService.generateInvoice('ten-1', '2025-03')

    // 20M → tier 2 (10-40M, 3.0%)
    // comisionTotal = round(20M * 3.0 / 100) = 600000
    expect(result.details.tramo).toBe('10-40M')
    expect(result.details.comisionPct).toBe(3.0)
    expect(result.details.comisionTotal).toBe(600000)
  })

  it('uses top tier (1.75%) when GMV crosses 40M', async () => {
    db.order.findMany.mockResolvedValue([{ total: 50_000_000, status: 'paid' }])
    db.invoice.findFirst.mockResolvedValue(null)
    db.invoice.create.mockResolvedValue({ id: 'inv-4' })
    db.auditLog.create.mockResolvedValue({ id: 'al-4' })

    const result = await monetizationService.generateInvoice('ten-1', '2025-04')

    // 50M → tier 3 (40M+, 1.75%)
    // comisionTotal = round(50M * 1.75 / 100) = 875000
    expect(result.details.tramo).toBe('40M+')
    expect(result.details.comisionPct).toBe(1.75)
    expect(result.details.comisionTotal).toBe(875000)
  })

  it('defaults the period to current YYYY-MM when not provided', async () => {
    db.order.findMany.mockResolvedValue([])
    db.invoice.findFirst.mockResolvedValue(null)
    db.invoice.create.mockResolvedValue({ id: 'inv-5' })
    db.auditLog.create.mockResolvedValue({ id: 'al-5' })

    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const result = await monetizationService.generateInvoice('ten-1')

    expect(result.details.periodo).toBe(expected)
    expect(db.invoice.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', periodo: expected },
    })
  })

  it('does NOT throw when the audit-log write fails (non-fatal)', async () => {
    db.order.findMany.mockResolvedValue([{ total: 100000, status: 'paid' }])
    db.invoice.findFirst.mockResolvedValue(null)
    db.invoice.create.mockResolvedValue({ id: 'inv-6' })
    // AuditLog create rejects — the service catches it and captures the error
    // but does NOT surface it to the caller (the invoice was already persisted).
    db.auditLog.create.mockRejectedValue(new Error('audit db down'))

    const result = await monetizationService.generateInvoice('ten-1', '2025-06')

    expect(result.invoice.id).toBe('inv-6')
    expect(result.details.gmv).toBe(100000)
  })

  it('throws a wrapped Error when the order.findMany rejects', async () => {
    db.order.findMany.mockRejectedValue(new Error('db'))
    await expect(
      monetizationService.generateInvoice('ten-1', '2025-01'),
    ).rejects.toThrow('Failed to generate invoice')
  })

  it('throws a wrapped Error when the invoice create rejects', async () => {
    db.order.findMany.mockResolvedValue([])
    db.invoice.findFirst.mockResolvedValue(null)
    db.invoice.create.mockRejectedValue(new Error('create failed'))
    await expect(
      monetizationService.generateInvoice('ten-1', '2025-01'),
    ).rejects.toThrow('Failed to generate invoice')
  })
})
