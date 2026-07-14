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

export async function POST(req: NextRequest) {
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
      await applyPaymentUpdate({
        gateway: 'mercadopago',
        paymentId,
        externalReference: externalRef,
        status: result.status,
        success: result.success,
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
}
