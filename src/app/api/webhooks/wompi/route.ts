// ZIAY — Wompi webhook
// Saramantha §10 — recibe notificaciones de transacción de Wompi.
//
// Body example:
//   {
//     "event": "transaction.updated",
//     "data": {
//       "transaction": {
//         "id": "1234-5678-...",
//         "status": "APPROVED",
//         "reference": "ORD-2024-001",
//         "amount_in_cents": 15000000,
//         "currency": "COP"
//       }
//     }
//   }
//
// Header signature: `X-Events-Signature: <hex>` — verified via
// WompiAdapter.webhookVerify using WOMPI_EVENT_SECRET.
//
// Siempre responde 200 (ack) para evitar reintentos de Wompi.

import { NextRequest, NextResponse } from 'next/server'
import { WompiAdapter } from '@/lib/adapters/wompi'
import { applyPaymentUpdate, safeAudit } from '@/lib/adapters/payment-webhook-utils'
import { isDuplicateWebhook, isDuplicateWebhookDB, generateWebhookId } from '@/lib/middleware/idempotency'
import { withWebhookErrorHandling } from '@/lib/middleware/webhook-error-handler'
import { getLogger } from '@/lib/logger'

const logger = getLogger('webhook:wompi')

/**
 * Wompi webhook handler.
 *
 * Recibe eventos `transaction.updated` (y otros `transaction.*`) de Wompi
 * (Saramantha §10). Verifica la firma HMAC (`X-Events-Signature: <hex>`)
 * con `WOMPI_EVENT_SECRET` vía `WompiAdapter.webhookVerify`. Tras verificar,
 * usa el estado reportado en `data.transaction.status` (APPROVED / DECLINED
 * / PENDING) y aplica `applyPaymentUpdate` — actualiza `Order.paymentStatus`
 * + crea `OrderEvent` + dispara el evento CAPI Purchase si la orden pasa a
 * `paid`.
 *
 * Idempotencia de 2 capas: in-memory Map (fast path) + DB-backed AuditLog
 * (multi-instancia) usando el `webhookId` como `entityId` indexado.
 *
 * @see https://docs.wompi.co/docs/es/webhooks
 * @security Adapter throws en producción si falta `WOMPI_EVENT_SECRET` (R3).
 *           Dev mode: warn + acepta; producción: 500 para alertar al operador.
 * @returns 200 siempre (ack) para evitar reintentos de Wompi;
 *          `status: 'invalid_signature'` si la firma no verifica;
 *          `status: 'duplicate'` si ya fue procesado.
 */
export const POST = withWebhookErrorHandling(async (req: NextRequest) => {
  const rawBody = await req.text()
  const signature = req.headers.get('x-events-signature') ?? ''
  const adapter = new WompiAdapter()

  // Adapter throws in production when the webhook secret is missing (R3).
  // Surface that as a 500 so the gateway retries and the operator is
  // alerted — silently ACKing 200 would mask the misconfiguration.
  let sigValid: boolean
  try {
    sigValid = adapter.webhookVerify(rawBody, signature)
  } catch (err) {
    await safeAudit(
      'webhook.wompi.config_error',
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
    // accepts an optional `secretOverride` for this purpose. Naming note:
    // the current Wompi env var is `WOMPI_EVENT_SECRET`, but we accept the
    // OLD value via `WOMPI_WEBHOOK_SECRET_OLD` to keep the rotation env-var
    // naming uniform across all 4 gateways (`*_WEBHOOK_SECRET_OLD`).
    const oldSecret = process.env.WOMPI_WEBHOOK_SECRET_OLD
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
    await safeAudit('webhook.wompi.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
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
  if (await isDuplicateWebhookDB('webhook.wompi.', webhookId)) {
    isDuplicateWebhook(webhookId) // warm the in-memory cache
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  let body: Record<string, unknown> = {}
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    body = {}
  }

  const event = String(body.event ?? '')
  const data = (body.data ?? {}) as Record<string, unknown>
  const tx = (data.transaction ?? data) as Record<string, unknown>
  const txId = String(tx.id ?? '')
  const reference = String(tx.reference ?? '')

  try {
    if (event.startsWith('transaction.') && txId) {
      // Use the status reported in the webhook (Wompi lo incluye en `data`).
      const status = String(tx.status ?? 'UNKNOWN')
      const success = status === 'APPROVED'
      // AUDIT-FINTECH R-6 — Wompi reports `amount_in_cents` + `currency` in
      // the transaction object. Convert cents → major unit so the value
      // matches `Order.total` (stored in the major unit).
      const amountInCents = Number(tx.amount_in_cents ?? 0)
      const amount =
        Number.isFinite(amountInCents) && amountInCents > 0
          ? amountInCents / 100
          : undefined
      const currency = tx.currency ? String(tx.currency).toUpperCase() : undefined

      // I2-R3 — extract CVV/AVS verification results from the Wompi
      // transaction payload. Wompi reports them under `payment_method.extra`:
      //   - `cvc` / `security_code` → 'M' (match) / 'N' (no match) /
      //     'P' (not processed) / 'S' (not supported)
      //   - `address` / `address_line_1_check` → same codes
      const paymentMethod = (tx.payment_method ?? {}) as Record<string, unknown>
      const extra = (paymentMethod.extra ?? {}) as Record<string, unknown>
      const cvvResult =
        typeof extra.cvc === 'string'
          ? extra.cvc
          : typeof extra.security_code === 'string'
            ? extra.security_code
            : undefined
      const avsResult =
        typeof extra.address === 'string'
          ? extra.address
          : typeof extra.address_line_1_check === 'string'
            ? extra.address_line_1_check
            : undefined

      await applyPaymentUpdate({
        gateway: 'wompi',
        paymentId: txId,
        externalReference: reference,
        status,
        success,
        amount,
        currency,
        cvvResult,
        avsResult,
      })
    }
    await safeAudit('webhook.wompi.inbound', 'Webhook', rawBody.slice(0, 1000), webhookId)
  } catch (err) {
    await safeAudit(
      'webhook.wompi.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
      webhookId,
    )
  }

  return NextResponse.json({ received: true })
})
