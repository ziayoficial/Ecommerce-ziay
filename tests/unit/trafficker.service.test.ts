// Unit tests for src/lib/services/trafficker.service.ts
// TASK: FIX-5-TESTS-I18N-001
//
// Covers the 6 methods that touch money: getTraffickerByEmail, createTrafficker,
// registerSale, confirmSale (atomic $transaction), failSale (atomic $transaction
// with conditional compensation), requestWithdrawal (atomic $transaction).
//
// `db.$transaction` is mocked to invoke the supplied callback with the same
// `db` object so we can assert on inner writes.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    trafficker: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    traffickerCampaign: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    traffickerSale: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    traffickerTransaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    traffickerCompensation: {
      create: vi.fn(),
    },
    walletTransaction: {
      create: vi.fn(),
    },
    withdrawalRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Stub logger — capture-error.ts imports `logger` directly.
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

import { traffickerService } from '@/lib/services/trafficker.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getTraffickerByEmail
// ─────────────────────────────────────────────────────────────────────────────
describe('traffickerService.getTraffickerByEmail', () => {
  it('returns the trafficker when one exists', async () => {
    const t = { id: 't-1', email: 'a@b.co', walletBalance: 100 }
    db.trafficker.findUnique.mockResolvedValue(t)

    const result = await traffickerService.getTraffickerByEmail('A@B.CO')
    expect(result).toEqual(t)
    // Service lowercases the email before lookup (case-insensitive).
    expect(db.trafficker.findUnique).toHaveBeenCalledWith({
      where: { email: 'a@b.co' },
    })
  })

  it('returns null when no trafficker matches', async () => {
    db.trafficker.findUnique.mockResolvedValue(null)
    const result = await traffickerService.getTraffickerByEmail('nobody@nowhere.co')
    expect(result).toBeNull()
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.trafficker.findUnique.mockRejectedValue(new Error('db'))
    await expect(traffickerService.getTraffickerByEmail('a@b.co')).rejects.toThrow(
      'Failed to fetch trafficker by email',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createTrafficker
// ─────────────────────────────────────────────────────────────────────────────
describe('traffickerService.createTrafficker', () => {
  it('creates a trafficker with default walletBalance=0 and status=active', async () => {
    const created = {
      id: 't-1',
      email: 'a@b.co',
      name: 'Alice',
      phone: null,
      walletBalance: 0,
      status: 'active',
    }
    db.trafficker.create.mockResolvedValue(created)

    const result = await traffickerService.createTrafficker({
      email: 'a@b.co',
      name: 'Alice',
      phone: '3001112222',
    })

    expect(result).toEqual(created)
    expect(db.trafficker.create).toHaveBeenCalledWith({
      data: {
        email: 'a@b.co',
        name: 'Alice',
        phone: '3001112222',
        walletBalance: 0,
        status: 'active',
      },
    })
  })

  it('defaults phone to null when omitted', async () => {
    db.trafficker.create.mockResolvedValue({ id: 't-2', walletBalance: 0 })

    await traffickerService.createTrafficker({
      email: 'b@b.co',
      name: 'Bob',
    })

    expect(db.trafficker.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ phone: null, walletBalance: 0 }),
    })
  })

  it('throws a wrapped Error when create rejects', async () => {
    db.trafficker.create.mockRejectedValue(new Error('unique violation'))
    await expect(
      traffickerService.createTrafficker({ email: 'dup@b.co', name: 'X' }),
    ).rejects.toThrow('Failed to create trafficker')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// registerSale
// ─────────────────────────────────────────────────────────────────────────────
describe('traffickerService.registerSale', () => {
  it('creates a Sale with status=pending (commission is recorded later at confirm time)', async () => {
    const sale = { id: 'sale-1', status: 'pending', amount: 1000, commission: 100 }
    db.traffickerSale.create.mockResolvedValue(sale)

    const result = await traffickerService.registerSale({
      traffickerId: 't-1',
      tenantId: 'ten-1',
      campaignId: 'camp-1',
      orderId: 'ord-1',
      amount: 1000,
      commission: 100,
    })

    expect(result).toEqual(sale)
    expect(db.traffickerSale.create).toHaveBeenCalledWith({
      data: {
        traffickerId: 't-1',
        tenantId: 'ten-1',
        campaignId: 'camp-1',
        orderId: 'ord-1',
        amount: 1000,
        commission: 100,
        status: 'pending',
      },
    })
  })

  it('defaults orderId to null when omitted', async () => {
    db.traffickerSale.create.mockResolvedValue({ id: 'sale-2' })

    await traffickerService.registerSale({
      traffickerId: 't-1',
      tenantId: 'ten-1',
      campaignId: 'camp-1',
      amount: 500,
      commission: 50,
    })

    expect(db.traffickerSale.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderId: null, status: 'pending' }),
    })
  })

  it('does NOT create a TraffickerTransaction at registration time', async () => {
    db.traffickerSale.create.mockResolvedValue({ id: 'sale-3' })

    await traffickerService.registerSale({
      traffickerId: 't-1',
      tenantId: 'ten-1',
      campaignId: 'camp-1',
      amount: 100,
      commission: 10,
    })

    expect(db.traffickerTransaction.create).not.toHaveBeenCalled()
  })

  it('throws a wrapped Error when create rejects', async () => {
    db.traffickerSale.create.mockRejectedValue(new Error('fk'))
    await expect(
      traffickerService.registerSale({
        traffickerId: 't-1',
        tenantId: 'ten-1',
        campaignId: 'nope',
        amount: 1,
        commission: 0,
      }),
    ).rejects.toThrow('Failed to register sale')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// confirmSale — atomic $transaction
// ─────────────────────────────────────────────────────────────────────────────
describe('traffickerService.confirmSale', () => {
  const sale = {
    id: 'sale-1',
    traffickerId: 't-1',
    tenantId: 'ten-1',
    campaignId: 'camp-1',
    amount: 1000,
    commission: 100,
    status: 'pending',
    campaign: { id: 'camp-1', name: 'Black Friday' },
  }
  const trafficker = { id: 't-1', walletBalance: 500 }

  it('atomically flips Sale→confirmed, credits Trafficker.balance, records TraffickerTransaction(commission, completed)', async () => {
    db.traffickerSale.findUnique.mockResolvedValue(sale)
    db.trafficker.findUnique.mockResolvedValue(trafficker)
    db.traffickerSale.update.mockResolvedValue({ ...sale, status: 'confirmed' })
    db.trafficker.update.mockResolvedValue({ ...trafficker, walletBalance: 600 })
    db.traffickerTransaction.create.mockResolvedValue({ id: 'tx-1' })

    const result = await traffickerService.confirmSale('sale-1')

    expect(result).toEqual({
      sale: { ...sale, status: 'confirmed' },
      transaction: { id: 'tx-1' },
    })

    expect(db.$transaction).toHaveBeenCalledTimes(1)

    // Sale is loaded with its campaign inside the tx.
    expect(db.traffickerSale.findUnique).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      include: { campaign: true },
    })
    // Trafficker is loaded inside the tx.
    expect(db.trafficker.findUnique).toHaveBeenCalledWith({ where: { id: 't-1' } })
    // Sale → confirmed
    expect(db.traffickerSale.update).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      data: { status: 'confirmed' },
    })
    // Trafficker.balance += commission (500 + 100 = 600)
    expect(db.trafficker.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { walletBalance: 600 },
    })
    // TraffickerTransaction(commission, inbound, completed) recorded
    expect(db.traffickerTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traffickerId: 't-1',
        direction: 'inbound',
        type: 'commission',
        category: 'sale',
        amount: 100,
        balanceBefore: 500,
        balanceAfter: 600,
        reference: 'sale-1',
        referenceType: 'sale',
        status: 'completed',
      }),
    })
  })

  it('throws (rolled back) when the sale does not exist', async () => {
    db.traffickerSale.findUnique.mockResolvedValue(null)

    await expect(traffickerService.confirmSale('missing')).rejects.toThrow(
      'Failed to confirm sale',
    )
    // Inner writes should not have happened because the tx threw early.
    expect(db.traffickerSale.update).not.toHaveBeenCalled()
    expect(db.trafficker.update).not.toHaveBeenCalled()
    expect(db.traffickerTransaction.create).not.toHaveBeenCalled()
  })

  it('throws (rolled back) when the trafficker vanishes mid-transaction', async () => {
    db.traffickerSale.findUnique.mockResolvedValue(sale)
    db.trafficker.findUnique.mockResolvedValue(null)

    await expect(traffickerService.confirmSale('sale-1')).rejects.toThrow(
      'Failed to confirm sale',
    )
    expect(db.traffickerSale.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// failSale — atomic $transaction with conditional compensation
// ─────────────────────────────────────────────────────────────────────────────
describe('traffickerService.failSale', () => {
  const sale = {
    id: 'sale-1',
    traffickerId: 't-1',
    tenantId: 'ten-1',
    campaignId: 'camp-1',
    amount: 1000,
    commission: 100,
    status: 'pending',
    campaign: { id: 'camp-1', name: 'Black Friday' },
  }

  it('when compensationPct=0: marks Sale→failed, NO balance change, NO TraffickerTransaction, still writes AuditLog', async () => {
    db.traffickerSale.findUnique.mockResolvedValue(sale)
    db.traffickerSale.update.mockResolvedValue({ ...sale, status: 'failed' })
    db.auditLog.create.mockResolvedValue({ id: 'al-1' })

    const result = await traffickerService.failSale('sale-1', 'seller_no_ship', 0)

    expect(result).toEqual({
      sale: { ...sale, status: 'failed' },
      compensation: null,
      compensationAmount: 0,
    })

    expect(db.traffickerSale.update).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      data: { status: 'failed' },
    })
    // No balance change because compensationAmount = 0.
    expect(db.trafficker.update).not.toHaveBeenCalled()
    expect(db.traffickerTransaction.create).not.toHaveBeenCalled()
    expect(db.traffickerCompensation.create).not.toHaveBeenCalled()
    // AuditLog is ALWAYS written.
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'sale_failed_with_compensation',
        entity: 'trafficker_sale',
        entityId: 'sale-1',
      }),
    })
  })

  it('when compensationPct>0: Sale→failed + Compensation + Trafficker.balance += compensationAmount + TraffickerTransaction + WalletTransaction + AuditLog', async () => {
    const trafficker = { id: 't-1', walletBalance: 200 }
    db.traffickerSale.findUnique.mockResolvedValue(sale)
    db.trafficker.findUnique.mockResolvedValue(trafficker)
    db.traffickerSale.update.mockResolvedValue({ ...sale, status: 'failed' })
    db.traffickerCompensation.create.mockResolvedValue({ id: 'comp-1' })
    db.trafficker.update.mockResolvedValue({ id: 't-1', walletBalance: 250 })
    db.traffickerTransaction.create.mockResolvedValue({ id: 'tx-1' })
    db.walletTransaction.create.mockResolvedValue({ id: 'wt-1' })
    db.auditLog.create.mockResolvedValue({ id: 'al-1' })

    // 50% compensation on a 100 commission → 50.
    const result = await traffickerService.failSale('sale-1', 'product_damaged', 0.5)

    expect(result.compensationAmount).toBe(50)
    expect(result.compensation).toEqual({ id: 'comp-1' })

    // Compensation row recorded.
    expect(db.traffickerCompensation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traffickerId: 't-1',
        tenantId: 'ten-1',
        saleId: 'sale-1',
        reason: 'product_damaged',
        amount: 50,
      }),
    })
    // Trafficker.balance += 50 (200 + 50 = 250)
    expect(db.trafficker.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { walletBalance: 250 },
    })
    // TraffickerTransaction(compensation, inbound, completed) recorded.
    expect(db.traffickerTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traffickerId: 't-1',
        direction: 'inbound',
        type: 'compensation',
        category: 'seller_fault',
        amount: 50,
        balanceBefore: 200,
        balanceAfter: 250,
        reference: 'sale-1',
        referenceType: 'sale',
        status: 'completed',
      }),
    })
    // WalletTransaction (for wallet view) also recorded.
    expect(db.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traffickerId: 't-1',
        direction: 'inbound',
        type: 'compensation',
        amount: 50,
        balanceBefore: 200,
        balanceAfter: 250,
      }),
    })
    // AuditLog always written.
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'sale_failed_with_compensation',
        entityId: 'sale-1',
      }),
    })
  })

  it('throws (rolled back) when the sale does not exist', async () => {
    db.traffickerSale.findUnique.mockResolvedValue(null)

    await expect(traffickerService.failSale('missing', 'x', 0)).rejects.toThrow(
      'Failed to fail sale',
    )
    expect(db.traffickerSale.update).not.toHaveBeenCalled()
    expect(db.auditLog.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// requestWithdrawal — atomic $transaction (NO balance deduction yet)
// ─────────────────────────────────────────────────────────────────────────────
describe('traffickerService.requestWithdrawal', () => {
  it('creates WithdrawalRequest(pending_2fa) + TraffickerTransaction(outbound, pending); NO balance deduction', async () => {
    const withdrawal = { id: 'wd-1', status: 'pending_2fa' }
    const transaction = { id: 'tx-1', status: 'pending' }
    db.withdrawalRequest.create.mockResolvedValue(withdrawal)
    db.traffickerTransaction.create.mockResolvedValue(transaction)

    const result = await traffickerService.requestWithdrawal({
      traffickerId: 't-1',
      walletAccountId: 'acc-1',
      amount: 1000,
      fee: 10,
      netAmount: 990,
      totpVerified: false,
      balanceBefore: 5000,
      accountType: 'bank',
      accountNumber: '0001',
    })

    expect(result).toEqual({ withdrawal, transaction })

    expect(db.$transaction).toHaveBeenCalledTimes(1)

    // WithdrawalRequest created with status=pending_2fa (TOTP not yet verified).
    expect(db.withdrawalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traffickerId: 't-1',
        walletAccountId: 'acc-1',
        amount: 1000,
        fee: 10,
        netAmount: 990,
        totpRequired: true,
        totpVerified: false,
        totpVerifiedAt: null,
        status: 'pending_2fa',
      }),
    })

    // TraffickerTransaction(outbound, withdrawal, pending) created.
    expect(db.traffickerTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traffickerId: 't-1',
        direction: 'outbound',
        type: 'withdrawal',
        category: 'cashout',
        amount: 1000,
        balanceBefore: 5000,
        balanceAfter: 5000, // NOT yet deducted — only on completion
        reference: 'wd-1',
        referenceType: 'withdrawal',
        status: 'pending',
      }),
    })

    // Critically: no trafficker.update — balance is NOT deducted yet.
    expect(db.trafficker.update).not.toHaveBeenCalled()
  })

  it('sets WithdrawalRequest.status=pending_processing when totpVerified=true', async () => {
    db.withdrawalRequest.create.mockResolvedValue({ id: 'wd-2', status: 'pending_processing' })
    db.traffickerTransaction.create.mockResolvedValue({ id: 'tx-2' })

    await traffickerService.requestWithdrawal({
      traffickerId: 't-1',
      walletAccountId: 'acc-1',
      amount: 2000,
      fee: 20,
      netAmount: 1980,
      totpVerified: true,
      balanceBefore: 5000,
      accountType: 'nequi',
      accountNumber: '999',
    })

    expect(db.withdrawalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'pending_processing',
        totpVerified: true,
        totpVerifiedAt: expect.any(Date),
      }),
    })
  })

  it('throws a wrapped Error when the tx rejects', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('tx'))
    await expect(
      traffickerService.requestWithdrawal({
        traffickerId: 't-1',
        walletAccountId: 'acc-1',
        amount: 1,
        fee: 0,
        netAmount: 1,
        totpVerified: false,
        balanceBefore: 0,
        accountType: 'bank',
        accountNumber: '0',
      }),
    ).rejects.toThrow('Failed to request withdrawal')
  })
})
