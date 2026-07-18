// ZIAY — Chargeback webhook
// I2-R3 (CRITICAL RISK R-3 closure) — chargeback feedback loop.
//
// Receives chargeback / dispute notifications from:
//   1. Stripe `charge.dispute.created` events (when forwarded here from the
//      Stripe webhook — useful when you want a single, dedicated endpoint
//      for the fraud blocklist loop).
//   2. Generic chargeback-management gateways (e.g. Ethoca, Verifi CDRN)
//      that POST a JSON payload with `{ tenantId, orderId, reason }`.
//
// HMAC verification (timingSafeEqual, mirroring the pattern in
// `src/app/api/webhooks/stripe/route.ts` + `payment-webhook-utils.ts`):
//   - Signature header: `x-chargeback-signature: <hex>` OR `stripe-signature:
//     t=<ts>,v1=<hex>` (forwarded from Stripe).
//   - For the simple `<hex>` form, the HMAC is `HMAC-SHA256(secret, rawBody)`.
//   - For the Stripe `t=<ts>,v1=<hex>` form, the HMAC is
//     `HMAC-SHA256(secret, "<ts>.<rawBody>")` — same as Stripe's own
//     webhook verification.
//   - Dev mode (NODE_ENV !== 'production') without a configured secret:
//     warn + accept (mirrors StripeAdapter.webhookVerify).
//
// Always ACKs 200 (gateway contract — non-2xx triggers retries for 24h+).
// The body carries `{ received: true, status: ... }` for observability.
//
// On valid signature, calls `fraudService.recordChargeback(tenantId, orderId,
// reason)` which:
//   1. Marks the Order `paymentStatus='payment_mismatch'` + writes an
//      `OrderEvent` of type `payment_mismatch`.
//   2. Adds the customer (+ email + phone when present) to the blocklist
//      with `reason='chargeback'`, `source='auto'`.
//   3. The card BIN is added when the gateway payload includes one.

import { NextRequest, NextResponse } from 'next/server'
import crypto, { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { fraudService } from '@/lib/services/fraud.service'
import { safeAudit } from '@/lib/adapters/payment-webhook-utils'
import { isDuplicateWebhook, isDuplicateWebhookDB, generateWebhookId } from '@/lib/middleware/idempotency'
import { withWebhookErrorHandling } from '@/lib/middleware/webhook-error-handler'
import { getLogger } from '@/lib/logger'

const log = getLogger('webhook:chargeback')

/**
 * Verify the chargeback webhook signature. Supports two formats:
 *   1. `x-chargeback-signature: <hex>` — HMAC-SHA256(secret, rawBody).
 *   2. `stripe-signature: t=<ts>,v1=<hex>` — HMAC-SHA256(secret, "<ts>.<rawBody>").
 *
 * Dev-mode fallback: when no secret is configured AND we're not in prod,
 * accept the request with a warning (mirrors `StripeAdapter.webhookVerify`).
 */
function verifyChargebackSignature(
  rawBody: string,
  chargebackSig: string,
  stripeSig: string,
  secret: string,
): boolean {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CHARGEBACK_WEBHOOK_SECRET not configured in production')
    }
    log.warn(
      'CHARGEBACK_WEBHOOK_SECRET not configured — skipping verification in dev mode',
    )
    return true
  }

  // ── Form 1: simple hex digest ───────────────────────────────────────
  if (chargebackSig) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(chargebackSig)
    if (a.length !== b.length) return false
    try {
      return timingSafeEqual(a, b)
    } catch {
      return false
    }
  }

  // ── Form 2: Stripe-style `t=<ts>,v1=<hex>` ──────────────────────────
  if (stripeSig) {
    const parts = new Map<string, string>()
    for (const part of stripeSig.split(',')) {
      const idx = part.indexOf('=')
      if (idx > 0) parts.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim())
    }
    const t = parts.get('t')
    const v1 = parts.get('v1')
    if (!t || !v1) return false
    const manifest = `${t}.${rawBody}`
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(v1)
    if (a.length !== b.length) return false
    try {
      return timingSafeEqual(a, b)
    } catch {
      return false
    }
  }

  return false
}

// ── Payload schemas ─────────────────────────────────────────────────────
//
// Two accepted shapes:
//   1. Generic chargeback: `{ tenantId, orderId, reason, cardBin? }`
//   2. Stripe dispute forwarded: `{ type: 'charge.dispute.created',
//      data: { object: { id, status, reason, amount, ...,
//      charge: {...}, payment_method_details: { card: { brand, bin } } } } }`
//      + `tenantId` + `orderId` injected at the top by the Stripe webhook
//      forwarder.

const GenericChargebackSchema = z.object({
  tenantId: z.string().min(1),
  orderId: z.string().min(1),
  reason: z.string().default('unspecified'),
  cardBin: z.string().optional(),
})

const StripeDisputeSchema = z.object({
  tenantId: z.string().min(1),
  orderId: z.string().min(1),
  type: z.literal('charge.dispute.created'),
  data: z.object({
    object: z
      .object({
        id: z.string().optional(),
        status: z.string().optional(),
        reason: z.string().optional(),
        amount: z.number().optional(),
        currency: z.string().optional(),
      })
      .passthrough(),
  }),
})

/**
 * POST /api/webhooks/chargeback
 *
 * Chargeback feedback loop — closes the R-3 anti-fraud gap by feeding
 * dispute notifications back into the blocklist.
 *
 * @security HMAC-SHA256 verified via CHARGEBACK_WEBHOOK_SECRET (timing-safe).
 *           Dev mode: warn + accept when no secret is configured.
 * @returns 200 always (gateway contract — non-2xx triggers 24h+ retries).
 */
export const POST = withWebhookErrorHandling(async (req: NextRequest) => {
  const rawBody = await req.text()
  const chargebackSig = req.headers.get('x-chargeback-signature') ?? ''
  const stripeSig = req.headers.get('stripe-signature') ?? ''
  const secret = process.env.CHARGEBACK_WEBHOOK_SECRET ?? ''

  // Verify signature — throws in prod when the secret is missing (mirrors
  // StripeAdapter.webhookVerify behaviour).
  let sigValid: boolean
  try {
    sigValid = verifyChargebackSignature(rawBody, chargebackSig, stripeSig, secret)
  } catch (err) {
    await safeAudit(
      'webhook.chargeback.config_error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
    )
    return NextResponse.json(
      { error: 'Webhook verification configuration error' },
      { status: 500 },
    )
  }

  if (!sigValid) {
    // Rotation grace period — try the OLD secret if configured.
    const oldSecret = process.env.CHARGEBACK_WEBHOOK_SECRET_OLD
    if (oldSecret) {
      try {
        sigValid = verifyChargebackSignature(rawBody, chargebackSig, stripeSig, oldSecret)
      } catch {
        sigValid = false
      }
      if (sigValid) {
        log.warn('Webhook verified with OLD secret — rotation in progress')
      }
    }
  }

  if (!sigValid) {
    await safeAudit('webhook.chargeback.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
  }

  // ── Idempotency (same 2-layer pattern as the other webhooks) ────────
  const webhookId = generateWebhookId(rawBody, chargebackSig || stripeSig)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }
  if (await isDuplicateWebhookDB('webhook.chargeback.', webhookId)) {
    isDuplicateWebhook(webhookId)
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  // ── Parse + dispatch ─────────────────────────────────────────────────
  let body: Record<string, unknown> = {}
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    body = {}
  }

  try {
    // Try generic shape first, then Stripe dispute shape.
    let tenantId: string
    let orderId: string
    let reason: string
    let cardBin: string | undefined

    const generic = GenericChargebackSchema.safeParse(body)
    if (generic.success) {
      tenantId = generic.data.tenantId
      orderId = generic.data.orderId
      reason = generic.data.reason
      cardBin = generic.data.cardBin
    } else {
      const dispute = StripeDisputeSchema.safeParse(body)
      if (!dispute.success) {
        await safeAudit(
          'webhook.chargeback.invalid_payload',
          'Webhook',
          JSON.stringify(generic.error.flatten()),
        )
        return NextResponse.json({ received: true, status: 'invalid_payload' })
      }
      tenantId = dispute.data.tenantId
      orderId = dispute.data.orderId
      reason = dispute.data.data.object.reason ?? 'chargeback'
      // Try to extract the card BIN from the forwarded Stripe payload.
      const obj = dispute.data.data.object as Record<string, unknown>
      const pmd = obj.payment_method_details as
        | { card?: { brand?: string; iin?: string } }
        | undefined
      cardBin = pmd?.card?.iin
    }

    // ── Record the chargeback → marks order + adds to blocklist ──────
    await fraudService.recordChargeback(tenantId, orderId, reason)

    // ── Optional card BIN blocklist (when the payload included one) ──
    if (cardBin && cardBin.length >= 6) {
      await fraudService.addToBlocklist(tenantId, {
        type: 'card_bin',
        value: cardBin.slice(0, 6),
        reason: 'chargeback',
        source: 'auto',
      })
    }

    await safeAudit(
      'webhook.chargeback.inbound',
      'Webhook',
      `tenant=${tenantId} order=${orderId} reason=${reason}`,
      webhookId,
    )
  } catch (err) {
    await safeAudit(
      'webhook.chargeback.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
      webhookId,
    )
  }

  // Always ACK 200 (gateway contract).
  return NextResponse.json({ received: true })
})
