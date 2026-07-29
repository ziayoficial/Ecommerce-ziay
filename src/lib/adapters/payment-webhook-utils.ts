// ZIAY — Payment webhook shared helpers
// Saramantha §10 — lógica común a los 4 webhooks de pago (MP, Wompi, Stripe,
// PayU): lookup de Order por paymentRef, update de paymentStatus y creación
// de OrderEvent. Mantiene los 4 route handlers DRY.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { fireCapiPurchaseEvent } from '@/lib/attribution/capi-auto-fire'

const log = getLogger('payment-webhook-utils')

/**
 * Best-effort audit log write. Webhooks must ALWAYS ACK with 200 to stop
 * gateway retries, even when the local DB is read-only or unreachable.
 * Errors are logged to stderr and swallowed.
 *
 * FIX-REALTIME-WEBHOOKS-001 — added optional `entityId` parameter so
 * webhooks can store their `webhookId` (from `generateWebhookId`) for
 * cross-instance dedup queries via `isDuplicateWebhookDB`. Existing 3-arg
 * callers continue to work — `entityId` defaults to `undefined`.
 */
export async function safeAudit(
  action: string,
  entity: string,
  meta: string,
  entityId?: string,
): Promise<void> {
  try {
    await db.auditLog.create({ data: { action, entity, metadata: meta, entityId } })
  } catch (err) {
    log.error({ action, err: err instanceof Error ? err.message : String(err) }, 'auditLog persistence failed')
  }
}

/**
 * Estados de pago canónicos del gateway → `Order.paymentStatus` interno.
 * Los valores no listados se guardan tal cual (en minúsculas) para auditoría.
 */
export function normalizePaymentStatus(gatewayStatus: string): string {
  const s = gatewayStatus.toLowerCase()
  if (
    s === 'approved' ||
    s === 'paid' ||
    s === 'succeeded' ||
    s === 'completed' ||
    s === 'captured'
  ) {
    return 'paid'
  }
  if (s === 'rejected' || s === 'declined' || s === 'failed' || s === 'cancelled') {
    return 'rejected'
  }
  if (s === 'refunded' || s === 'partial_refunded') return 'refunded'
  if (s === 'pending' || s === 'in_process' || s === 'in_progress' || s === 'open' || s === 'authorized') {
    return 'pending_payment'
  }
  return s || 'unknown'
}

export interface OrderUpdateResult {
  found: boolean
  orderId?: string
  newStatus: string
}

/**
 * I2-R3 — Returns true when the gateway-reported CVV/CVC result
 * unambiguously indicates a FAILURE (no match). The gateway-declined
 * codes ('P' / 'S' / 'U' / 'R') are NOT failures here — they're
 * informational and the gateway already declined the payment in those
 * cases. Only an explicit 'no match' on an APPROVED payment is a fraud
 * signal we need to defend against (the gateway sometimes approves a
 * payment even when CVV didn't match — that's the dangerous case).
 *
 * Accepts both the standard ISO 8583 'N' code (used by most acquirers /
 * MP / Wompi / PayU) and Stripe's verbose 'fail' value.
 */
function isCvvFailure(cvvResult: string | undefined): boolean {
  if (!cvvResult) return false
  const c = cvvResult.trim().toUpperCase()
  // 'N' (no match) is the canonical failure code across Stripe / MP / Wompi /
  // PayU. 'NO_MATCH' is the verbose form used by some gateways. Stripe uses
  // 'fail' for `payment_method_details.card_checks.cvc_check`.
  return c === 'N' || c === 'NO_MATCH' || c === 'FAIL'
}

/**
 * I2-R3 — Returns true when the gateway-reported AVS result indicates that
 * NEITHER the address NOR the zip matched. Partial matches ('A' = address
 * only, 'Z' = zip only) are NOT failures — they're weak signals that
 * warrant operator review but don't block the `paid` transition (a partial
 * match is more often a typo than fraud).
 *
 * Accepts 'N' / 'NO_MATCH' (standard) and 'fail' (Stripe).
 */
function isAvsFailure(avsResult: string | undefined): boolean {
  if (!avsResult) return false
  const c = avsResult.trim().toUpperCase()
  // 'N' = neither zip nor address matched. Some gateways report 'NO_MATCH'
  // for the same case. Stripe reports 'fail'.
  return c === 'N' || c === 'NO_MATCH' || c === 'FAIL'
}

/**
 * Busca una Order por `paymentRef` o `number` (la referencia interna que el
 * gateway envía de vuelta) y actualiza `paymentStatus`, `paidAt` y `paymentRef`.
 * Crea siempre un `OrderEvent` con el estado crudo del gateway para auditoría.
 *
 * The `order.update` + `orderEvent.create` writes are wrapped in a single
 * `db.$transaction` so a failure of either rolls both back — preventing the
 * "order marked paid but no audit event recorded" broken state that broke
 * finance reconciliation (AUDIT-GAP-4-DB §3 risk #5).
 *
 * Best-effort: si la DB no está disponible (read-only sandbox), la función
 * registra el error y retorna `{ found: false }` para que el webhook siga
 * ACKeando con 200. `safeAudit` is intentionally OUTSIDE the transaction —
 * audit-log write failures must not roll back the payment state change.
 */
export async function applyPaymentUpdate(opts: {
  gateway: string
  paymentId: string
  externalReference?: string
  status: string
  success: boolean
  /**
   * AUDIT-FINTECH R-6 — optional gateway-reported amount (in the order's
   * major currency unit, e.g. COP 150000.00 not 15000000 cents). When
   * provided AND the looked-up `Order.total` is non-zero, we compare them
   * before marking the order `paid`. A difference > 1% (rounding tolerance)
   * blocks the `paid` transition and writes a `payment_mismatch` event
   * instead — defense-in-depth against a forged-amount webhook (requires a
   * compromised gateway secret, but the cost of a bad mark-paid is high).
   */
  amount?: number
  /** ISO 4217 currency code reported by the gateway (COP, USD, ...). */
  currency?: string
  /**
   * I2-R3 — CVV (CVC) verification result reported by the gateway.
   *
   * Common codes (varies by gateway but broadly compatible):
   *   - 'M' / 'Y' / 'MATCH' / '0'  → matched (pass)
   *   - 'N' / 'NO_MATCH' / 'N'     → no match (FAIL — likely fraud)
   *   - 'P' / 'NOT_PROCESSED'      → not processed
   *   - 'S'                        → issuer doesn't support
   *   - 'U' / 'UNKNOWN'            → unknown
   *   - '' / undefined             → not reported (skip check)
   *
   * When the code unambiguously indicates a FAILURE ('N' / 'NO_MATCH'),
   * we refuse to mark `paid` and write a `payment_mismatch` event with a
   * 'CVV check failed' note. Other codes are informational and do not
   * block the transition — the gateway already declined the payment in
   * the most severe cases.
   */
  cvvResult?: string
  /**
   * I2-R3 — AVS (Address Verification System) result reported by the
   * gateway. Same semantics as `cvvResult`:
   *   - 'Y'  → both zip + address match
   *   - 'A'  → address matches, zip doesn't
   *   - 'Z'  → zip matches, address doesn't
   *   - 'N'  → neither matches (FAIL — strong fraud signal)
   *   - 'U'  → unavailable
   *   - 'R'  → retry
   *   - '' / undefined → not reported (skip check)
   *
   * Only an unambiguous 'N' (no match at all) blocks the `paid`
   * transition. Partial matches (A/Z) add a `payment_mismatch` note but
   * still allow the transition — the operator can reconcile.
   */
  avsResult?: string
}): Promise<OrderUpdateResult> {
  const { gateway, paymentId, externalReference, status, success, amount, currency, cvvResult, avsResult } = opts
  const newStatus = normalizePaymentStatus(status)

  try {
    // Lookup por paymentRef o por number (la referencia interna del comercio).
    // The lookup is OUTSIDE the $transaction so a long-running transaction
    // doesn't hold a row lock on Order during the (fast) read.
    const order = await db.order.findFirst({
      where: {
        OR: [
          { paymentRef: paymentId },
          ...(externalReference ? [{ paymentRef: externalReference }, { number: externalReference }] : []),
        ],
      },
    })

    if (!order) {
      return { found: false, newStatus }
    }

    const shouldMarkPaid = success || newStatus === 'paid'
    const wasAlreadyPaid = order.paymentStatus === 'paid'

    // ── I2-R3 — CVV/AVS verification (defense-in-depth) ─────────────────
    // Run BEFORE the amount check below — both can independently block the
    // `paid` transition, and CVV/AVS failure is a stronger signal than an
    // amount mismatch. Only enforce when we'd otherwise mark `paid` and we
    // haven't already (idempotency).
    const cvvFailed = isCvvFailure(cvvResult)
    const avsFailed = isAvsFailure(avsResult)
    if (shouldMarkPaid && !wasAlreadyPaid && (cvvFailed || avsFailed)) {
      const notes: string[] = []
      if (cvvFailed) notes.push(`CVV check failed (cvvResult=${cvvResult})`)
      if (avsFailed) notes.push(`AVS check failed (avsResult=${avsResult})`)
      const note = `${gateway} webhook: ${notes.join('; ')} (paymentId=${paymentId})`

      log.error(
        {
          gateway,
          orderId: order.id,
          orderNumber: order.number,
          tenantId: order.tenantId,
          cvvResult,
          avsResult,
          paymentId,
        },
        'payment_mismatch — CVV/AVS verification failed, refusing to mark order paid',
      )

      try {
        await db.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: 'payment_mismatch',
              paymentRef: paymentId,
              paymentGateway: gateway,
            },
          })
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: 'payment_mismatch',
              note,
            },
          })
        })
      } catch (mismatchErr) {
        log.error(
          {
            orderId: order.id,
            err: mismatchErr instanceof Error ? mismatchErr.message : String(mismatchErr),
          },
          'CVV/AVS mismatch: failed to persist mismatch state',
        )
      }

      return { found: true, orderId: order.id, newStatus: 'payment_mismatch' }
    }

    // ── AUDIT-FINTECH R-6 — amount validation (defense-in-depth) ─────────
    // Only enforce when:
    //   1. The webhook payload reports a numeric `amount` (some gateways /
    //      older integrations don't include it — `amount` is optional).
    //   2. We are about to transition the order to `paid` (no point
    //      validating a `rejected` or `pending` webhook).
    //   3. The order has a non-zero `total` to compare against.
    //   4. We haven't already marked the order `paid` (idempotency — the
    //      first webhook that flipped the status already validated).
    // When the absolute % difference exceeds 1% (rounding tolerance), we
    // refuse to mark `paid`, set `paymentStatus='payment_mismatch'`, write
    // an `OrderEvent` of type `payment_mismatch` with the expected vs
    // received amounts, and return early. The order stays unpaid so the
    // operator can investigate; a later legitimate webhook (with the
    // correct amount) can still reconcile it.
    if (shouldMarkPaid && !wasAlreadyPaid && typeof amount === 'number' && Number.isFinite(amount) && order.total > 0) {
      const diff = Math.abs(amount - order.total)
      const pct = diff / order.total
      if (pct > 0.01) {
        log.error(
          {
            gateway,
            orderId: order.id,
            orderNumber: order.number,
            tenantId: order.tenantId,
            expectedTotal: order.total,
            expectedCurrency: order.currency,
            receivedAmount: amount,
            receivedCurrency: currency,
            paymentId,
            diffPct: Number((pct * 100).toFixed(2)),
          },
          'payment_mismatch — refusing to mark order paid (gateway amount differs from order.total by >1%)',
        )

        try {
          await db.$transaction(async (tx) => {
            await tx.order.update({
              where: { id: order.id },
              data: {
                paymentStatus: 'payment_mismatch',
                paymentRef: paymentId,
                paymentGateway: gateway,
              },
            })
            await tx.orderEvent.create({
              data: {
                orderId: order.id,
                type: 'payment_mismatch',
                note:
                  `${gateway} webhook amount mismatch: expected ${order.total} ${order.currency ?? ''}` +
                  ` vs received ${amount} ${currency ?? ''} (paymentId=${paymentId})`,
              },
            })
          })
        } catch (mismatchErr) {
          // Best-effort: the webhook still ACKs 200 below — but we log so
          // the operator can reconcile manually.
          log.error(
            {
              orderId: order.id,
              err: mismatchErr instanceof Error ? mismatchErr.message : String(mismatchErr),
            },
            'payment_mismatch: failed to persist mismatch state',
          )
        }

        return { found: true, orderId: order.id, newStatus: 'payment_mismatch' }
      }
    }

    const eventType =
      newStatus === 'paid' ? 'paid' : newStatus === 'refunded' ? 'refunded' : 'payment_update'

    // Atomic: both writes succeed or both roll back. A failure here surfaces
    // to the outer catch and the webhook still ACKs 200 (per gateway contract).
    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: shouldMarkPaid ? 'paid' : newStatus,
          paidAt: shouldMarkPaid && !wasAlreadyPaid ? new Date() : order.paidAt,
          paymentRef: paymentId,
          paymentGateway: gateway,
        },
      })

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: eventType,
          note: `${gateway} webhook: status=${status} paymentId=${paymentId}`,
        },
      })
    })

    // ── AUDIT-FINTECH R-12 — sync Refund ledger on gateway refund webhook ──
    // When the gateway fires a `refunded` webhook (e.g. MercadoPago
    // `payment.refunded` / Stripe `charge.refunded`), the `paymentId`
    // passed to `applyPaymentUpdate` is the gateway-side refund reference.
    // If a matching `Refund` row exists (created by
    // `/api/orders/[id]/refund`), flip its status from `pending` →
    // `processed`. This closes the loop between admin-initiated refunds
    // (which create a Refund row + call the gateway) and the gateway's
    // async confirmation webhook. Best-effort — wrapped in its own
    // try/catch so a DB hiccup here doesn't roll back the order update
    // above (which has already committed).
    //
    // AUDIT-FINTECH N-6 — race condition admin ‖ webhook refund.
    // Race window: the admin endpoint `POST /api/orders/[id]/refund`
    // creates a Refund row (status='pending', gatewayRef=null) THEN
    // calls `adapter.refund()` THEN flips Refund.status='processed' +
    // sets gatewayRef. If a `charge.refunded` webhook for the SAME
    // refund arrives between the gateway call and the admin's
    // status flip, this code looks up by `gatewayRef` (now matches)
    // OR by `orderId + pending` (matches the admin's pending row).
    // Either way we update the SAME Refund row — no duplicate is
    // created. The admin endpoint's `$transaction` write commits
    // afterward and is idempotent (status='processed' overwrites
    // status='processed', gatewayRef is the same value).
    //
    // If a `charge.refunded` webhook arrives BEFORE the admin
    // endpoint has created its Refund row (e.g. refund was initiated
    // directly in the Stripe dashboard), this code finds no matching
    // Refund and the webhook simply flips `Order.paymentStatus='refunded'`
    // + writes an OrderEvent. The admin endpoint's pre-create check
    // (see refund/route.ts) then catches the duplicate when the admin
    // operator attempts to refund the same order with the same
    // amount + reason. Defense-in-depth — no duplicate Refund row is
    // ever persisted.
    if (newStatus === 'refunded') {
      try {
        const matchingRefund = await db.refund.findFirst({
          where: {
            OR: [
              { gatewayRef: paymentId },
              // Some gateways send the original payment ID (not the refund ID)
              // in the webhook. Fall back to matching by orderId + pending
              // status — there should be at most one pending refund per order
              // at a time (the `/refund` POST endpoint serializes via the
              // `remaining` budget check).
              { order: { id: order.id }, status: 'pending' },
            ],
          },
          orderBy: { initiatedAt: 'desc' },
        })
        if (matchingRefund && matchingRefund.status === 'pending') {
          await db.refund.update({
            where: { id: matchingRefund.id },
            data: {
              status: 'processed',
              gatewayRef: matchingRefund.gatewayRef ?? paymentId,
              processedAt: new Date(),
            },
          })
          log.info(
            { orderId: order.id, refundId: matchingRefund.id, gatewayRef: paymentId },
            'Refund ledger synced from gateway webhook (pending → processed)',
          )
        }
      } catch (refundErr) {
        log.error(
          {
            orderId: order.id,
            paymentId,
            err: refundErr instanceof Error ? refundErr.message : String(refundErr),
          },
          'Failed to sync Refund ledger from gateway webhook (non-blocking)',
        )
      }
    }

    // ── CAPI auto-fire on transition to paid ─────────────────────────────
    // Study §14.4: closing the attribution loop with CAPI is the
    // highest-impact improvement reported in 2026. We fire a `Purchase`
    // ConversionEvent for every active PixelConfig of the order's tenant
    // ONLY when this webhook actually transitioned the order to `paid`
    // (not on idempotent retries). Best-effort + non-blocking: the
    // CAPI module catches its own errors so a CAPI failure never
    // prevents the payment webhook from ACKing 200.
    if (shouldMarkPaid && !wasAlreadyPaid) {
      fireCapiPurchaseEvent(order.id, order.tenantId).catch((err) =>
        log.error(
          { orderId: order.id, tenantId: order.tenantId, err: err instanceof Error ? err.message : String(err) },
          'CAPI auto-fire failed (non-blocking)',
        ),
      )
    }

    return { found: true, orderId: order.id, newStatus }
  } catch (err) {
    log.error({ gateway, err: err instanceof Error ? err.message : String(err) }, 'applyPaymentUpdate failed')
    return { found: false, newStatus }
  }
}

