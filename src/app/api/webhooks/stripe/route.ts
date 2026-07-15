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

/**
 * Stripe webhook handler.
 *
 * Recibe `checkout.session.*` y `payment_intent.*` eventos de Stripe
 * (Saramantha §10). Verifica la firma HMAC-SHA256 (`stripe-signature:
 * t=<ts>,v1=<hex>`) con `STRIPE_WEBHOOK_SECRET` vía
 * `StripeAdapter.webhookVerify`. Tras verificar, mapea el estado de
 * `obj.payment_status` (paid / unpaid / no_payment_required) y aplica
 * `applyPaymentUpdate` — actualiza `Order.paymentStatus` + crea
 * `OrderEvent` + dispara el evento CAPI Purchase si la orden pasa a `paid`.
 *
 * Idempotencia de 2 capas: in-memory Map (fast path) + DB-backed AuditLog
 * (multi-instancia) usando el `webhookId` como `entityId` indexado.
 *
 * @see https://stripe.com/docs/webhooks
 * @security Adapter throws en producción si falta `STRIPE_WEBHOOK_SECRET` (R3).
 *           Dev mode: warn + acepta; producción: 500 para alertar al operador.
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
      await applyPaymentUpdate({
        gateway: 'stripe',
        paymentId: sessionId,
        externalReference: clientRef,
        status,
        success,
      })
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
