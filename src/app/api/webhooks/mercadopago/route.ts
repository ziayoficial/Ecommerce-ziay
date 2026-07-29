// ZIAY — MercadoPago webhook
// Saramantha §10 — recibe notificaciones de pago de MercadoPago.
//
// Body example:
//   {
//     "type": "payment",
//     "data": { "id": "123456789" },
//     "action": "payment.updated",
//     "live_mode": true
//   }
//
// Header signature: `x-signature: ts=<ts>,v1=<hex>` — verified via
// MercadoPagoAdapter.webhookVerify using MERCADOPAGO_WEBHOOK_SECRET.
//
// Siempre responde 200 (ack) para evitar reintentos de MP, incluso cuando la
// firma no verifica o la Order no se encuentra (logged in AuditLog).

import { NextRequest, NextResponse } from 'next/server'
import { MercadoPagoAdapter } from '@/lib/adapters/mercadopago'
import { applyPaymentUpdate, safeAudit } from '@/lib/adapters/payment-webhook-utils'
import { isDuplicateWebhook, isDuplicateWebhookDB, generateWebhookId } from '@/lib/middleware/idempotency'
import { withWebhookErrorHandling } from '@/lib/middleware/webhook-error-handler'
import { getLogger } from '@/lib/logger'

const logger = getLogger('webhook:mercadopago')

/**
 * MercadoPago webhook handler.
 *
 * Recibe notificaciones `payment` y `merchant_order` de MercadoPago (Saramantha §10).
 * Verifica la firma HMAC (`x-signature: ts=<ts>,v1=<hex>`) con
 * `MERCADOPAGO_WEBHOOK_SECRET` vía `MercadoPagoAdapter.webhookVerify`.
 * Tras verificar, llama a la pasarela (`verifyPayment`) para obtener el
 * estado canónico + `external_reference` (= Order.number) y aplica el
 * `applyPaymentUpdate` (actualiza `Order.paymentStatus` + crea `OrderEvent`
 * + dispara el evento CAPI Purchase si la orden pasa a `paid`).
 *
 * Idempotencia de 2 capas: in-memory Map (fast path) + DB-backed AuditLog
 * (multi-instancia) usando el `webhookId` como `entityId` indexado.
 *
 * @see https://www.mercado_pago.com/developers/es/docs/checkout-api/webhooks
 * @security Adapter throws en producción si falta `MERCADOPAGO_WEBHOOK_SECRET` (R3).
 *           Dev mode: warn + acepta; producción: 500 para alertar al operador.
 * @returns 200 siempre (ack) para evitar reintentos de MercadoPago;
 *          `status: 'invalid_signature'` si la firma no verifica;
 *          `status: 'duplicate'` si ya fue procesado.
 */
export const POST = withWebhookErrorHandling(async (req: NextRequest) => {
  const rawBody = await req.text()
  const signature = req.headers.get('x-signature') ?? ''
  const adapter = new MercadoPagoAdapter()

  // Adapter throws in production when the webhook secret is missing (R3).
  // Surface that as a 500 so the gateway retries and the operator is
  // alerted — silently ACKing 200 would mask the misconfiguration.
  let sigValid: boolean
  try {
    sigValid = adapter.webhookVerify(rawBody, signature)
  } catch (err) {
    await safeAudit(
      'webhook.mercadopago.config_error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
    )
    return NextResponse.json(
      { error: 'Webhook verification configuration error' },
      { status: 500 },
    )
  }

  // Always ACK 200 — but only process when the signature verifies.
  if (!sigValid) {
    // SPRINT-FIXES-FINAL-001 §4 — Webhook signature rotation grace period.
    // Try the OLD secret (if configured) when the current secret fails to
    // verify — supports hot-rotation without dropping in-flight webhooks
    // signed with the previous secret. The adapter's `webhookVerify`
    // accepts an optional `secretOverride` for this purpose.
    const oldSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET_OLD
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
    await safeAudit('webhook.mercadopago.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
  }

  // ── Idempotency (SPRINT4-INFRA-001 + FIX-REALTIME-WEBHOOKS-001) ───────
  // Two layers: in-memory Map (fast path) + DB-backed AuditLog query
  // (durable, multi-instance). The DB check uses the webhookId as
  // `entityId` so it's indexed and cheap.
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }
  if (await isDuplicateWebhookDB('webhook.mercadopago.', webhookId)) {
    isDuplicateWebhook(webhookId) // warm the in-memory cache
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
  const paymentId = String(data.id ?? '')

  try {
    if ((type === 'payment' || type === 'merchant_order') && paymentId) {
      // Verify the payment with the gateway to avoid spoofing and get the
      // canonical status + external_reference (== Order.number).
      const result = await adapter.verifyPayment(paymentId)
      const raw = result.rawResponse as Record<string, unknown> | undefined
      const externalRef = String(raw?.external_reference ?? '')

      // I2-R3 — extract CVV/AVS verification results from the MP payment
      // payload. MercadoPago reports CVV via `card.esc_status` (0=fail,
      // 1=pass, 2=not processed). MP doesn't standardize AVS in the webhook
      // payload (it's not commonly used in LATAM), so we leave it
      // undefined — the merchant can extend this when needed.
      const card = (raw?.card ?? {}) as Record<string, unknown>
      const escStatus = card.esc_status
      // `esc_status === 0` is the only "explicit failure" code — 1 = pass,
      // 2 = not processed, null/undefined = not reported.
      const cvvResult =
        escStatus === 0 ? 'N' : escStatus === 1 ? 'M' : undefined

      // AUDIT-FINTECH R-6 — pass the gateway-reported amount/currency so
      // `applyPaymentUpdate` can defend against forged-amount webhooks.
      await applyPaymentUpdate({
        gateway: 'mercadopago',
        paymentId,
        externalReference: externalRef,
        status: result.status,
        success: result.success,
        amount: typeof result.amount === 'number' && result.amount > 0 ? result.amount : undefined,
        currency: result.currency || undefined,
        cvvResult,
      })
    }
    await safeAudit('webhook.mercadopago.inbound', 'Webhook', rawBody.slice(0, 1000), webhookId)
  } catch (err) {
    await safeAudit(
      'webhook.mercadopago.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
      webhookId,
    )
  }

  // Always ACK 200 to stop MercadoPago retries.
  return NextResponse.json({ received: true })
})
