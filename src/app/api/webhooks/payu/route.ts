// ZIAY — PayU webhook
// Saramantha §10 — recibe confirmaciones de pago de PayU.
//
// Body example:
//   {
//     "reference_sale": "ORD-2024-001",
//     "value": "150000.00",
//     "currency": "COP",
//     "state_pol": "4",
//     "transaction_id": "abc-123",
//     "sign": "<md5>"
//   }
//
// Header signature: PayU suele mandar `x-payu-signature: <md5>`; algunos
// merchants reciben la firma dentro del body (campo `sign`). El route acepta
// ambas y la pasa al adapter para su verificación con MD5.
//
// Nota: `state_pol` es un código numérico — PayU: 4=APPROVED, 6=DECLINED,
// 5=EXPIRED, 7=PENDING. El adapter no conoce el mapeo; la firma MD5 es
// calculada sobre `state_pol` literal, no sobre el string canónico.
//
// Siempre responde 200 (ack) para evitar reintentos de PayU.

import { NextRequest, NextResponse } from 'next/server'
import { PayUAdapter } from '@/lib/adapters/payu'
import { applyPaymentUpdate, safeAudit } from '@/lib/adapters/payment-webhook-utils'
import { isDuplicateWebhook, isDuplicateWebhookDB, generateWebhookId } from '@/lib/middleware/idempotency'
import { withWebhookErrorHandling } from '@/lib/middleware/webhook-error-handler'
import { getLogger } from '@/lib/logger'

const logger = getLogger('webhook:payu')

/** Map de códigos `state_pol` de PayU a strings canónicos. */
const PAYU_STATE_POL_MAP: Record<string, string> = {
  '4': 'APPROVED',
  '6': 'DECLINED',
  '5': 'EXPIRED',
  '7': 'PENDING',
  '104': 'ERROR',
  '-1': 'ERROR',
}

/**
 * PayU webhook handler.
 *
 * Recibe confirmaciones de pago de PayU (Saramantha §10). El cuerpo incluye
 * `reference_sale` (= Order.number), `state_pol` (código numérico) y
 * `transaction_id`. La firma MD5 puede venir en el header `x-payu-signature`
 * o dentro del body (campo `sign`); el route acepta ambas y la pasa al
 * `PayUAdapter.webhookVerify`. Tras verificar, mapea `state_pol` a estado
 * canónico (4=APPROVED, 6=DECLINED, 5=EXPIRED, 7=PENDING) y aplica
 * `applyPaymentUpdate` — actualiza `Order.paymentStatus` + crea `OrderEvent`
 * + dispara el evento CAPI Purchase si la orden pasa a `paid`.
 *
 * Idempotencia de 2 capas: in-memory Map (fast path) + DB-backed AuditLog
 * (multi-instancia) usando el `webhookId` como `entityId` indexado. La firma
 * se resuelve arriba (header OR body `sign`) para que la key de
 * idempotencia sea estable sin importar el path de la firma.
 *
 * @see https://developers.payulatam.com/latam/es/docs/integrations/webhooks/integration.html
 * @security Adapter throws en producción si faltan credenciales (R3).
 *           Dev mode: warn + acepta; producción: 500 para alertar al operador.
 * @returns 200 siempre (ack) para evitar reintentos de PayU;
 *          `status: 'invalid_signature'` si la firma no verifica;
 *          `status: 'duplicate'` si ya fue procesado.
 */
export const POST = withWebhookErrorHandling(async (req: NextRequest) => {
  const rawBody = await req.text()
  const headerSig = req.headers.get('x-payu-signature') ?? ''
  const adapter = new PayUAdapter()

  // PayU puede mandar la firma en header o dentro del body (campo `sign`).
  let body: Record<string, unknown> = {}
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    body = {}
  }
  const bodySig = String(body?.sign ?? '')
  const signature = headerSig || bodySig

  // Adapter throws in production when the credentials are missing (R3).
  // Surface that as a 500 so the gateway retries and the operator is
  // alerted — silently ACKing 200 would mask the misconfiguration.
  let sigValid: boolean
  try {
    sigValid = adapter.webhookVerify(rawBody, signature)
  } catch (err) {
    await safeAudit(
      'webhook.payu.config_error',
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
    // Try the OLD API key (if configured) when the current key fails to
    // verify — supports hot-rotation of PAYU_API_KEY without dropping
    // in-flight webhooks signed with the previous key. The adapter's
    // `webhookVerify` accepts an optional `secretOverride` (interpreted
    // as the alternate API key for PayU's MD5 signature) for this purpose.
    const oldSecret = process.env.PAYU_WEBHOOK_SECRET_OLD
    if (oldSecret) {
      try {
        sigValid = adapter.webhookVerify(rawBody, signature, oldSecret)
      } catch {
        sigValid = false
      }
      if (sigValid) {
        logger.warn('Webhook verified with OLD secret — rotation in progress')
      }
    }
  }

  if (!sigValid) {
    await safeAudit('webhook.payu.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
  }

  // ── Idempotency (SPRINT4-INFRA-001 + FIX-REALTIME-WEBHOOKS-001) ───────
  // Two layers: in-memory Map (fast path) + DB-backed AuditLog query
  // (durable, multi-instance). The signature is resolved above (header OR
  // body `sign` field) so the idempotency key is stable regardless of which
  // path the signature came from. The DB check uses the webhookId as
  // `entityId` so it's indexed and cheap.
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }
  if (await isDuplicateWebhookDB('webhook.payu.', webhookId)) {
    isDuplicateWebhook(webhookId) // warm the in-memory cache
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  try {
    const reference = String(body?.reference_sale ?? body?.referenceCode ?? body?.reference ?? '')
    const statePol = String(body?.state_pol ?? body?.state ?? '')
    const stateCanonical = PAYU_STATE_POL_MAP[statePol] ?? statePol
    const txId = String(body?.transaction_id ?? body?.transactionId ?? reference)
    const success = stateCanonical === 'APPROVED'

    // AUDIT-FINTECH R-6 — PayU sends `value` as a string (e.g. "150000.00")
    // and `currency` (COP/MXN/...) at the top level of the webhook body.
    // Parse the value so `applyPaymentUpdate` can compare it to `order.total`.
    const valueStr = String(body?.value ?? body?.amount ?? '')
    const parsedValue = parseFloat(valueStr)
    const amount = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined
    const currency = body?.currency ? String(body.currency).toUpperCase() : undefined

    // I2-R3 — extract CVV/AVS verification results from the PayU payload.
    // PayU reports them as `response_verification_pol` (a string of
    // single-letter codes for AVS + CVV + 3DS) OR as separate top-level
    // fields `avs_response` and `cvv_response` (depending on the
    // integration mode). The codes are ISO 8583: 'N' = no match,
    // 'M' = match, 'P' = not processed, etc.
    const cvvResult =
      typeof body?.cvv_response === 'string'
        ? body.cvv_response
        : typeof body?.cvc_response === 'string'
          ? body.cvc_response
          : undefined
    const avsResult =
      typeof body?.avs_response === 'string'
        ? body.avs_response
        : undefined

    // AUDIT-FINTECH R-13 — Defense-in-depth: PayU uses MD5 for webhook
    // signatures (gateway-imposed, not changeable). MD5 is weak to collision
    // attacks. To mitigate, we re-verify the payment status by calling
    // `verifyPayment` directly — the same pattern used in the MercadoPago
    // webhook. This means an attacker who somehow forges a webhook (e.g. via
    // a leaked secret) still cannot mark an order `paid` unless PayU's own
    // API also reports the transaction as approved. The re-check is
    // best-effort: if `verifyPayment` fails (network, auth), we fall back to
    // the webhook's `state_pol` (the signature was already verified).
    if (reference && success) {
      try {
        const verification = await adapter.verifyPayment(txId)
        if (verification && verification.status !== 'approved' && verification.status !== 'paid') {
          // PayU API disagrees with the webhook — refuse to mark paid.
          await applyPaymentUpdate({
            gateway: 'payu',
            paymentId: txId,
            externalReference: reference,
            status: 'payment_mismatch',
            success: false,
            amount,
            currency,
            cvvResult,
            avsResult,
          })
          await safeAudit(
            'webhook.payu.mismatch',
            'Webhook',
            `verifyPayment returned ${verification?.status} but webhook said APPROVED for tx ${txId}`,
            webhookId,
          )
          return NextResponse.json({ received: true, status: 'mismatch' })
        }
      } catch (verifyErr) {
        // verifyPayment failed (network/auth) — fall back to webhook signature.
        // The signature was already verified via webhookVerify above, so this
        // is acceptable. Log for monitoring.
        await safeAudit(
          'webhook.payu.verify_skipped',
          'Webhook',
          `verifyPayment failed: ${verifyErr instanceof Error ? verifyErr.message : 'unknown'} — falling back to webhook signature`,
          webhookId,
        )
      }
    }

    if (reference) {
      await applyPaymentUpdate({
        gateway: 'payu',
        paymentId: txId,
        externalReference: reference,
        status: stateCanonical,
        success,
        amount,
        currency,
        cvvResult,
        avsResult,
      })
    }

    await safeAudit('webhook.payu.inbound', 'Webhook', rawBody.slice(0, 1000), webhookId)
  } catch (err) {
    await safeAudit(
      'webhook.payu.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
      webhookId,
    )
  }

  return NextResponse.json({ received: true })
})
