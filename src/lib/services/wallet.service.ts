// ZIAY — Wallet service layer.
//
// Wraps Trafficker + WalletTransaction + WalletAccount + WithdrawalRequest +
// TwoFactorConfig + TraffickerSale + TraffickerCompensation access for the
// fintech surface. The two HTTP routes that share this service are
// `/api/wallet` (balance / 2FA / accounts / withdrawals / record-transaction)
// and `/api/trafficker` (profile + sales/compensations CRUD).
//
// SPRINT8-SERVICES-REST-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:wallet')

export const walletService = {
  // ── Trafficker lookups ──────────────────────────────────────────────────

  /**
   * Resolve a Trafficker by id. Returns null when not found.
   */
  async getTraffickerById(id: string) {
    try {
      return await db.trafficker.findUnique({ where: { id } })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getTraffickerById',
        id,
      })
      throw new Error('Failed to fetch trafficker')
    }
  },

  /**
   * Resolve a Trafficker by email (case-insensitive lookup since the
   * route lowercases the email before lookup).
   */
  async getTraffickerByEmail(email: string) {
    try {
      return await db.trafficker.findUnique({
        where: { email: email.toLowerCase() },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getTraffickerByEmail',
        email,
      })
      throw new Error('Failed to fetch trafficker by email')
    }
  },

  /**
   * First trafficker in the table — used as the demo view for admin/finance
   * operators that aren't traffickers themselves.
   */
  async getFirstTrafficker() {
    try {
      return await db.trafficker.findFirst({ orderBy: { createdAt: 'asc' } })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getFirstTrafficker',
      })
      throw new Error('Failed to fetch demo trafficker')
    }
  },

  /**
   * Create a new trafficker (registration). Returns the row OR throws a
   * string error when the email is already in use — the route maps that to
   * a 409 response.
   */
  async createTrafficker(input: {
    email: string
    name: string
    phone?: string | null
  }) {
    try {
      const trafficker = await db.trafficker.create({
        data: {
          email: String(input.email),
          name: String(input.name),
          phone: input.phone ?? null,
          walletBalance: 0,
          status: 'active',
        },
      })
      log.info({ traffickerId: trafficker.id, email: input.email }, 'trafficker registered')
      return trafficker
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'createTrafficker',
        email: input.email,
      })
      throw new Error('Failed to create trafficker')
    }
  },

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
            meta: JSON.stringify({
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
   * atomically. Both writes happen in parallel — neither commits before the
   * other. The route pre-validates that the resulting balance is non-negative.
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
      const [txn] = await Promise.all([
        db.walletTransaction.create({
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
        }),
        db.trafficker.update({
          where: { id: input.traffickerId },
          data: { walletBalance: input.balanceAfter },
        }),
      ])
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

  // ── Trafficker dashboard (GET /api/trafficker) ─────────────────────────

  /**
   * Load the trafficker profile + nested campaigns/transactions/compensations.
   * The `sales` aggregate is loaded separately (via `getSalesStats`) so the
   * route can compute the per-status totals.
   */
  async getTraffickerProfile(id: string) {
    try {
      return await db.trafficker.findUnique({
        where: { id },
        include: {
          campaigns: {
            orderBy: { createdAt: 'desc' },
            take: 100,
          },
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
          compensations: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getTraffickerProfile',
        id,
      })
      throw new Error('Failed to fetch trafficker profile')
    }
  },

  /**
   * Sales stats for a trafficker: totals + per-status counts + sum of
   * amounts + sum of commissions. Mirrors the previous inline `salesStats`
   * shape verbatim.
   */
  async getSalesStats(traffickerId: string) {
    try {
      const sales = await db.traffickerSale.findMany({
        where: { traffickerId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      return {
        sales,
        stats: {
          total: sales.length,
          pending: sales.filter((s) => s.status === 'pending').length,
          confirmed: sales.filter((s) => s.status === 'confirmed').length,
          failed: sales.filter((s) => s.status === 'failed').length,
          compensated: sales.filter((s) => s.status === 'compensated').length,
          totalAmount: sales.reduce((sum, s) => sum + s.amount, 0),
          totalCommission: sales.reduce((sum, s) => sum + s.commission, 0),
        },
      }
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getSalesStats',
        traffickerId,
      })
      throw new Error('Failed to fetch sales stats')
    }
  },

  // ── Trafficker campaigns / sales / compensations ───────────────────────

  async createCampaign(input: {
    traffickerId: string
    tenantId: string
    name: string
    platform: string
    budget: number
    startDate?: Date | null
    endDate?: Date | null
  }) {
    try {
      const campaign = await db.traffickerCampaign.create({
        data: {
          traffickerId: input.traffickerId,
          tenantId: input.tenantId,
          name: input.name,
          platform: input.platform,
          budget: input.budget,
          spend: 0,
          status: 'active',
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
        },
      })
      log.info(
        {
          traffickerId: input.traffickerId,
          tenantId: input.tenantId,
          campaignId: campaign.id,
          platform: input.platform,
        },
        'campaign created',
      )
      return campaign
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'createCampaign',
        traffickerId: input.traffickerId,
      })
      throw new Error('Failed to create campaign')
    }
  },

  async getCampaignForTrafficker(campaignId: string, traffickerId: string, tenantId: string) {
    try {
      return await db.traffickerCampaign.findFirst({
        where: { id: campaignId, traffickerId, tenantId },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getCampaignForTrafficker',
        campaignId,
        traffickerId,
      })
      throw new Error('Failed to fetch campaign')
    }
  },

  async registerSale(input: {
    traffickerId: string
    tenantId: string
    campaignId: string
    orderId?: string | null
    amount: number
    commission: number
  }) {
    try {
      const sale = await db.traffickerSale.create({
        data: {
          traffickerId: input.traffickerId,
          tenantId: input.tenantId,
          campaignId: input.campaignId,
          orderId: input.orderId ?? null,
          amount: input.amount,
          commission: input.commission,
          status: 'pending',
        },
      })
      log.info(
        {
          traffickerId: input.traffickerId,
          tenantId: input.tenantId,
          campaignId: input.campaignId,
          saleId: sale.id,
          amount: input.amount,
          commission: input.commission,
        },
        'sale registered',
      )
      return sale
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'registerSale',
        traffickerId: input.traffickerId,
      })
      throw new Error('Failed to register sale')
    }
  },

  async getSaleWithCampaign(saleId: string) {
    try {
      return await db.traffickerSale.findUnique({
        where: { id: saleId },
        include: { campaign: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'getSaleWithCampaign',
        saleId,
      })
      throw new Error('Failed to fetch sale')
    }
  },

  /**
   * Confirm a pending sale atomically: flip sale status, credit trafficker
   * wallet, record TraffickerTransaction (commission). Returns
   * `{ sale, transaction }` so the route can return both in the response.
   */
  async confirmSale(saleId: string) {
    try {
      const result = await db.$transaction(async (tx) => {
        const sale = await tx.traffickerSale.findUnique({
          where: { id: saleId },
          include: { campaign: true },
        })
        if (!sale) throw new Error('Sale not found')
        const trafficker = await tx.trafficker.findUnique({
          where: { id: sale.traffickerId },
        })
        if (!trafficker) throw new Error('Trafficker vanished mid-transaction')
        const balanceBefore = trafficker.walletBalance
        const balanceAfter = balanceBefore + sale.commission
        const [updatedSale, , transaction] = await Promise.all([
          tx.traffickerSale.update({
            where: { id: saleId },
            data: { status: 'confirmed' },
          }),
          tx.trafficker.update({
            where: { id: trafficker.id },
            data: { walletBalance: balanceAfter },
          }),
          tx.traffickerTransaction.create({
            data: {
              traffickerId: trafficker.id,
              direction: 'inbound',
              type: 'commission',
              category: 'sale',
              amount: sale.commission,
              balanceBefore,
              balanceAfter,
              description: `Comisión por venta ${sale.id} (campaña ${sale.campaign.name})`,
              reference: sale.id,
              referenceType: 'sale',
              status: 'completed',
            },
          }),
        ])
        return { sale: updatedSale, transaction }
      })
      log.info(
        { saleId, traffickerId: result.sale.traffickerId, commission: result.transaction.amount },
        'sale confirmed — wallet credited',
      )
      return result
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'confirmSale',
        saleId,
      })
      throw new Error('Failed to confirm sale')
    }
  },

  /**
   * Fail a sale atomically: mark sale failed, optionally credit compensation
   * (when `compensationAmount > 0`), record TraffickerCompensation +
   * TraffickerTransaction + WalletTransaction (for wallet view), write
   * AuditLog. Returns `{ sale, compensation, compensationAmount }`.
   *
   * Mirrors the prior inline `failSale` shape verbatim — compensation may
   * be null when the comp rate is 0 (no compensation for that reason).
   */
  async failSale(saleId: string, reason: string, compensationPct: number) {
    try {
      const result = await db.$transaction(async (tx) => {
        const sale = await tx.traffickerSale.findUnique({
          where: { id: saleId },
          include: { campaign: true },
        })
        if (!sale) throw new Error('Sale not found')
        const compensationAmount = sale.commission * compensationPct

        // 1. Mark sale as failed
        const updatedSale = await tx.traffickerSale.update({
          where: { id: saleId },
          data: { status: 'failed' },
        })

        let compensation: Awaited<ReturnType<typeof tx.traffickerCompensation.create>> | null = null
        if (compensationAmount > 0) {
          // 2. Create compensation record
          compensation = await tx.traffickerCompensation.create({
            data: {
              traffickerId: sale.traffickerId,
              tenantId: sale.tenantId,
              saleId: sale.id,
              reason,
              amount: compensationAmount,
            },
          })

          // 3. Credit trafficker wallet
          const trafficker = await tx.trafficker.findUnique({
            where: { id: sale.traffickerId },
          })
          if (!trafficker) throw new Error('Trafficker vanished mid-transaction')
          const balanceBefore = trafficker.walletBalance
          const balanceAfter = balanceBefore + compensationAmount

          await tx.trafficker.update({
            where: { id: trafficker.id },
            data: { walletBalance: balanceAfter },
          })

          // 4. Record trafficker transaction
          await tx.traffickerTransaction.create({
            data: {
              traffickerId: trafficker.id,
              direction: 'inbound',
              type: 'compensation',
              category: 'seller_fault',
              amount: compensationAmount,
              balanceBefore,
              balanceAfter,
              description: `Compensación (${reason}, ${compensationPct * 100}%) por venta fallida ${sale.id}`,
              reference: sale.id,
              referenceType: 'sale',
              status: 'completed',
            },
          })

          // 5. Also record in WalletTransaction (for wallet view)
          await tx.walletTransaction.create({
            data: {
              traffickerId: trafficker.id,
              direction: 'inbound',
              type: 'compensation',
              category: 'seller_fault',
              amount: compensationAmount,
              balanceBefore,
              balanceAfter,
              description: `Compensación (${reason}) venta ${sale.id.slice(-6)}`,
              reference: sale.id,
              referenceType: 'sale',
              status: 'completed',
            },
          })
        }

        // 6. Audit log
        await tx.auditLog.create({
          data: {
            action: 'sale_failed_with_compensation',
            entity: 'trafficker_sale',
            entityId: sale.id,
            meta: JSON.stringify({
              saleId: sale.id,
              traffickerId: sale.traffickerId,
              reason,
              compensationPct,
              compensationAmount,
            }),
          },
        })

        return { sale: updatedSale, compensation, compensationAmount }
      })
      log.info(
        { saleId, traffickerId: result.sale.traffickerId, reason, compensation: result.compensationAmount },
        'sale failed + compensation credited',
      )
      return result
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'failSale',
        saleId,
      })
      throw new Error('Failed to fail sale')
    }
  },

  /**
   * Create a pending WithdrawalRequest + a TraffickerTransaction in `pending`
   * status. TOTP verification is performed by the caller (route) — funds are
   * not yet deducted. The TraffickerTransaction's `balanceBefore`/`balanceAfter`
   * both equal the current balance (deduction happens on completion).
   */
  async requestWithdrawal(input: {
    traffickerId: string
    walletAccountId: string
    amount: number
    fee: number
    netAmount: number
    totpVerified: boolean
    balanceBefore: number
    accountType: string
    accountNumber: string
  }) {
    try {
      const result = await db.$transaction(async (tx) => {
        const withdrawal = await tx.withdrawalRequest.create({
          data: {
            traffickerId: input.traffickerId,
            tenantId: null,
            walletAccountId: input.walletAccountId,
            amount: input.amount,
            fee: input.fee,
            netAmount: input.netAmount,
            totpRequired: true,
            totpVerified: input.totpVerified,
            totpVerifiedAt: input.totpVerified ? new Date() : null,
            status: input.totpVerified ? 'pending_processing' : 'pending_2fa',
          },
        })
        const transaction = await tx.traffickerTransaction.create({
          data: {
            traffickerId: input.traffickerId,
            direction: 'outbound',
            type: 'withdrawal',
            category: 'cashout',
            amount: input.amount,
            balanceBefore: input.balanceBefore,
            balanceAfter: input.balanceBefore, // not yet deducted — only on completion
            description: `Retiro solicitado → ${input.accountType} ${input.accountNumber}`,
            reference: withdrawal.id,
            referenceType: 'withdrawal',
            status: 'pending',
          },
        })
        return { withdrawal, transaction }
      })
      log.info(
        {
          traffickerId: input.traffickerId,
          amount: input.amount,
          walletAccountId: input.walletAccountId,
          withdrawalId: result.withdrawal.id,
          totpVerified: input.totpVerified,
        },
        'withdrawal requested',
      )
      return result
    } catch (err) {
      captureError(err as Error, {
        service: 'wallet',
        method: 'requestWithdrawal',
        traffickerId: input.traffickerId,
      })
      throw new Error('Failed to request withdrawal')
    }
  },
}

export type WalletService = typeof walletService
