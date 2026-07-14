// ZIAY — Trafficker service layer.
//
// Owns Trafficker + TraffickerCampaign + TraffickerSale +
// TraffickerCompensation + TraffickerTransaction access for the
// `/api/trafficker` route (profile + campaigns + sales + compensations +
// the "withdraw" action which mints a pending WithdrawalRequest AND a
// TraffickerTransaction in a single tx).
//
// Split out of `wallet.service.ts` (AUDIT-FINAL-SPLIT-001) so that each
// service stays under 700 lines. The wallet-side counterparts
// (balance, accounts, 2FA, withdrawals, record-transaction) live in
// `wallet.service.ts`. Both are re-exported from `services/index.ts`.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:trafficker')

export const traffickerService = {
  // ── Trafficker lookups ──────────────────────────────────────────────────

  /**
   * Resolve a Trafficker by id. Returns null when not found.
   */
  async getTraffickerById(id: string) {
    try {
      return await db.trafficker.findUnique({ where: { id } })
    } catch (err) {
      captureError(err as Error, {
        service: 'trafficker',
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
        service: 'trafficker',
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
        service: 'trafficker',
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
        service: 'trafficker',
        method: 'createTrafficker',
        email: input.email,
      })
      throw new Error('Failed to create trafficker')
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
        service: 'trafficker',
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
   *
   * FIX-PERFORMANCE-001 — previously did a single `take: 100` findMany +
   * JS reduce, which silently truncated `totalAmount`/`totalCommission`/
   * per-status counts to the latest 100 sales when a trafficker had more.
   * Now we run the bounded list (recent 50 for the table) in parallel
   * with a `groupBy` + `aggregate` so totals cover ALL rows.
   */
  async getSalesStats(traffickerId: string) {
    try {
      const [sales, statusGroups, sumAgg] = await Promise.all([
        db.traffickerSale.findMany({
          where: { traffickerId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.traffickerSale.groupBy({
          by: ['status'],
          where: { traffickerId },
          _count: { _all: true },
        }),
        db.traffickerSale.aggregate({
          where: { traffickerId },
          _sum: { amount: true, commission: true },
          _count: true,
        }),
      ])

      const countBy = (status: string) =>
        statusGroups.find((g) => g.status === status)?._count._all ?? 0

      return {
        sales,
        stats: {
          total: sumAgg._count,
          pending: countBy('pending'),
          confirmed: countBy('confirmed'),
          failed: countBy('failed'),
          compensated: countBy('compensated'),
          totalAmount: sumAgg._sum.amount ?? 0,
          totalCommission: sumAgg._sum.commission ?? 0,
        },
      }
    } catch (err) {
      captureError(err as Error, {
        service: 'trafficker',
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
        service: 'trafficker',
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
        service: 'trafficker',
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
        service: 'trafficker',
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
        service: 'trafficker',
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
        service: 'trafficker',
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
            metadata: JSON.stringify({  // TD-AUDITLOG-META-RENAME
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
        service: 'trafficker',
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
        service: 'trafficker',
        method: 'requestWithdrawal',
        traffickerId: input.traffickerId,
      })
      throw new Error('Failed to request withdrawal')
    }
  },
}

export type TraffickerService = typeof traffickerService
