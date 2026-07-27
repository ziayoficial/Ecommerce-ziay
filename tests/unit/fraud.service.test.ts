// Unit tests for src/lib/services/fraud.service.ts
// Task ID: ANTIFRAUD-VERIFY-001 (Hallazgo #1 — CRITICAL: 0% test coverage)
//
// These tests verify the end-to-behavior of the fraud service: that
// blocklisted customers get blocked, that OFAC SDN names get caught,
// that velocity windows trigger blocks at the right thresholds, and
// that the fail-open behavior works when the DB is unavailable.
//
// The mock pattern follows tests/unit/wallet.service.test.ts:
// `vi.hoisted` + `vi.mock('@/lib/db')` with deep vi.fn mocks.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Mock db (Prisma) ────────────────────────────────────────────────────────
// vi.hoisted ensures the mock object exists before vi.mock factories run.
const { db } = vi.hoisted(() => {
  const mockDb = {
    fraudBlocklistEntry: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    velocityWindow: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    fraudEvent: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    order: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    orderEvent: {
      create: vi.fn(),
    },
    fxRate: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (arr) => Promise.all(arr)),
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Mock logger + captureError so they don't write to stdout during tests
vi.mock('@/lib/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))
vi.mock('@/lib/capture-error', () => ({
  captureError: vi.fn(),
}))

// Import AFTER mocks are set up
import { fraudService, maskPii } from '@/lib/services/fraud.service'

// ─── Test 1: maskPii (pure function, no mocks needed) ───────────────────────

describe('fraudService.maskPii', () => {
  it('masks email: foo@bar.com → f***@bar.com', () => {
    expect(maskPii('email', 'foo@bar.com')).toBe('f**@bar.com')
  })

  it('masks phone: +57 300 123 4567 → last 4 digits', () => {
    const result = maskPii('phone', '+57 300 123 4567')
    expect(result).toContain('4567')
    expect(result).toContain('***')
    expect(result).not.toContain('123')
  })

  it('masks card: 4242424242424242 → BIN + last 4', () => {
    const result = maskPii('card', '4242424242424242')
    expect(result).toContain('424242')
    expect(result).toContain('4242')
    expect(result).toContain('*')
    expect(result).not.toContain('4242424242424242')
  })

  it('masks ip: 190.0.0.1 → 190.0.***.1', () => {
    expect(maskPii('ip', '190.0.0.1')).toBe('190.0.***.1')
  })

  it('masks other: returns ***', () => {
    expect(maskPii('other', 'anything')).toBe('***')
  })

  it('handles empty/undefined gracefully', () => {
    expect(maskPii('email', '')).toBe('')
    expect(maskPii('email', undefined)).toBe('')
    expect(maskPii('email', null)).toBe('')
  })
})

// ─── Test 2: checkBlocklist ──────────────────────────────────────────────────

describe('fraudService.checkBlocklist', () => {  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns blocked=true when entry exists and is unexpired', async () => {
    db.fraudBlocklistEntry.findUnique.mockResolvedValue({
      id: 'bl-1',
      reason: 'chargeback',
      source: 'auto',
      expiresAt: null,
    })

    const result = await fraudService.checkBlocklist('ten-1', 'bad@email.com', 'email')

    expect(result.blocked).toBe(true)
    expect(result.reason).toContain('chargeback')
    expect(db.fraudBlocklistEntry.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_type_value: {
          tenantId: 'ten-1',
          type: 'email',
          value: 'bad@email.com',
        },
      },
    })
  })

  it('returns blocked=false when entry is expired', async () => {
    db.fraudBlocklistEntry.findUnique.mockResolvedValue({
      id: 'bl-1',
      reason: 'chargeback',
      source: 'auto',
      expiresAt: new Date(Date.now() - 1000), // expired 1s ago
    })

    const result = await fraudService.checkBlocklist('ten-1', 'bad@email.com', 'email')

    expect(result.blocked).toBe(false)
  })

  it('returns blocked=false when entry does not exist', async () => {
    db.fraudBlocklistEntry.findUnique.mockResolvedValue(null)

    const result = await fraudService.checkBlocklist('ten-1', 'good@email.com', 'email')

    expect(result.blocked).toBe(false)
  })

  it('fail-open: returns blocked=false on DB error', async () => {
    db.fraudBlocklistEntry.findUnique.mockRejectedValue(new Error('DB down'))

    const result = await fraudService.checkBlocklist('ten-1', 'any@email.com', 'email')

    expect(result.blocked).toBe(false)
  })
})

// ─── Test 3: ofacScreen ──────────────────────────────────────────────────────

describe('fraudService.ofacScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear OFAC_API_KEY so we use the local seed list
    delete process.env.OFAC_API_KEY
  })

  it('returns hit=true when name matches local SDN seed (OSAMA BIN LADEN)', async () => {
    const result = await fraudService.ofacScreen('Osama Bin Laden')
    expect(result.hit).toBe(true)
    expect(result.match).toContain('OSAMA BIN LADEN')
  })

  it('returns hit=true when name matches KIM JONG UN', async () => {
    const result = await fraudService.ofacScreen('Kim Jong Un')
    expect(result.hit).toBe(true)
  })

  it('returns hit=false for a normal name', async () => {
    const result = await fraudService.ofacScreen('Juan Perez')
    expect(result.hit).toBe(false)
  })

  it('returns hit=false for empty/undefined name', async () => {
    expect((await fraudService.ofacScreen('')).hit).toBe(false)
    expect((await fraudService.ofacScreen(undefined)).hit).toBe(false)
  })

  it('falls back to local seed when OFAC API is configured but unreachable', async () => {
    process.env.OFAC_API_KEY = 'test-key'
    // Mock global fetch to throw (simulates network error)
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

    const result = await fraudService.ofacScreen('Nicolas Maduro')

    expect(result.hit).toBe(true)
    expect(result.match).toContain('NICOLAS MADURO')

    // Restore
    globalThis.fetch = originalFetch
    delete process.env.OFAC_API_KEY
  })})

// ─── Test 4: velocityCheck ───────────────────────────────────────────────────

describe('fraudService.velocityCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns blocked=false when count is below threshold', async () => {
    db.velocityWindow.findMany.mockResolvedValue([
      { count: 5 },
      { count: 3 },
    ]) // total 8, threshold 20

    const result = await fraudService.velocityCheck('ten-1', '1.2.3.4', 1, 20, 'ip')

    expect(result.blocked).toBe(false)
    expect(result.count).toBe(8)
  })

  it('returns blocked=true when count reaches threshold', async () => {
    db.velocityWindow.findMany.mockResolvedValue([
      { count: 15 },
      { count: 10 },
    ]) // total 25, threshold 20

    const result = await fraudService.velocityCheck('ten-1', '1.2.3.4', 1, 20, 'ip')

    expect(result.blocked).toBe(true)
    expect(result.count).toBe(25)
  })

  it('fail-open: returns blocked=false on DB error', async () => {
    db.velocityWindow.findMany.mockRejectedValue(new Error('DB down'))

    const result = await fraudService.velocityCheck('ten-1', '1.2.3.4', 1, 20, 'ip')

    expect(result.blocked).toBe(false)
    expect(result.count).toBe(0)
  })
})

// ─── Test 5: checkTransaction — block scenarios ──────────────────────────────

describe('fraudService.checkTransaction — block decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OFAC_API_KEY
    // Default: no blocklist hits, no velocity hits, no OFAC hits
    db.fraudBlocklistEntry.findUnique.mockResolvedValue(null)
    db.velocityWindow.findMany.mockResolvedValue([])
    db.fraudEvent.create.mockResolvedValue({})
    db.velocityWindow.upsert.mockResolvedValue({})
    db.fxRate.findUnique.mockResolvedValue(null)
  })

  it('blocks when customer is in blocklist', async () => {
    // First findUnique call (customer blocklist) returns an entry
    db.fraudBlocklistEntry.findUnique.mockResolvedValueOnce({
      id: 'bl-1',
      reason: 'chargeback',
      source: 'auto',
      expiresAt: null,
    })

    const result = await fraudService.checkTransaction({
      tenantId: 'ten-1',
      customerId: 'cust-bad',
      amount: 100,
      currency: 'USD',
      countryCode: 'CO',
      paymentMethod: 'stripe',
      isReturningCustomer: true,
    })

    expect(result.decision).toBe('block')
    expect(result.riskScore).toBe(100)
    expect(result.reasons.some((r) => r.includes('blocklist hit'))).toBe(true)
  })

  it('blocks when customer name matches OFAC SDN', async () => {
    const result = await fraudService.checkTransaction({
      tenantId: 'ten-1',
      customerId: 'cust-1',
      customerName: 'Bashar Al-Assad',
      amount: 50,
      currency: 'USD',
      countryCode: 'CO',
      paymentMethod: 'stripe',
      isReturningCustomer: true,
    })

    expect(result.decision).toBe('block')
    expect(result.reasons.some((r) => r.includes('OFAC'))).toBe(true)
  })

  it('blocks when country is sanctioned (CU)', async () => {
    const result = await fraudService.checkTransaction({
      tenantId: 'ten-1',
      customerId: 'cust-1',
      customerName: 'Juan Perez',      amount: 50,
      currency: 'USD',
      countryCode: 'CU',
      paymentMethod: 'stripe',
      isReturningCustomer: true,
    })

    expect(result.decision).toBe('block')
    expect(result.reasons.some((r) => r.includes('sanctioned country'))).toBe(true)
  })

  it('blocks when velocity IP hard cap is exceeded', async () => {
    // Mock velocity findMany to return count >= 60 (VELOCITY_IP_HARD_CAP default)
    db.velocityWindow.findMany.mockResolvedValueOnce([{ count: 65 }])

    const result = await fraudService.checkTransaction({
      tenantId: 'ten-1',
      customerId: 'cust-1',
      customerName: 'Juan Perez',
      customerIp: '1.2.3.4',
      amount: 50,
      currency: 'USD',
      countryCode: 'CO',
      paymentMethod: 'stripe',
      isReturningCustomer: true,
    })

    expect(result.decision).toBe('block')
    expect(result.reasons.some((r) => r.includes('velocity IP hard cap'))).toBe(true)
  })
})

// ─── Test 6: checkTransaction — allow scenario ───────────────────────────────

describe('fraudService.checkTransaction — allow decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OFAC_API_KEY
    db.fraudBlocklistEntry.findUnique.mockResolvedValue(null)
    db.velocityWindow.findMany.mockResolvedValue([])
    db.fraudEvent.create.mockResolvedValue({})
    db.velocityWindow.upsert.mockResolvedValue({})
    db.fxRate.findUnique.mockResolvedValue(null)
  })

  it('allows a clean returning customer with low amount', async () => {
    const result = await fraudService.checkTransaction({
      tenantId: 'ten-1',
      customerId: 'cust-1',
      customerName: 'Juan Perez',
      customerEmail: 'juan@example.com',
      customerIp: '1.2.3.4',
      amount: 30,
      currency: 'USD',
      countryCode: 'CO',
      paymentMethod: 'stripe',
      isReturningCustomer: true,
    })

    expect(result.decision).toBe('allow')
    expect(result.riskScore).toBeLessThan(60)
    expect(result.checksRun).toContain('blocklist')
    expect(result.checksRun).toContain('ofac')
    expect(result.checksRun).toContain('velocity')
  })
})

// ─── Test 7: recordChargeback ────────────────────────────────────────────────

describe('fraudService.recordChargeback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks order as payment_mismatch and blocklists the customer', async () => {
    db.order.findFirst.mockResolvedValue({
      id: 'ord-1',
      customerId: 'cust-1',
      customer: { email: 'bad@email.com', phone: '+57 300 123 4567' },
    })
    db.order.update.mockResolvedValue({})
    db.orderEvent.create.mockResolvedValue({})
    db.fraudBlocklistEntry.upsert.mockResolvedValue({})

    await fraudService.recordChargeback('ten-1', 'ord-1', 'fraudulent')

    // Order should be marked payment_mismatch
    expect(db.$transaction).toHaveBeenCalled()
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-1' },
        data: expect.objectContaining({
          paymentStatus: 'payment_mismatch',
        }),
      }),
    )

    // Customer should be added to blocklist
    expect(db.fraudBlocklistEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_type_value: {            tenantId: 'ten-1',
            type: 'customer',
            value: 'cust-1',
          },
        },
        create: expect.objectContaining({
          reason: 'chargeback',
          source: 'auto',
        }),
      }),
    )

    // Email should also be blocklisted
    expect(db.fraudBlocklistEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_type_value: {
            tenantId: 'ten-1',
            type: 'email',
            value: 'bad@email.com',
          },
        },
      }),
    )

    // Phone should also be blocklisted
    expect(db.fraudBlocklistEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_type_value: {
            tenantId: 'ten-1',
            type: 'phone',
            value: '+57 300 123 4567',
          },
        },
      }),
    )
  })

  it('does nothing when order is not found', async () => {
    db.order.findFirst.mockResolvedValue(null)

    await fraudService.recordChargeback('ten-1', 'ord-nonexistent', 'fraudulent')

    // No blocklist upserts should happen
    expect(db.fraudBlocklistEntry.upsert).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
  })
})

// ─── Test 8: addToBlocklist + checkBlocklist round-trip ──────────────────────

describe('fraudService.addToBlocklist + checkBlocklist round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('addToBlocklist upserts the entry, checkBlocklist then finds it', async () => {
    // Simulate the upsert succeeding
    db.fraudBlocklistEntry.upsert.mockResolvedValue({})
    // Simulate the subsequent findUnique returning the blocklisted entry
    db.fraudBlocklistEntry.findUnique.mockResolvedValue({
      id: 'bl-1',
      reason: 'fraud_report',
      source: 'manual',
      expiresAt: null,
    })

    // 1. Add to blocklist
    await fraudService.addToBlocklist('ten-1', {
      type: 'email',
      value: 'fraudster@bad.com',
      reason: 'fraud_report',
      source: 'manual',
    })

    expect(db.fraudBlocklistEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_type_value: {
            tenantId: 'ten-1',
            type: 'email',
            value: 'fraudster@bad.com',
          },
        },
        create: expect.objectContaining({
          reason: 'fraud_report',
          source: 'manual',
        }),
      }),
    )

    // 2. Check blocklist — should now find it
    const result = await fraudService.checkBlocklist('ten-1', 'fraudster@bad.com', 'email')

    expect(result.blocked).toBe(true)
    expect(result.reason).toContain('fraud_report')
  })
})
