import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyMetaSignature } from '@/lib/middleware/hmac'
import { isDuplicateWebhook, generateWebhookId } from '@/lib/middleware/idempotency'

// WhatsApp Cloud API webhook (Meta).
// GET = verification, POST = inbound messages.
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = process.env.WA_VERIFY_TOKEN || 'commerceflow_verify'
  if (mode === 'subscribe' && token === expected) {
    return new NextResponse(challenge || '', { status: 200 })
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}

export async function POST(req: NextRequest) {
  // ── HMAC verification (Saramantha §10) ───────────────────────────────
  // Meta firma el body con HMAC-SHA256 usando el App Secret y lo envía en
  // el header `X-Hub-Signature-256`. Si la firma no verifica, devolvemos 403.
  // En dev-mode (sin META_APP_SECRET configurado), aceptamos cualquier firma
  // no vacía para no romper el flujo local.
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256') ?? ''
  const appSecret = process.env.META_APP_SECRET ?? ''

  let sigValid: boolean
  if (!appSecret) {
    // Dev-mode fallback.
    sigValid = signature.length > 0
  } else {
    sigValid = verifyMetaSignature(rawBody, signature, appSecret)
  }

  if (!sigValid) {
    await db.auditLog.create({
      data: { action: 'webhook.wa.invalid_sig', entity: 'Webhook', meta: rawBody.slice(0, 1000) },
    })
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 })
  }

  // ── Idempotency (SPRINT4-INFRA-001) ────────────────────────────────────
  // Meta can retry this webhook up to ~24h if our ACK is delayed. Skip the
  // body if we've already processed this exact (body + signature) within the
  // 5-minute TTL window — see src/lib/middleware/idempotency.ts.
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  let body: unknown = {}
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    body = {}
  }

  // In production: parse entry[].changes[].value.messages, resolve customer by wa_id,
  // upsert conversation on the WhatsApp channel, store message, emit via socket.io.
  // We log to audit for the demo.
  await db.auditLog.create({
    data: { action: 'webhook.wa.inbound', entity: 'Webhook', meta: JSON.stringify(body).slice(0, 1000) },
  })
  return NextResponse.json({ received: true })
}
