// ZIAY — Stripe webhook
// Saramantha §10 — recibe eventos de Stripe (checkout.session.completed,
// payment_intent.succeeded, charge.refunded, etc.).
//
// Body example:
//   {
//     "id": "evt_...",
//     "type": "checkout.session.completed",
//     "data": { "object": {
//       "id": "cs_test_...",
//       "payment_status": "paid",
//       "client_reference_id": "ORD-2024-001",
//       "amount_total": 15000
//     }}
//   }
//
// Header signature: `stripe-signature: t=<ts>,v1=<hex>` — verified via
// StripeAdapter.webhookVerify using STRIPE_WEBHOOK_SECRET.
//
// Siempre responde 200 (ack) para evitar reintentos de Stripe.

import { NextRequest, NextResponse } from 'next/server'
import { StripeAdapter } from '@/lib/adapters/stripe'
import { applyPaymentUpdate, safeAudit } from '@/lib/adapters/payment-webhook-utils'
import { isDuplicateWebhook, isDuplicateWebhookDB, generateWebhookId } from '@/lib/middleware/idempotency'
import { withWebhookErrorHandling } from '@/lib/middleware/webhook-error-handler'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { fraudService } from '@/lib/services/fraud.service'

const logger = getLogger('webhook:stripe')

/**
 * Stripe webhook handler.
 *
 * Recibe `checkout.session.*`, `payment_intent.*`, `charge.refunded`,
 * `charge.dispute.created` y `charge.dispute.closed` eventos de Stripe
 * (Saramantha §10 + I3-P0 N-2). Verifica la firma HMAC-SHA256
 * (`stripe-signature: t=<ts>,v1=<hex>`) con `STRIPE_WEBHOOK_SECRET` vía
 * `StripeAdapter.webhookVerify`. Tras verificar, mapea el estado de
 * `obj.payment_status` (paid / unpaid / no_payment_required) y aplica
 * `applyPaymentUpdate` — actualiza `Order.paymentStatus` + crea
 * `OrderEvent` + dispara el evento CAPI Purchase si la orden pasa a `paid`.
 *
 * I3-P0 N-2 — `charge.refunded` sincroniza el `Refund` ledger cuando un
 * reembolso se inicia directamente en el Stripe Dashboard (no via
 * `/api/orders/[id]/refund`). Si existe un `Refund` con `gatewayRef` =
 * charge ID, lo marca `processed`; si no, crea uno nuevo con
 * `reason: 'gateway_initiated'`, `initiatedBy: 'system'` para mantener el
 * ledger completo (Ley 1480 retracto refunds / finance reconciliation).
 *
 * I3-P0 N-2 — `charge.dispute.created` dispara `fraudService.recordChargeback`
 * que marca la orden `payment_mismatch` y agrega el customer + email + phone
 * + card BIN a `FraudBlocklistEntry`. Cierra el loop entre Stripe disputes
 * y el anti-fraud pipeline (R-3 chargeback feedback). El BIN de la tarjeta
 * se extrae de `payment_method_details.card.iin` cuando está presente.
 *
 * Idempotencia de 2 capas: in-memory Map (fast path) + DB-backed AuditLog
 * (multi-instancia) usando el `webhookId` como `entityId` indexado.
 *
 * @see https://stripe.com/docs/webhooks
 * @security Adapter throws en producción si falta `STRIPE_WEBHOOK_SECRET` (R3).
 *           Dev mode: warn + acepta; producción: 500 para alertar al operador.
 *           HMAC signature verification runs for ALL event types — the new
 *           `charge.*` branches are only reached AFTER verification succeeds.
 * @returns 200 siempre (ack) para evitar reintentos de Stripe;
 *          `status: 'invalid_signature'` si la firma no verifica;
 *          `status: 'duplicate'` si ya fue procesado.
 */
export const POST = withWebhookErrorHandling(async (req: NextRequest) => {
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''
  const adapter = new StripeAdapter()

  // Adapter throws in production when the webhook secret is missing (R3).
  // Surface that as a 500 so the gateway retries and the operator is
  // alerted — silently ACKing 200 would mask the misconfiguration.
  let sigValid: boolean
  try {
    sigValid = adapter.webhookVerify(rawBody, signature)
  } catch (err) {
    await safeAudit(
      'webhook.stripe.config_error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
    )
    return NextResponse.json(
      { error: 'Webhook verification configuration error' },
      { status: 500 },
    )
  }

  if (!sigValid) {
    // SPRINT-FIXES-FINAL-001 §4 — Webhook signature rotation grace period.
    // Try the OLD secret (if configured) when the current secret fails to
    // verify — supports hot-rotation without dropping in-flight webhooks
    // signed with the previous secret. The adapter's `webhookVerify`
    // accepts an optional `secretOverride` for this purpose.
    const oldSecret = process.env.STRIPE_WEBHOOK_SECRET_OLD
    if (oldSecret) {
      try {
        sigValid = adapter.webhookVerify(rawBody, signature, oldSecret)
      } catch {
        // If the old-secret path throws (defensive — shouldn't normally
        // happen since oldSecret is non-empty here), fall through to the
        // invalid_signature branch.
        sigValid = false
      }
      if (sigValid) {
        logger.warn('Webhook verified with OLD secret — rotation in progress')
      }
    }
  }

  if (!sigValid) {
    await safeAudit('webhook.stripe.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
  }

  // ── Idempotency (SPRINT4-INFRA-001 + FIX-REALTIME-WEBHOOKS-001) ───────
  // Two layers: in-memory Map (fast path, single-instance) + DB-backed
  // AuditLog query (durable, multi-instance). The DB check uses the
  // webhookId as `entityId` so it's indexed and cheap.
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }
  if (await isDuplicateWebhookDB('webhook.stripe.', webhookId)) {
    // Record in memory so the next in-process retry is also fast-pathed.
    isDuplicateWebhook(webhookId)
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  let body: Record<string, unknown> = {}
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    body = {}
  }

  const type = String(body.type ?? '')
  const data = (body.data ?? {}) as Record<string, unknown>
  const obj = (data.object ?? {}) as Record<string, unknown>
  const sessionId = String(obj.id ?? '')
  const clientRef = String(obj.client_reference_id ?? '')

  try {
    // Procesamos eventos de checkout y de payment_intent (ambos relevantes).
    if (
      (type.startsWith('checkout.session.') || type.startsWith('payment_intent.')) &&
      sessionId
    ) {
      const status = String(obj.payment_status ?? obj.status ?? 'unknown')
      const success = status === 'paid'
      // AUDIT-FINTECH R-6 — extract the gateway-reported amount/currency so
      // `applyPaymentUpdate` can defend against forged-amount webhooks.
      // Stripe reports `amount_total` in the minor unit (cents), so divide
      // by 100 to match `Order.total` (stored in the major unit).
      const amountTotalCents = Number(obj.amount_total ?? obj.amount ?? 0)
      const amount =
        Number.isFinite(amountTotalCents) && amountTotalCents > 0
          ? amountTotalCents / 100
          : undefined
      const currency = obj.currency ? String(obj.currency).toUpperCase() : undefined

      // I2-R3 — extract CVV/AVS verification results. Stripe reports them on
      // the underlying charge, accessible via `charges.data[0].payment_method_details.card_checks`
      // for `checkout.session.completed` events (when expanded) or on the
      // charge object itself for `payment_intent.succeeded` events.
      const charges = (obj.charges ?? {}) as {
        data?: Array<{
          payment_method_details?: {
            card_checks?: {
              cvc_check?: string
              address_line1_check?: string
              address_zip_check?: string
            }
          }
        }>
      }
      const checks = charges.data?.[0]?.payment_method_details?.card_checks
      // Combine the address_line1 + address_zip checks into a single AVS
      // verdict: only flag 'N' when BOTH failed (matches the standard
      // 'AVS=N' = neither matched semantics).
      let cvvResult: string | undefined
      let avsResult: string | undefined
      if (checks) {
        cvvResult = checks.cvc_check ?? undefined
        const line1 = (checks.address_line1_check ?? '').toUpperCase()
        const zip = (checks.address_zip_check ?? '').toUpperCase()
        if (line1 === 'FAIL' && zip === 'FAIL') {
          avsResult = 'FAIL'
        } else if (line1 === 'FAIL' || zip === 'FAIL') {
          // Partial mismatch — pass through as 'A' or 'Z' so
          // isAvsFailure won't trigger (operator can review the event).
          avsResult = line1 === 'FAIL' ? 'Z' : 'A'
        } else if (line1 === 'PASS' && zip === 'PASS') {
          avsResult = 'Y'
        }
      }

      await applyPaymentUpdate({
        gateway: 'stripe',
        paymentId: sessionId,
        externalReference: clientRef,
        status,
        success,
        amount,
        currency,
        cvvResult,
        avsResult,
      })
    }

    // ── I3-P0 N-2 — charge.refunded ──────────────────────────────────────
    // Stripe fires `charge.refunded` whenever a refund is applied to a
    // charge — including refunds initiated directly in the Stripe Dashboard
    // (NOT via `/api/orders/[id]/refund`). Previously the narrow event
    // filter `type.startsWith('checkout.session.') || type.startsWith('payment_intent.')`
    // dropped these events, so the `Refund` ledger (AUDIT-FINTECH R-12) was
    // never synced from Stripe — finance reconciliation missed refunds and
    // the Ley 1480 retracto audit trail was incomplete.
    //
    // Sync logic:
    //   1. Find the order by `paymentRef` = payment_intent ID (`pi_...`),
    //      falling back to the charge ID (`ch_...`). The order's paymentRef
    //      is typically set to the checkout session ID (`cs_...`) by the
    //      `checkout.session.completed` handler above, OR to the payment
    //      intent ID by `payment_intent.succeeded` — so we try both.
    //   2. Look up an existing `Refund` row with `gatewayRef = chargeId`.
    //      If found AND still `pending`, flip to `processed` (closes the
    //      loop with admin-initiated refunds from /api/orders/[id]/refund).
    //   3. If NO existing Refund row, the refund was initiated directly in
    //      the Stripe Dashboard → create a new Refund row with
    //      `reason: 'gateway_initiated'`, `initiatedBy: 'system'`,
    //      `status: 'processed'` so the ledger stays complete.
    //   4. Update `Order.paymentStatus` → 'refunded' (best-effort, atomic
    //      with an `OrderEvent` audit row).
    //
    // All wrapped in try/catch — a DB hiccup here never rolls back the
    // order lookup or breaks the webhook ACK.
    if (type === 'charge.refunded') {
      try {
        const chargeId = String(obj.id ?? '') // ch_...
        const paymentIntentId = String(obj.payment_intent ?? '') // pi_...
        const amountRefundedCents = Number(obj.amount_refunded ?? 0)
        const amountRefunded =
          Number.isFinite(amountRefundedCents) && amountRefundedCents > 0
            ? amountRefundedCents / 100
            : undefined
        const chargeCurrency = obj.currency ? String(obj.currency).toUpperCase() : undefined
        // The original charge amount (also in cents) — used to detect
        // partial vs. full refunds. Stripe reports `amount` as the original
        // charge amount, `amount_refunded` as the cumulative refunded total.
        const chargeAmountCents = Number(obj.amount ?? 0)
        const chargeAmount =
          Number.isFinite(chargeAmountCents) && chargeAmountCents > 0
            ? chargeAmountCents / 100
            : undefined

        // 1. Find the order by paymentRef (try pi_ first, then ch_).
        const order = await db.order.findFirst({
          where: {
            OR: [
              ...(paymentIntentId ? [{ paymentRef: paymentIntentId }] : []),
              ...(chargeId ? [{ paymentRef: chargeId }] : []),
            ],
          },
        })

        if (!order) {
          logger.warn(
            { chargeId, paymentIntentId, webhookId },
            'charge.refunded: no matching order found — cannot sync Refund ledger',
          )
        } else {
          // 2. Look up an existing Refund by gatewayRef = chargeId, OR any
          //    pending refund on this order (admin-initiated refund that
          //    hasn't been confirmed by the gateway yet).
          const existingRefund = await db.refund.findFirst({
            where: {
              OR: [
                ...(chargeId ? [{ gatewayRef: chargeId }] : []),
                { orderId: order.id, status: 'pending' },
              ],
            },
            orderBy: { initiatedAt: 'desc' },
          })

          if (existingRefund) {
            // 3a. Flip pending → processed (closes the admin-initiated loop).
            if (existingRefund.status === 'pending') {
              await db.refund.update({
                where: { id: existingRefund.id },
                data: {
                  status: 'processed',
                  gatewayRef: existingRefund.gatewayRef ?? chargeId,
                  gatewayName: existingRefund.gatewayName ?? 'stripe',
                  processedAt: new Date(),
                },
              })
              logger.info(
                { orderId: order.id, refundId: existingRefund.id, chargeId, webhookId },
                'Refund ledger synced from Stripe charge.refunded (pending → processed)',
              )
            } else {
              // Already processed — idempotent no-op (Stripe can resend).
              logger.info(
                { orderId: order.id, refundId: existingRefund.id, status: existingRefund.status, webhookId },
                'charge.refunded: Refund already processed — idempotent no-op',
              )
            }
          } else {
            // 3b. No existing Refund → refund was initiated directly in the
            //     Stripe Dashboard. Create a new Refund row so the ledger
            //     stays complete (finance reconciliation + Ley 1480 retracto).
            const refundAmount =
              typeof amountRefunded === 'number' && amountRefunded > 0
                ? amountRefunded
                : order.total
            const isPartial =
              typeof chargeAmount === 'number' &&
              chargeAmount > 0 &&
              refundAmount < chargeAmount - 0.01

            await db.refund.create({
              data: {
                orderId: order.id,
                tenantId: order.tenantId,
                amount: refundAmount,
                currency: chargeCurrency ?? order.currency,
                reason: 'gateway_initiated',
                partial: isPartial,
                status: 'processed',
                gatewayRef: chargeId || undefined,
                gatewayName: 'stripe',
                initiatedBy: 'system',
                initiatedAt: new Date(),
                processedAt: new Date(),
              },
            })
            logger.info(
              { orderId: order.id, chargeId, amount: refundAmount, currency: chargeCurrency, webhookId },
              'Refund ledger created from Stripe charge.refunded (gateway-initiated refund)',
            )
          }

          // 4. Update order paymentStatus → 'refunded' (best-effort).
          try {
            await db.$transaction([
              db.order.update({
                where: { id: order.id },
                data: { paymentStatus: 'refunded' },
              }),
              db.orderEvent.create({
                data: {
                  orderId: order.id,
                  type: 'refunded',
                  note: `stripe charge.refunded: chargeId=${chargeId} amount=${amountRefunded ?? 'unknown'} ${chargeCurrency ?? ''} (pi=${paymentIntentId})`,
                },
              }),
            ])
          } catch (orderErr) {
            logger.error(
              {
                orderId: order.id,
                err: orderErr instanceof Error ? orderErr.message : String(orderErr),
              },
              'charge.refunded: failed to update order status (non-blocking)',
            )
          }
        }
      } catch (refundErr) {
        logger.error(
          {
            err: refundErr instanceof Error ? refundErr.message : String(refundErr),
            webhookId,
          },
          'charge.refunded: handler failed (non-blocking — webhook still ACKs 200)',
        )
      }
    }

    // ── I3-P0 N-2 — charge.dispute.created ───────────────────────────────
    // Stripe fires `charge.dispute.created` when a customer disputes a
    // charge with their bank. This is the strongest fraud signal — we feed
    // it directly into `fraudService.recordChargeback` which:
    //   - Marks the order `payment_mismatch` (canonical dispute state)
    //   - Adds the customer + email + phone to `FraudBlocklistEntry`
    //   - Writes an `OrderEvent` for auditability
    // We also extract the card BIN from `payment_method_details.card.iin`
    // when present and add it to the blocklist (defense-in-depth — the
    // dedicated `/api/webhooks/chargeback` endpoint does the same).
    //
    // Closes the loop that was previously broken: the chargeback feedback
    // was only wired from `/api/webhooks/chargeback` (which requires
    // separate Stripe webhook configuration), NOT from the main Stripe
    // webhook — so disputes configured only on the main webhook URL never
    // reached the blocklist.
    if (type === 'charge.dispute.created') {
      try {
        const paymentIntentId = String(obj.payment_intent ?? '') // pi_...
        const chargeId = String(obj.charge ?? obj.id ?? '') // ch_... (dispute.id is dp_..., charge is the linked charge)
        const disputeReason = String(obj.reason ?? 'chargeback')
        // Dispute status: 'warning_needs_response', 'needs_response',
        // 'under_review', 'won', 'lost', etc.
        const disputeStatus = String(obj.status ?? 'needs_response')

        // Find the order by payment_intent or charge ID.
        const order = await db.order.findFirst({
          where: {
            OR: [
              ...(paymentIntentId ? [{ paymentRef: paymentIntentId }] : []),
              ...(chargeId ? [{ paymentRef: chargeId }] : []),
            ],
          },
        })

        if (!order) {
          logger.warn(
            { paymentIntentId, chargeId, disputeReason, webhookId },
            'charge.dispute.created: no matching order found — cannot feed fraud blocklist',
          )
        } else {
          // 1. recordChargeback marks order payment_mismatch + adds
          //    customer/email/phone to FraudBlocklistEntry.
          await fraudService.recordChargeback(order.tenantId, order.id, disputeReason)

          // 2. Extract card BIN from payment_method_details.card.iin (when
          //    present) and add to blocklist. Mirrors the dedicated
          //    /api/webhooks/chargeback endpoint behavior.
          const pmd = obj.payment_method_details as
            | { card?: { brand?: string; iin?: string } }
            | undefined
          const cardBin = pmd?.card?.iin
          if (cardBin && cardBin.length >= 6) {
            try {
              await fraudService.addToBlocklist(order.tenantId, {
                type: 'card_bin',
                value: cardBin.slice(0, 6),
                reason: 'chargeback',
                source: 'auto',
              })
            } catch (binErr) {
              logger.warn(
                {
                  tenantId: order.tenantId,
                  cardBin: cardBin.slice(0, 6),
                  err: binErr instanceof Error ? binErr.message : String(binErr),
                },
                'charge.dispute.created: failed to add card BIN to blocklist (non-blocking)',
              )
            }
          }

          logger.warn(
            {
              orderId: order.id,
              tenantId: order.tenantId,
              disputeReason,
              disputeStatus,
              chargeId,
              webhookId,
            },
            'charge.dispute.created: chargeback recorded → fraud blocklist updated',
          )
        }
      } catch (disputeErr) {
        logger.error(
          {
            err: disputeErr instanceof Error ? disputeErr.message : String(disputeErr),
            webhookId,
          },
          'charge.dispute.created: handler failed (non-blocking — webhook still ACKs 200)',
        )
      }
    }

    // ── I3-P0 N-2 — charge.dispute.closed (optional, reporting only) ─────
    // Stripe fires `charge.dispute.closed` when a dispute is resolved
    // (won / lost / warning_closed). The order state was already set to
    // `payment_mismatch` by the `charge.dispute.created` handler above —
    // we just record an audit entry with the resolution so finance/ops
    // can report on dispute outcomes. No ledger update needed.
    if (type === 'charge.dispute.closed') {
      try {
        const paymentIntentId = String(obj.payment_intent ?? '')
        const chargeId = String(obj.charge ?? obj.id ?? '')
        const disputeStatus = String(obj.status ?? 'closed')
        const disputeReason = String(obj.reason ?? 'unknown')

        // Best-effort: if we can find the order, write an OrderEvent so
        // the operator sees the resolution in the order timeline.
        if (paymentIntentId || chargeId) {
          const order = await db.order.findFirst({
            where: {
              OR: [
                ...(paymentIntentId ? [{ paymentRef: paymentIntentId }] : []),
                ...(chargeId ? [{ paymentRef: chargeId }] : []),
              ],
            },
          })
          if (order) {
            try {
              await db.orderEvent.create({
                data: {
                  orderId: order.id,
                  type: 'payment_mismatch',
                  note: `stripe charge.dispute.closed: status=${disputeStatus} reason=${disputeReason} chargeId=${chargeId}`,
                },
              })
            } catch (evErr) {
              logger.warn(
                {
                  orderId: order.id,
                  err: evErr instanceof Error ? evErr.message : String(evErr),
                },
                'charge.dispute.closed: failed to write OrderEvent (non-blocking)',
              )
            }
          }
        }
        logger.info(
          { chargeId, disputeStatus, disputeReason, webhookId },
          'charge.dispute.closed: dispute resolution recorded',
        )
      } catch (closedErr) {
        logger.error(
          {
            err: closedErr instanceof Error ? closedErr.message : String(closedErr),
            webhookId,
          },
          'charge.dispute.closed: handler failed (non-blocking — webhook still ACKs 200)',
        )
      }
    }

    await safeAudit('webhook.stripe.inbound', 'Webhook', rawBody.slice(0, 1000), webhookId)
  } catch (err) {
    await safeAudit(
      'webhook.stripe.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
      webhookId,
    )
  }

  return NextResponse.json({ received: true })
})
