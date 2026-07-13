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
import { isDuplicateWebhook, generateWebhookId } from '@/lib/middleware/idempotency'

/** Map de códigos `state_pol` de PayU a strings canónicos. */
const PAYU_STATE_POL_MAP: Record<string, string> = {
  '4': 'APPROVED',
  '6': 'DECLINED',
  '5': 'EXPIRED',
  '7': 'PENDING',
  '104': 'ERROR',
  '-1': 'ERROR',
}

export async function POST(req: NextRequest) {
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

  if (!adapter.webhookVerify(rawBody, signature)) {
    await safeAudit('webhook.payu.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
  }

  // ── Idempotency (SPRINT4-INFRA-001) ────────────────────────────────────
  // PayU retries webhooks if our ACK is delayed. Skip processing if we've
  // already handled this exact (body + signature) within the 5-min TTL.
  // The signature is resolved above (header OR body `sign` field) so the
  // idempotency key is stable regardless of which path the signature came from.
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  try {
    const reference = String(body?.reference_sale ?? body?.referenceCode ?? body?.reference ?? '')
    const statePol = String(body?.state_pol ?? body?.state ?? '')
    const stateCanonical = PAYU_STATE_POL_MAP[statePol] ?? statePol
    const txId = String(body?.transaction_id ?? body?.transactionId ?? reference)
    const success = stateCanonical === 'APPROVED'

    if (reference) {
      await applyPaymentUpdate({
        gateway: 'payu',
        paymentId: txId,
        externalReference: reference,
        status: stateCanonical,
        success,
      })
    }

    await safeAudit('webhook.payu.inbound', 'Webhook', rawBody.slice(0, 1000))
  } catch (err) {
    await safeAudit(
      'webhook.payu.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
    )
  }

  return NextResponse.json({ received: true })
}
