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

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''
  const adapter = new StripeAdapter()

  if (!adapter.webhookVerify(rawBody, signature)) {
    await safeAudit('webhook.stripe.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
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
    await safeAudit('webhook.stripe.inbound', 'Webhook', rawBody.slice(0, 1000))
  } catch (err) {
    await safeAudit(
      'webhook.stripe.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
    )
  }

  return NextResponse.json({ received: true })
}
