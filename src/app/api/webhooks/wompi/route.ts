// CommerceFlow OS — Wompi webhook
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

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-events-signature') ?? ''
  const adapter = new WompiAdapter()

  if (!adapter.webhookVerify(rawBody, signature)) {
    await safeAudit('webhook.wompi.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
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
      await applyPaymentUpdate({
        gateway: 'wompi',
        paymentId: txId,
        externalReference: reference,
        status,
        success,
      })
    }
    await safeAudit('webhook.wompi.inbound', 'Webhook', rawBody.slice(0, 1000))
  } catch (err) {
    await safeAudit(
      'webhook.wompi.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
    )
  }

  return NextResponse.json({ received: true })
}
