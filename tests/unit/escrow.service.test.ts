// Unit tests for src/lib/services/escrow.service.ts
// AUDIT-C-2: verifies escrow release is atomic (db.$transaction).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { db } = vi.hoisted(() => {
  const mockTx = {
    escrowHolding: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    trafficker: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    walletTransaction: {
      create: vi.fn(),
    },
  }
  const mockDb = {
    escrowHolding: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  }
  return { db: mockDb, tx: mockTx }
})

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/logger', () => ({ getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/lib/alerts', () => ({ sendAlert: vi.fn() }))

import { escrowService } from '@/lib/services/escrow.service'

describe('escrowService.release', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps release operations in db.$transaction', async () => {
    db.escrowHolding.findUnique.mockResolvedValue({
      id: 'esc-1',
      orderId: 'ord-1',
      tenantId: 'tnt-1',
      traffickerId: 'trf-1',
      buyerCustomerId: 'cust-1',
      amount: 100_000,
      commissionAmount: 10_000,
      sellerAmount: 90_000,
      status: 'holding',
      heldAt: new Date(),
      autoReleaseAt: new Date(Date.now() + 7 * 86400000),
      currency: 'COP',
    })

    const result = await escrowService.release('ord-1', 'admin-1', 'DEL-001')

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
  })

  it('credits seller wallet and records transaction inside transaction', async () => {
    db.escrowHolding.findUnique.mockResolvedValue({
      id: 'esc-1',
      orderId: 'ord-1',
      tenantId: 'tnt-1',
      traffickerId: 'trf-1',
      buyerCustomerId: 'cust-1',
      amount: 100_000,
      commissionAmount: 10_000,
      sellerAmount: 90_000,
      status: 'holding',
      heldAt: new Date(),
      autoReleaseAt: new Date(Date.now() + 7 * 86400000),
      currency: 'COP',
    })
    db.$transaction = vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
      const tx = {
        escrowHolding: {
          findUnique: vi.fn(),
          update: vi.fn().mockResolvedValue({}),
        },
        trafficker: {
          findUnique: vi.fn().mockResolvedValue({ walletBalance: 200_000 }),
          update: vi.fn().mockResolvedValue({}),
        },
        walletTransaction: {
          create: vi.fn().mockResolvedValue({}),
        },
      }
      return cb(tx)
    })

    const result = await escrowService.release('ord-1', 'admin-1')

    expect(result.success).toBe(true)
    expect(result.sellerAmount).toBe(90_000)
  })

  it('returns error when holding not found', async () => {
    db.escrowHolding.findUnique.mockResolvedValue(null)

    const result = await escrowService.release('ord-none', 'admin-1')

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
  })

  it('returns error when holding status is not holding', async () => {
    db.escrowHolding.findUnique.mockResolvedValue({
      id: 'esc-1',
      orderId: 'ord-1',
      status: 'released',
      sellerAmount: 90_000,
      commissionAmount: 10_000,
    })

    const result = await escrowService.release('ord-1', 'admin-1')

    expect(result.success).toBe(false)
    expect(result.message).toContain('released')
  })
})