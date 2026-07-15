import { NextRequest, NextResponse } from 'next/server'
import { verifyHmacSha256 } from '@/lib/middleware/hmac'
import {
  isDuplicateWebhook,
  isDuplicateWebhookDB,
  generateWebhookId,
} from '@/lib/middleware/idempotency'
import {
  applyPaymentUpdate,
  safeAudit,
} from '@/lib/adapters/payment-webhook-utils'
import { getLogger } from '@/lib/logger'
import { withWebhookErrorHandling } from '@/lib/middleware/webhook-error-handler'

const log = getLogger('webhook/pse')

// ─────────────────────────────────────────────────────────────────────────────
// PSE (ACH Colombia) webhook — Comercio Agéntico study §18.
//
// PSE sends a server-to-server callback after the customer authenticates
// with their bank. The callback carries:
//   - transactionId (matches the reference returned by createPayment)
//   - state (OK / NOT_OK / PENDING / EXPIRED)
//   - reference (our caller-side reference)
//   - amount + currency
//
// Signature: PSE signs the body with HMAC-SHA256 using a shared secret
// (configured as PSE_WEBHOOK_SECRET). The signature is sent in the
// `X-PSE-Signature` header (hex-encoded).
//
// The webhook ALWAYS ACKs with 200 to stop PSE retries — failed processing
// is captured via safeAudit + the structured logger.
//
// SPRINT-MULTICOUNTRY-001
// ─────────────────────────────────────────────────────────────────────────────

// PSE state codes → our canonical payment status mapping.
function mapPseState(state: string): { status: string; success: boolean } {
  const s = state.toUpperCase()
  // PSE states: OK | NOT_OK | PENDING | EXPIRED | NOT_AUTHORIZED | FAILED
  if (s === 'OK' || s === 'APPROVED' || s === 'SUCCESS') {
    return { status: 'approved', success: true }
  }
  if (s === 'NOT_OK' || s === 'NOT_AUTHORIZED' || s === 'FAILED' || s === 'REJECTED') {
    return { status: 'rejected', success: false }
  }
  if (s === 'EXPIRED') {
    return { status: 'expired', success: false }
  }
  // PENDING + unknown → leave as pending (the next webhook or poll will update)
  return { status: 'pending', success: false }
}

/**
 * PSE (ACH Colombia) webhook handler.
 *
 * Recibe el callback server-to-server tras la autenticación bancaria del
 * cliente (estudio §18). El callback incluye `transactionId`, `state`
 * (OK / NOT_OK / PENDING / EXPIRED / NOT_AUTHORIZED / FAILED),
 * `reference` (= Order.number), `amount` y `currency`. PSE firma el body
 * con HMAC-SHA256 y lo envía en el header `X-PSE-Signature` (hex).
 *
 * Tras verificar, mapea `state` a estado canónico (approved / rejected /
 * expired / pending) vía `mapPseState` y aplica `applyPaymentUpdate` —
 * actualiza `Order.paymentStatus` + crea `OrderEvent` + dispara el evento
 * CAPI Purchase si la orden pasa a `paid`.
 *
 * Idempotencia de 2 capas: in-memory Map (fast path) + DB-backed AuditLog
 * (multi-instancia) usando el `webhookId` como `entityId` indexado.
 *
 * @see https://www.pse.com.co/persona
 * @security HMAC-SHA256 verificada con `verifyHmacSha256` (timingSafeEqual).
 *           Producción: 500 si falta `PSE_WEBHOOK_SECRET`.
 *           Dev mode: warn + acepta cualquier firma no vacía.
 * @returns 200 siempre (ack) para evitar reintentos de PSE;
 *          `status: 'invalid_signature'` si la firma no verifica;
 *          `status: 'duplicate'` si ya fue procesado.
 */
export const POST = withWebhookErrorHandling(async (req: NextRequest) => {
  const rawBody = await req.text()
  const signature = req.headers.get('x-pse-signature') ?? ''
  const secret = process.env.PSE_WEBHOOK_SECRET ?? ''

  // ── Signature verification ───────────────────────────────────────────
  // Dev-mode fallback (warn + accept non-empty sig) when the secret isn't
  // configured. Production MUST have PSE_WEBHOOK_SECRET set — otherwise a
  // 500 is returned so PSE retries and the operator is alerted.
  let sigValid: boolean
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      await safeAudit(
        'webhook.pse.no_secret',
        'Webhook',
        'PSE_WEBHOOK_SECRET missing in production',
      )
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 },
      )
    }
    log.warn('PSE_WEBHOOK_SECRET not set — skipping verification in dev mode')
    sigValid = signature.length > 0
  } else {
    sigValid = verifyHmacSha256(rawBody, signature, secret)
  }

  if (!sigValid) {
    await safeAudit('webhook.pse.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
  }

  // ── Idempotency (in-memory + DB) ─────────────────────────────────────
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }
  if (await isDuplicateWebhookDB('webhook.pse.', webhookId)) {
    isDuplicateWebhook(webhookId) // warm the in-memory cache
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  // ── Parse + dispatch ─────────────────────────────────────────────────
  let body: Record<string, unknown> = {}
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    body = {}
  }

  // PSE payload fields (best-effort — field names may vary by integration):
  //   { transactionId, state, reference, amount, currency, bankCode, ... }
  // Some integrations nest under `data` — handle both shapes.
  const data = (body.data ?? body) as Record<string, unknown>
  const txId = String(data.transactionId ?? data.transaction_id ?? body.transactionId ?? '')
  const reference = String(data.reference ?? body.reference ?? '')
  const state = String(data.state ?? data.status ?? body.state ?? 'PENDING')

  try {
    if (txId || reference) {
      const mapped = mapPseState(state)
      await applyPaymentUpdate({
        gateway: 'pse',
        paymentId: txId || reference,
        externalReference: reference || undefined,
        status: mapped.status,
        success: mapped.success,
      })
    }
    await safeAudit('webhook.pse.inbound', 'Webhook', rawBody.slice(0, 1000), webhookId)
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'PSE webhook processing failed',
    )
    await safeAudit(
      'webhook.pse.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
      webhookId,
    )
  }

  // Always ACK 200 — PSE retries on non-200.
  return NextResponse.json({ received: true })
})
