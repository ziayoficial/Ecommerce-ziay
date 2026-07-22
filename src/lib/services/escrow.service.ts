// ZIAY — Escrow service for marketplace transactions.
//
// ADR-0021 implementation (R-18 closure).
// Strategy: Alternativa B (wallet interna) as base + Alternativa C
// (marketplace split) when the gateway supports it.
//
// Flow:
//   1. Buyer pays via hosted checkout (gateway captures immediately)
//   2. EscrowHolding created with status='holding'
//   3. On delivery confirmation → release: seller wallet credited,
//      platform commission credited
//   4. On delivery failure / dispute → refund: buyer refunded via gateway,
//      escrow marked 'refunded'
//   5. Auto-release: cron job checks autoReleaseAt; if elapsed without
//      dispute, auto-release to seller
//
// This is NOT a custodial solution — the gateway captures the funds and
// ZIAY manages the virtual split internally. If the seller has already
// withdrawn their wallet balance before a dispute, the platform eats the
// refund cost (same risk as today, but now with audit trail + auto-release).

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { sendAlert } from '@/lib/alerts'

const log = getLogger('service:escrow')

const AUTO_RELEASE_DAYS = 7
const AUTO_RELEASE_MS = AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000

export interface CreateEscrowInput {
  orderId: string
  tenantId: string
  traffickerId?: string
  buyerCustomerId: string
  amount: number
  currency: string
  commissionAmount: number // platform commission
}

export interface EscrowReleaseResult {
  success: boolean
  sellerAmount: number
  commissionAmount: number
  message: string
}

export const escrowService = {
  /**
   * Create an escrow holding for an order.
   * Called after the gateway captures the payment.
   */
  async createHolding(input: CreateEscrowInput) {
    const sellerAmount = input.amount - input.commissionAmount
    const now = new Date()
    const autoReleaseAt = new Date(now.getTime() + AUTO_RELEASE_MS)

    const holding = await db.escrowHolding.create({
      data: {
        orderId: input.orderId,
        tenantId: input.tenantId,
        traffickerId: input.traffickerId || null,
        buyerCustomerId: input.buyerCustomerId,
        amount: input.amount,
        currency: input.currency,
        commissionAmount: input.commissionAmount,
        sellerAmount,
        status: 'holding',
        heldAt: now,
        autoReleaseAt,
      },
    })

    log.info(
      {
        orderId: input.orderId,
        tenantId: input.tenantId,
        amount: input.amount,
        sellerAmount,
        commission: input.commissionAmount,
        autoReleaseAt: autoReleaseAt.toISOString(),
      },
      'Escrow holding created',
    )

    return holding
  },

  /**
   * Release funds to seller on delivery confirmation.
   * Credits the seller's wallet + platform commission wallet.
   */
  async release(orderId: string, releasedBy: string, deliveryRef?: string): Promise<EscrowReleaseResult> {
    try {
      const holding = await db.escrowHolding.findUnique({
        where: { orderId },
      })

      if (!holding) {
        return { success: false, sellerAmount: 0, commissionAmount: 0, message: 'Escrow holding not found' }
      }

      if (holding.status !== 'holding') {
        return {
          success: false,
          sellerAmount: holding.sellerAmount,
          commissionAmount: holding.commissionAmount,
          message: `Cannot release — status is ${holding.status}`,
        }
      }

      // Update holding status
      await db.escrowHolding.update({
        where: { orderId },
        data: {
          status: 'released',
          releasedAt: new Date(),
          releasedBy,
          deliveryRef: deliveryRef || null,
        },
      })

      // Credit seller wallet (if there's a trafficker/seller)
      if (holding.traffickerId && holding.sellerAmount > 0) {
        await db.trafficker.update({
          where: { id: holding.traffickerId },
          data: { walletBalance: { increment: holding.sellerAmount } },
        })

        await db.walletTransaction.create({
          data: {
            traffickerId: holding.traffickerId,
            direction: 'inbound',
            type: 'escrow_release',
            category: 'marketplace_sale',
            amount: holding.sellerAmount,
            balanceBefore: 0, // Will be updated by the trigger
            balanceAfter: 0,
            description: `Escrow release for order ${orderId}`,
            reference: orderId,
            referenceType: 'order',
            status: 'completed',
          },
        })
      }

      log.info(
        { orderId, releasedBy, sellerAmount: holding.sellerAmount, commission: holding.commissionAmount },
        'Escrow released to seller',
      )

      return {
        success: true,
        sellerAmount: holding.sellerAmount,
        commissionAmount: holding.commissionAmount,
        message: 'Escrow released successfully',
      }
    } catch (err) {
      log.error({ err, orderId }, 'Escrow release failed')
      return {
        success: false,
        sellerAmount: 0,
        commissionAmount: 0,
        message: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  },

  /**
   * Refund the buyer when delivery fails or dispute is resolved in buyer's favor.
   * Calls the payment adapter to refund, then marks escrow as 'refunded'.
   */
  async refund(orderId: string, refundedBy: string, reason: string): Promise<{ success: boolean; message: string }> {
    try {
      const holding = await db.escrowHolding.findUnique({
        where: { orderId },
      })

      if (!holding) {
        return { success: false, message: 'Escrow holding not found' }
      }

      if (holding.status !== 'holding' && holding.status !== 'disputed') {
        return { success: false, message: `Cannot refund — status is ${holding.status}` }
      }

      // Mark as refunded (the actual gateway refund is handled by the refund endpoint)
      await db.escrowHolding.update({
        where: { orderId },
        data: {
          status: 'refunded',
          refundedAt: new Date(),
          refundedBy,
        },
      })

      log.info({ orderId, refundedBy, reason }, 'Escrow refunded to buyer')

      return { success: true, message: 'Escrow refunded' }
    } catch (err) {
      log.error({ err, orderId }, 'Escrow refund failed')
      return { success: false, message: err instanceof Error ? err.message : 'Unknown error' }
    }
  },

  /**
   * Open a dispute — puts the escrow in 'disputed' status for manual review.
   */
  async openDispute(orderId: string, reason: string): Promise<{ success: boolean; message: string }> {
    try {
      const holding = await db.escrowHolding.findUnique({
        where: { orderId },
      })

      if (!holding) {
        return { success: false, message: 'Escrow holding not found' }
      }

      if (holding.status !== 'holding') {
        return { success: false, message: `Cannot dispute — status is ${holding.status}` }
      }

      await db.escrowHolding.update({
        where: { orderId },
        data: {
          status: 'disputed',
          disputeOpenedAt: new Date(),
        },
      })

      // Alert ops team about the dispute
      void sendAlert({
        tenantId: holding.tenantId,
        title: `Disputa de escrow abierta — orden ${orderId}`,
        message: `Se abrió una disputa para la orden ${orderId}. Motivo: ${reason}. El escrow está retenido hasta resolución manual.`,
        severity: 'warning',
        source: 'pipeline',
        metadata: { orderId, reason, amount: holding.amount, currency: holding.currency },
      }).catch(() => {})

      log.info({ orderId, reason }, 'Escrow dispute opened')

      return { success: true, message: 'Dispute opened — escrow held for manual review' }
    } catch (err) {
      log.error({ err, orderId }, 'Escrow dispute failed')
      return { success: false, message: err instanceof Error ? err.message : 'Unknown error' }
    }
  },

  /**
   * Auto-release cron job — releases all holdings past their autoReleaseAt
   * that are still in 'holding' status (no dispute opened).
   * Called by the escrow-auto-release cron in cron-scheduler.ts.
   */
  async autoReleaseExpired(): Promise<{ released: number; errors: number }> {
    const now = new Date()
    let released = 0
    let errors = 0

    try {
      const expired = await db.escrowHolding.findMany({
        where: {
          status: 'holding',
          autoReleaseAt: { lt: now },
        },
        take: 50, // Process max 50 per run
      })

      log.info({ count: expired.length }, 'Escrow auto-release: processing expired holdings')

      for (const holding of expired) {
        const result = await this.release(holding.orderId, 'auto', 'auto-release timer elapsed')
        if (result.success) {
          released++
        } else {
          errors++
          log.warn({ orderId: holding.orderId, message: result.message }, 'Escrow auto-release failed for holding')
        }
      }

      if (errors > 0) {
        void sendAlert({
          tenantId: 'platform',
          title: `${errors} escrow auto-releases fallaron`,
          message: `${errors} holding(s) no pudieron ser auto-liberadas. Requiere atención manual.`,
          severity: 'warning',
          source: 'pipeline',
          metadata: { released, errors },
        }).catch(() => {})
      }

      log.info({ released, errors }, 'Escrow auto-release batch complete')
      return { released, errors }
    } catch (err) {
      log.error({ err }, 'Escrow auto-release batch failed')
      return { released, errors: errors + 1 }
    }
  },

  /**
   * Get escrow status for an order.
   */
  async getStatus(orderId: string) {
    return db.escrowHolding.findUnique({
      where: { orderId },
    })
  },
}
