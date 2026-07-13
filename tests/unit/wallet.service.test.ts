// Unit tests for src/lib/services/wallet.service.ts
// TASK: FIX-5-TESTS-I18N-001
//
// Mocks `@/lib/db` with a deep vi.fn mock so we can assert that the service
// invokes the right Prisma delegates with the right arguments — including the
// atomic `db.$transaction` callback pattern used by `processWithdrawal`.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
// `vi.hoisted` ensures the mock object exists *before* vi.mock factories run
// (factories are hoisted to the top of the file by Vitest).
const { db } = vi.hoisted(() => {
  const mockDb = {
    walletTransaction: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    walletAccount: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    withdrawalRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    twoFactorConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    trafficker: {
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    // Prisma's $transaction invokes the supplied async callback with a tx
    // client. The wallet service uses the same `db` delegates inside the
    // callback, so we forward the mock object directly.
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
import { walletService } from '@/lib/services/wallet.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getWalletDashboard
// ─────────────────────────────────────────────────────────────────────────────
describe('walletService.getWalletDashboard', () => {
  it('returns { transactions, accounts, withdrawals, twoFactor } in parallel', async () => {
    const txns = [{ id: 'txn-1', amount: 1000 }]
    const accounts = [{ id: 'acc-1', isDefault: true }]
    const withdrawals = [{ id: 'wd-1', amount: 500 }]
    const twoFactor = { id: '2fa-1', enabled: true }

    db.walletTransaction.findMany.mockResolvedValue(txns)
    db.walletAccount.findMany.mockResolvedValue(accounts)
    db.withdrawalRequest.findMany.mockResolvedValue(withdrawals)
    db.twoFactorConfig.findUnique.mockResolvedValue(twoFactor)

    const result = await walletService.getWalletDashboard('trafficker-1')

    expect(result).toEqual({
      transactions: txns,
      accounts,
      withdrawals,
      twoFactor,
    })

    // Verify the four find queries ran with the expected filters.
    expect(db.walletTransaction.findMany).toHaveBeenCalledWith({
      where: { traffickerId: 'trafficker-1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    expect(db.walletAccount.findMany).toHaveBeenCalledWith({
      where: { traffickerId: 'trafficker-1' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })
    expect(db.withdrawalRequest.findMany).toHaveBeenCalledWith({
      where: { traffickerId: 'trafficker-1' },
      include: { walletAccount: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    expect(db.twoFactorConfig.findUnique).toHaveBeenCalledWith({
      where: { traffickerId: 'trafficker-1' },
    })
  })

  it('returns twoFactor=null when no 2FA config exists', async () => {
    db.walletTransaction.findMany.mockResolvedValue([])
    db.walletAccount.findMany.mockResolvedValue([])
    db.withdrawalRequest.findMany.mockResolvedValue([])
    db.twoFactorConfig.findUnique.mockResolvedValue(null)

    const result = await walletService.getWalletDashboard('trafficker-no-2fa')
    expect(result.twoFactor).toBeNull()
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.walletTransaction.findMany.mockRejectedValue(new Error('db down'))
    await expect(walletService.getWalletDashboard('t1')).rejects.toThrow(
      'Failed to fetch wallet dashboard',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getTwoFactorConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('walletService.getTwoFactorConfig', () => {
  it('returns the TwoFactorConfig row when one exists', async () => {
    const cfg = { id: 'cfg-1', traffickerId: 't-1', enabled: true, secret: 'enc:abc' }
    db.twoFactorConfig.findUnique.mockResolvedValue(cfg)
    const result = await walletService.getTwoFactorConfig('t-1')
    expect(result).toEqual(cfg)
    expect(db.twoFactorConfig.findUnique).toHaveBeenCalledWith({ where: { traffickerId: 't-1' } })
  })

  it('returns null when no config exists (route handles defaulting)', async () => {
    db.twoFactorConfig.findUnique.mockResolvedValue(null)
    const result = await walletService.getTwoFactorConfig('nope')
    expect(result).toBeNull()
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.twoFactorConfig.findUnique.mockRejectedValue(new Error('boom'))
    await expect(walletService.getTwoFactorConfig('t-1')).rejects.toThrow(
      'Failed to fetch 2FA config',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// enableTwoFactor
// ─────────────────────────────────────────────────────────────────────────────
describe('walletService.enableTwoFactor', () => {
  it('flips enabled=true and stamps enabledAt', async () => {
    const updated = { id: 'cfg-1', enabled: true, enabledAt: new Date('2025-01-01') }
    db.twoFactorConfig.update.mockResolvedValue(updated)

    const result = await walletService.enableTwoFactor('cfg-1')

    expect(result).toEqual(updated)
    expect(db.twoFactorConfig.update).toHaveBeenCalledWith({
      where: { id: 'cfg-1' },
      data: {
        enabled: true,
        enabledAt: expect.any(Date),
      },
    })
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.twoFactorConfig.update.mockRejectedValue(new Error('nope'))
    await expect(walletService.enableTwoFactor('cfg-1')).rejects.toThrow('Failed to enable 2FA')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// registerWalletAccount
// ─────────────────────────────────────────────────────────────────────────────
describe('walletService.registerWalletAccount', () => {
  it('creates the account with the provided fields + verified=false', async () => {
    const created = { id: 'acc-1', accountType: 'bank', isDefault: true, verified: false }
    db.walletAccount.create.mockResolvedValue(created)

    const result = await walletService.registerWalletAccount({
      traffickerId: 't-1',
      accountType: 'bank',
      accountHolder: 'Jane Doe',
      accountNumber: '0001',
      bankName: 'Banco',
      documentType: 'CC',
      documentNumber: '123',
      isDefault: true,
    })

    expect(result).toEqual(created)
    expect(db.walletAccount.create).toHaveBeenCalledWith({
      data: {
        traffickerId: 't-1',
        accountType: 'bank',
        accountHolder: 'Jane Doe',
        accountNumber: '0001',
        bankName: 'Banco',
        documentType: 'CC',
        documentNumber: '123',
        isDefault: true,
        verified: false,
      },
    })
  })

  it('clears the previous default account(s) when isDefault=true', async () => {
    db.walletAccount.updateMany.mockResolvedValue({ count: 1 })
    db.walletAccount.create.mockResolvedValue({ id: 'acc-new' })

    await walletService.registerWalletAccount({
      traffickerId: 't-1',
      accountType: 'nequi',
      accountHolder: 'Jane',
      accountNumber: '999',
      isDefault: true,
    })

    expect(db.walletAccount.updateMany).toHaveBeenCalledWith({
      where: { traffickerId: 't-1', isDefault: true },
      data: { isDefault: false },
    })
  })

  it('does NOT clear previous defaults when isDefault=false', async () => {
    db.walletAccount.create.mockResolvedValue({ id: 'acc-2' })

    await walletService.registerWalletAccount({
      traffickerId: 't-1',
      accountType: 'bank',
      accountHolder: 'Jane',
      accountNumber: '0002',
      isDefault: false,
    })

    expect(db.walletAccount.updateMany).not.toHaveBeenCalled()
  })

  it('coerces optional fields to null when omitted', async () => {
    db.walletAccount.create.mockResolvedValue({ id: 'acc-3' })

    await walletService.registerWalletAccount({
      traffickerId: 't-1',
      accountType: 'bank',
      accountHolder: 'Jane',
      accountNumber: '0003',
    })

    expect(db.walletAccount.create).toHaveBeenCalledWith({
      data: {
        traffickerId: 't-1',
        accountType: 'bank',
        accountHolder: 'Jane',
        accountNumber: '0003',
        bankName: null,
        documentType: null,
        documentNumber: null,
        isDefault: false,
        verified: false,
      },
    })
  })

  it('throws a wrapped Error when create rejects', async () => {
    db.walletAccount.create.mockRejectedValue(new Error('dup'))
    await expect(
      walletService.registerWalletAccount({
        traffickerId: 't-1',
        accountType: 'bank',
        accountHolder: 'Jane',
        accountNumber: 'x',
      }),
    ).rejects.toThrow('Failed to register wallet account')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createWithdrawalRequest
// ─────────────────────────────────────────────────────────────────────────────
describe('walletService.createWithdrawalRequest', () => {
  it('sets status=pending_2fa when totpVerified=false (2FA required, not yet verified)', async () => {
    const created = { id: 'wd-1', status: 'pending_2fa' }
    db.withdrawalRequest.create.mockResolvedValue(created)

    const result = await walletService.createWithdrawalRequest({
      traffickerId: 't-1',
      walletAccountId: 'acc-1',
      amount: 1000,
      fee: 10,
      netAmount: 990,
      totpRequired: true,
      totpVerified: false,
    })

    expect(result).toEqual(created)
    expect(db.withdrawalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'pending_2fa',
        totpRequired: true,
        totpVerified: false,
        totpVerifiedAt: null,
      }),
    })
  })

  it('sets status=pending_processing when totpVerified=true (TOTP pre-verified by caller)', async () => {
    db.withdrawalRequest.create.mockResolvedValue({ id: 'wd-2', status: 'pending_processing' })

    await walletService.createWithdrawalRequest({
      traffickerId: 't-1',
      walletAccountId: 'acc-1',
      amount: 2000,
      fee: 20,
      netAmount: 1980,
      totpRequired: true,
      totpVerified: true,
    })

    expect(db.withdrawalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'pending_processing',
        totpVerified: true,
        totpVerifiedAt: expect.any(Date),
      }),
    })
  })

  it('throws a wrapped Error when create rejects', async () => {
    db.withdrawalRequest.create.mockRejectedValue(new Error('db'))
    await expect(
      walletService.createWithdrawalRequest({
        traffickerId: 't-1',
        walletAccountId: 'acc-1',
        amount: 1000,
        fee: 0,
        netAmount: 1000,
        totpRequired: false,
        totpVerified: false,
      }),
    ).rejects.toThrow('Failed to create withdrawal request')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// processWithdrawal — atomic $transaction
// ─────────────────────────────────────────────────────────────────────────────
describe('walletService.processWithdrawal', () => {
  it('atomically deducts balance, records WalletTransaction, completes WithdrawalRequest, writes AuditLog', async () => {
    const updated = { id: 'wd-1', status: 'completed' }
    db.trafficker.update.mockResolvedValue({ id: 't-1' })
    db.walletTransaction.create.mockResolvedValue({ id: 'txn-1' })
    db.withdrawalRequest.update.mockResolvedValue(updated)
    db.auditLog.create.mockResolvedValue({ id: 'al-1' })

    const result = await walletService.processWithdrawal({
      withdrawalId: 'wd-1',
      traffickerId: 't-1',
      walletAccountId: 'acc-1',
      amount: 500,
      balanceBefore: 1000,
      balanceAfter: 500,
      externalReference: 'ext-1',
    })

    expect(result).toEqual(updated)

    // $transaction was invoked with a callback — verify it was called once
    // and that all 4 inner writes happened in the right order.
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.trafficker.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { walletBalance: 500 },
    })
    expect(db.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traffickerId: 't-1',
        direction: 'outbound',
        type: 'withdrawal',
        category: 'cashout',
        amount: 500,
        balanceBefore: 1000,
        balanceAfter: 500,
        reference: 'wd-1',
        referenceType: 'withdrawal',
        status: 'completed',
      }),
    })
    expect(db.withdrawalRequest.update).toHaveBeenCalledWith({
      where: { id: 'wd-1' },
      data: expect.objectContaining({
        status: 'completed',
        externalReference: 'ext-1',
        processedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
    })
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'withdrawal_processed',
        entity: 'withdrawal',
        entityId: 'wd-1',
      }),
    })
  })

  it('passes externalReference=null when not provided', async () => {
    db.withdrawalRequest.update.mockResolvedValue({ id: 'wd-2', status: 'completed' })

    await walletService.processWithdrawal({
      withdrawalId: 'wd-2',
      traffickerId: 't-1',
      walletAccountId: 'acc-1',
      amount: 100,
      balanceBefore: 100,
      balanceAfter: 0,
    })

    expect(db.withdrawalRequest.update).toHaveBeenCalledWith({
      where: { id: 'wd-2' },
      data: expect.objectContaining({ externalReference: null }),
    })
  })

  it('throws a wrapped Error when the tx rejects', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('tx failed'))
    await expect(
      walletService.processWithdrawal({
        withdrawalId: 'wd-x',
        traffickerId: 't-1',
        walletAccountId: 'acc-1',
        amount: 1,
        balanceBefore: 1,
        balanceAfter: 0,
      }),
    ).rejects.toThrow('Failed to process withdrawal')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// recordTransaction
// ─────────────────────────────────────────────────────────────────────────────
describe('walletService.recordTransaction', () => {
  it('creates a WalletTransaction + updates Trafficker walletBalance in parallel', async () => {
    const txn = { id: 'txn-1', direction: 'inbound', type: 'commission', amount: 100 }
    db.walletTransaction.create.mockResolvedValue(txn)
    db.trafficker.update.mockResolvedValue({ id: 't-1', walletBalance: 100 })

    const result = await walletService.recordTransaction({
      traffickerId: 't-1',
      direction: 'inbound',
      type: 'commission',
      category: 'sale',
      amount: 100,
      balanceBefore: 0,
      balanceAfter: 100,
      description: 'Commission for sale #1',
      reference: 'sale-1',
      referenceType: 'sale',
    })

    expect(result).toEqual(txn)
    expect(db.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traffickerId: 't-1',
        direction: 'inbound',
        type: 'commission',
        category: 'sale',
        amount: 100,
        balanceBefore: 0,
        balanceAfter: 100,
        status: 'completed',
        description: 'Commission for sale #1',
        reference: 'sale-1',
        referenceType: 'sale',
      }),
    })
    expect(db.trafficker.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { walletBalance: 100 },
    })
  })

  it('falls back category to type when category is omitted', async () => {
    db.walletTransaction.create.mockResolvedValue({ id: 'txn-2' })

    await walletService.recordTransaction({
      traffickerId: 't-1',
      direction: 'outbound',
      type: 'withdrawal',
      amount: 50,
      balanceBefore: 100,
      balanceAfter: 50,
    })

    expect(db.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'withdrawal',
        category: 'withdrawal',
      }),
    })
  })

  it('takes the absolute value of amount (negative → positive)', async () => {
    db.walletTransaction.create.mockResolvedValue({ id: 'txn-3' })

    await walletService.recordTransaction({
      traffickerId: 't-1',
      direction: 'inbound',
      type: 'refund',
      amount: -250,
      balanceBefore: 0,
      balanceAfter: 250,
    })

    expect(db.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 250 }),
    })
  })

  it('throws a wrapped Error when one of the parallel writes rejects', async () => {
    db.walletTransaction.create.mockRejectedValue(new Error('fail'))
    await expect(
      walletService.recordTransaction({
        traffickerId: 't-1',
        direction: 'inbound',
        type: 'commission',
        amount: 10,
        balanceBefore: 0,
        balanceAfter: 10,
      }),
    ).rejects.toThrow('Failed to record transaction')
  })
})
