// ZIAY — Wallet service layer.
//
// Owns WalletTransaction + WalletAccount + WithdrawalRequest +
// TwoFactorConfig access for the `/api/wallet` route (balance /
// 2FA / accounts / withdrawals / record-transaction).
//
// Trafficker registration, campaigns, sales, and compensation live in
// `trafficker.service.ts` (split out in AUDIT-FINAL-SPLIT-001). Both
// services are re-exported from `services/index.ts`.
//
// SPRINT8-SERVICES-REST-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:wallet')

export const walletService = {
  // ── Wallet dashboard (GET /api/wallet) ──────────────────────────────────

  /**
   * Load everything the wallet dashboard needs in parallel: transactions,
   * accounts, withdrawals, 2FA config. Returns the raw rows — the route
   * computes the inbound/outbound/net stats from `transactions`.
   */
  async getWalletDashboard(traffickerId: string) {
    try {
      const [transactions, accounts, withdrawals, twoFactor] = await Promise.all([
        db.walletTransaction.findMany({
          where: { traffickerId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.walletAccount.findMany({
          where: { traffickerId },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        }),
        db.withdrawalRequest.findMany({
          where: { traffickerId },
          include: { walletAccount: true },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        db.twoFactorConfig.findUnique({ where: { traffickerId } }),
      ])
      return { transactions, accounts, withdrawals, twoFactor }
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getWalletDashboard',
        traffickerId,
      })
      throw new Error('Failed to fetch wallet dashboard')
    }
  },

  // ── 2FA setup / verify ─────────────────────────────────────────────────

  async getTwoFactorConfig(traffickerId: string) {
    try {
      return await db.twoFactorConfig.findUnique({ where: { traffickerId } })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getTwoFactorConfig',
        traffickerId,
      })
      throw new Error('Failed to fetch 2FA config')
    }
  },

  /**
   * Upsert the 2FA config with the encrypted TOTP secret + hashed backup
   * codes. Used by `setup_2fa` — the route generates the secret/codes via
   * `generateTOTPSecret` + `hashBackupCodes` and passes them in.
   */
  async upsertTwoFactorSetup(
    traffickerId: string,
    payload: { secret: string; backupCodes: string },
  ) {
    try {
      return await db.twoFactorConfig.upsert({
        where: { traffickerId },
        update: {
          secret: payload.secret,
          backupCodes: payload.backupCodes,
          enabled: false,
          enabledAt: null,
        },
        create: {
          traffickerId,
          secret: payload.secret,
          backupCodes: payload.backupCodes,
          enabled: false,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'upsertTwoFactorSetup',
        traffickerId,
      })
      throw new Error('Failed to upsert 2FA config')
    }
  },

  async enableTwoFactor(configId: string) {
    try {
      return await db.twoFactorConfig.update({
        where: { id: configId },
        data: { enabled: true, enabledAt: new Date() },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'enableTwoFactor',
        configId,
      })
      throw new Error('Failed to enable 2FA')
    }
  },

  // ── Wallet accounts ────────────────────────────────────────────────────

  async getWalletAccount(id: string) {
    try {
      return await db.walletAccount.findUnique({ where: { id } })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getWalletAccount',
        id,
      })
      throw new Error('Failed to fetch wallet account')
    }
  },

  /**
   * Clear the previous default account(s) and create a new account. Both
   * writes happen sequentially — the route treats them as best-effort
   * (clearing the old default is non-critical if it fails).
   */
  async registerWalletAccount(input: {
    traffickerId: string
    accountType: string
    accountHolder: string
    accountNumber: string
    bankName?: string | null
    documentType?: string | null
    documentNumber?: string | null
    isDefault?: boolean
  }) {
    try {
      if (input.isDefault) {
        await db.walletAccount.updateMany({
          where: { traffickerId: input.traffickerId, isDefault: true },
          data: { isDefault: false },
        })
      }
      return await db.walletAccount.create({
        data: {
          traffickerId: input.traffickerId,
          accountType: input.accountType,
          accountHolder: input.accountHolder,
          accountNumber: input.accountNumber,
          bankName: input.bankName ?? null,
          documentType: input.documentType ?? null,
          documentNumber: input.documentNumber ?? null,
          isDefault: !!input.isDefault,
          verified: false,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'registerWalletAccount',
        traffickerId: input.traffickerId,
      })
      throw new Error('Failed to register wallet account')
    }
  },

  // ── Withdrawals ────────────────────────────────────────────────────────

  async getWithdrawalRequest(id: string) {
    try {
      return await db.withdrawalRequest.findUnique({ where: { id } })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getWithdrawalRequest',
        id,
      })
      throw new Error('Failed to fetch withdrawal request')
    }
  },

  /**
   * Create a WithdrawalRequest in `pending_2fa` (TOTP required, not yet
   * verified) or `pending_processing` (TOTP pre-verified by caller).
   *
   * AUDIT-FINTECH-V2 / R-20 — defense-in-depth amount validation. The API
   * route already validates `amount > 0`, but a direct caller of the service
   * (internal job, admin endpoint, migration script) could bypass the route
   * and pass a negative amount, which would INCREASE the trafficker balance
   * when `processWithdrawal` debits it (a negative debit = credit). The
   * upper bound (1_000_000_000) is a sanity guard against typos in internal
   * callers (e.g. passing cents instead of major units, or a missing decimal).
   * Both guards throw — the route layer surfaces a 4xx; an internal caller
   * surfaces a thrown Error. Either way, no WithdrawalRequest row is created.
   */
  async createWithdrawalRequest(input: {
    traffickerId: string
    walletAccountId: string
    amount: number
    fee: number
    netAmount: number
    totpRequired: boolean
    totpVerified: boolean
  }) {
    // R-20 — service-layer positive amount validation (defense-in-depth).
    if (!input.amount || !Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Withdrawal amount must be positive')
    }
    if (input.amount > 1_000_000_000) {
      // Sanity upper bound — protects against internal callers passing cents
      // instead of major units, or a missing decimal point.
      throw new Error('Withdrawal amount exceeds sanity bound')
    }
    try {
      const withdrawal = await db.withdrawalRequest.create({
        data: {
          traffickerId: input.traffickerId,
          walletAccountId: input.walletAccountId,
          amount: input.amount,
          fee: input.fee,
          netAmount: input.netAmount,
          totpRequired: input.totpRequired,
          totpVerified: input.totpVerified,
          totpVerifiedAt: input.totpVerified ? new Date() : null,
          status: input.totpVerified ? 'pending_processing' : 'pending_2fa',
        },
      })
      log.info(
        {
          traffickerId: input.traffickerId,
          withdrawalId: withdrawal.id,
          amount: input.amount,
          fee: input.fee,
          net: input.netAmount,
          totpRequired: input.totpRequired,
          totpVerified: input.totpVerified,
        },
        'withdrawal request created',
      )
      return withdrawal
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'createWithdrawalRequest',
        traffickerId: input.traffickerId,
      })
      throw new Error('Failed to create withdrawal request')
    }
  },

  /**
   * Process (complete) a withdrawal — atomic: decrement trafficker balance,
   * record outbound WalletTransaction, mark WithdrawalRequest completed,
   * write AuditLog. The whole transaction MUST succeed or roll back so the
   * balance + transaction + withdrawal can never diverge.
   *
   * AUDIT-FINTECH-V2 / R-20 — defense-in-depth amount validation. The
   * `createWithdrawalRequest` step already validates `amount > 0`, but a
   * direct caller that bypasses creation (e.g. an admin endpoint that
   * constructs `processWithdrawal` input from a row updated out-of-band)
   * could pass a negative amount here. A negative amount debited from the
   * trafficker balance would CREDIT it (theft vector). Validate again here.
   */
  async processWithdrawal(input: {
    withdrawalId: string
    traffickerId: string
    walletAccountId: string
    amount: number
    balanceBefore: number
    balanceAfter: number
    externalReference?: string | null
  }) {
    // R-20 — service-layer positive amount validation (defense-in-depth).
    if (!input.amount || !Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Withdrawal amount must be positive')
    }
    if (input.amount > 1_000_000_000) {
      throw new Error('Withdrawal amount exceeds sanity bound')
    }
    try {
      const result = await db.$transaction(async (tx) => {
        // 1. Decrement trafficker balance
        await tx.trafficker.update({
          where: { id: input.traffickerId },
          data: { walletBalance: input.balanceAfter },
        })
        // 2. Record outbound transaction
        await tx.walletTransaction.create({
          data: {
            traffickerId: input.traffickerId,
            direction: 'outbound',
            type: 'withdrawal',
            category: 'cashout',
            amount: input.amount,
            balanceBefore: input.balanceBefore,
            balanceAfter: input.balanceAfter,
            description: `Retiro #${input.withdrawalId.slice(-6)} a ${input.walletAccountId}`,
            reference: input.withdrawalId,
            referenceType: 'withdrawal',
            status: 'completed',
          },
        })
        // 3. Mark withdrawal as completed
        const updated = await tx.withdrawalRequest.update({
          where: { id: input.withdrawalId },
          data: {
            status: 'completed',
            externalReference: input.externalReference || null,
            processedAt: new Date(),
            completedAt: new Date(),
          },
        })
        // 4. Create audit log entry
        await tx.auditLog.create({
          data: {
            action: 'withdrawal_processed',
            entity: 'withdrawal',
            entityId: input.withdrawalId,
            metadata: JSON.stringify({
              withdrawalId: input.withdrawalId,
              traffickerId: input.traffickerId,
              amount: input.amount,
              balanceBefore: input.balanceBefore,
              balanceAfter: input.balanceAfter,
              processedBy: 'wallet_api',
            }),
          },
        })
        return updated
      })
      log.info(
        {
          traffickerId: input.traffickerId,
          withdrawalId: input.withdrawalId,
          amount: input.amount,
          balanceBefore: input.balanceBefore,
          balanceAfter: input.balanceAfter,
          externalReference: input.externalReference || null,
        },
        'withdrawal processed — balance debited',
      )
      return result
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'processWithdrawal',
        withdrawalId: input.withdrawalId,
      })
      throw new Error('Failed to process withdrawal')
    }
  },

  /**
   * Record an arbitrary wallet transaction + update the trafficker balance
   * atomically. Both writes commit together inside a single `db.$transaction`
   * — if either fails, both roll back, so the ledger (`WalletTransaction`)
   * and the balance (`Trafficker.walletBalance`) can never diverge.
   *
   * AUDIT-FINTECH R-5 — previously used `Promise.all([walletTransaction.create,
   * trafficker.update])`, which is NOT atomic in Prisma: if the second write
   * failed but the first succeeded, the ledger gained a row but the balance
   * was never adjusted (double-spend risk). Now mirrors `processWithdrawal`
   * (this same file) and `applyPaymentUpdate` (payment-webhook-utils.ts):
   * both writes run inside `db.$transaction(async (tx) => { ... })`.
   *
   * The route pre-validates that the resulting balance is non-negative.
   */
  async recordTransaction(input: {
    traffickerId: string
    direction: 'inbound' | 'outbound'
    type: string
    category?: string
    amount: number
    balanceBefore: number
    balanceAfter: number
    description?: string | null
    reference?: string | null
    referenceType?: string | null
  }) {
    try {
      const txn = await db.$transaction(async (tx) => {
        // 1. Record the ledger entry.
        const created = await tx.walletTransaction.create({
          data: {
            traffickerId: input.traffickerId,
            direction: input.direction,
            type: input.type,
            category: input.category || input.type,
            amount: Math.abs(input.amount),
            balanceBefore: input.balanceBefore,
            balanceAfter: input.balanceAfter,
            description: input.description || null,
            reference: input.reference || null,
            referenceType: input.referenceType || null,
            status: 'completed',
          },
        })
        // 2. Apply the new balance to the trafficker row.
        await tx.trafficker.update({
          where: { id: input.traffickerId },
          data: { walletBalance: input.balanceAfter },
        })
        return created
      })
      return txn
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'recordTransaction',
        traffickerId: input.traffickerId,
      })
      throw new Error('Failed to record transaction')
    }
  },
}

export type WalletService = typeof walletService
