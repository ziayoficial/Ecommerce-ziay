import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyMetaSignature } from '@/lib/middleware/hmac'
import { isDuplicateWebhook, isDuplicateWebhookDB, generateWebhookId } from '@/lib/middleware/idempotency'
import { withWebhookErrorHandling } from '@/lib/middleware/webhook-error-handler'

// Meta (Messenger + Instagram + WhatsApp) ad platform webhook + lead/attributions.

/**
 * Meta platform webhook — verification handshake (GET).
 *
 * Meta envía un GET con `hub.mode=subscribe`, `hub.verify_token` y
 * `hub.challenge` al configurar el webhook en el App Dashboard (para
 * Messenger, Instagram o la ad platform). Si el `verify_token` coincide
 * con `META_VERIFY_TOKEN` (env var), se devuelve el `challenge` literal
 * con 200 para completar el handshake.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 * @returns 200 con el `challenge` si el token verifica; 403 si no coincide.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = process.env.META_VERIFY_TOKEN || 'commerceflow_verify'
  if (mode === 'subscribe' && token === expected) {
    return new NextResponse(challenge || '', { status: 200 })
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}

/**
 * Meta platform webhook — inbound events (POST).
 *
 * Recibe eventos de la plataforma Meta: leads del Lead Gen Ads, atribuciones
 * de campañas, callbacks de Messenger / Instagram. El body se persiste
 * (truncado a 1000 chars) en `AuditLog` para trazabilidad; el dispatcher
 * específico (lead / attribution / messaging) se invoca desde otros
 * servicios que consumen el AuditLog.
 *
 * Verificación HMAC-SHA256 con `META_APP_SECRET` sobre el header
 * `X-Hub-Signature-256`. Idempotencia de 2 capas: in-memory Map (fast path)
 * + DB-backed AuditLog (multi-instancia) usando el `webhookId` como
 * `entityId` indexado.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 * @security HMAC verificada con `verifyMetaSignature` (timingSafeEqual).
 *           Producción: 500 si falta `META_APP_SECRET` (forged webhooks
 *           serían aceptados silenciosamente).
 *           Dev mode: warn + acepta cualquier firma no vacía.
 * @returns 200 siempre (ack) para evitar reintentos de Meta;
 *          403 si la firma no verifica;
 *          `status: 'duplicate'` si ya fue procesado.
 */
export const POST = withWebhookErrorHandling(async (req: NextRequest) => {
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
    // Dev-mode fallback: throw in production (forged webhooks would be
    // silently accepted), warn + allow in dev. FIX-REALTIME-WEBHOOKS-001 · R3.
    if (process.env.NODE_ENV === 'production') {
      await db.auditLog.create({
        data: { action: 'webhook.meta.no_secret', entity: 'Webhook', metadata: 'META_APP_SECRET missing in production' },
      })
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }
    console.warn('[webhooks/meta] META_APP_SECRET not set — skipping verification in dev mode')
    sigValid = signature.length > 0
  } else {
    sigValid = verifyMetaSignature(rawBody, signature, appSecret)
  }

  if (!sigValid) {
    await db.auditLog.create({
      data: { action: 'webhook.meta.invalid_sig', entity: 'Webhook', metadata: rawBody.slice(0, 1000) },
    })
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 })
  }

  // ── Idempotency (SPRINT4-INFRA-001 + FIX-REALTIME-WEBHOOKS-001) ───────
  // Two layers: in-memory Map (fast path) + DB-backed AuditLog query
  // (durable, multi-instance). Meta retries webhooks if our ACK is delayed.
  // The DB check uses the webhookId as `entityId` so it's indexed and cheap.
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }
  if (await isDuplicateWebhookDB('webhook.meta.', webhookId)) {
    isDuplicateWebhook(webhookId) // warm the in-memory cache
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  let body: unknown = {}
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    body = {}
  }

  await db.auditLog.create({
    data: {
      action: 'webhook.meta.inbound',
      entity: 'Webhook',
      metadata: JSON.stringify(body).slice(0, 1000),
      entityId: webhookId,
    },
  })
  return NextResponse.json({ received: true })
})
