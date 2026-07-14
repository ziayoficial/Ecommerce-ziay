import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyMetaSignature } from '@/lib/middleware/hmac'
import { isDuplicateWebhook, isDuplicateWebhookDB, generateWebhookId } from '@/lib/middleware/idempotency'
import { parseWhatsAppInbound } from '@/lib/adapters/whatsapp-parser'
import { findWhatsAppChannelByPhoneNumberId, getWhatsAppAdapter } from '@/lib/adapters/whatsapp-cloud'
import { emitToTenant } from '@/lib/chat-emit'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('webhook:whatsapp')

// WhatsApp Cloud API webhook (Meta).
// GET  = verification handshake.
// POST = inbound messages + status updates — fully parsed + persisted
//        per study §13.1 (Cloud API) + §14.4 (CTWA + closed-loop CAPI).
//
// SPRINT-WHATSAPP-FUNCTIONAL-001 — replaces the prior stub that only
// wrote the raw body to AuditLog. Now:
//   1. HMAC verification (preserved from FIX-REALTIME-WEBHOOKS-001).
//   2. Idempotency check (in-memory Map + DB-backed, preserved).
//   3. Parse inbound message via `parseWhatsAppInbound`.
//   4. Resolve tenant via `phone_number_id` → Channel lookup.
//   5. Resolve / create Customer by E.164 phone.
//   6. Resolve / create Conversation (status=open) on the WA channel.
//   7. Persist Message row (direction=inbound, waMessageId for dedup).
//   8. Stamp CTWA click_id on the conversation (closed-loop attribution).
//   9. Emit `message:new` + `message:received` to chat-service /emit
//      (fire-and-forget — never blocks the webhook ACK).
//  10. Mark message as read (best-effort, non-blocking).
//  11. ALWAYS return 200 — Meta retries on non-200 for ~24h.
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
    // Dev-mode fallback: throw in production (forged webhooks would be
    // silently accepted), warn + allow in dev. FIX-REALTIME-WEBHOOKS-001 · R3.
    if (process.env.NODE_ENV === 'production') {
      await db.auditLog.create({
        data: { action: 'webhook.wa.no_secret', entity: 'Webhook', meta: 'META_APP_SECRET missing in production' },
      })
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }
    log.warn('META_APP_SECRET not set — skipping verification in dev mode')
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

  // ── Idempotency (SPRINT4-INFRA-001 + FIX-REALTIME-WEBHOOKS-001) ───────
  // Two layers: in-memory Map (fast path) + DB-backed AuditLog query
  // (durable, multi-instance). Meta can retry this webhook up to ~24h if
  // our ACK is delayed. The DB check uses the webhookId as `entityId` so
  // it's indexed and cheap.
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }
  if (await isDuplicateWebhookDB('webhook.wa.', webhookId)) {
    isDuplicateWebhook(webhookId) // warm the in-memory cache
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  let body: unknown = {}
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    body = {}
  }

  // ── Parse inbound message ────────────────────────────────────────────
  // Returns `null` for non-message payloads (status updates, template
  // callbacks). We still ACK 200 — Meta only retries on non-2xx.
  const parsed = parseWhatsAppInbound(body)
  if (!parsed) {
    // Audit the raw body for status / template callbacks so we have a
    // trace even when no message is processed. The webhookId is stored
    // as `entityId` for cross-instance dedup queries.
    await db.auditLog.create({
      data: {
        action: 'webhook.wa.non_message',
        entity: 'Webhook',
        meta: JSON.stringify(body).slice(0, 1000),
        entityId: webhookId,
      },
    })
    return NextResponse.json({ received: true, status: 'non_message' })
  }

  // Audit the parsed inbound (truncated) for traceability + dedup key.
  await db.auditLog.create({
    data: {
      action: 'webhook.wa.inbound',
      entity: 'Webhook',
      meta: JSON.stringify({
        from: parsed.from,
        messageId: parsed.messageId,
        type: parsed.type,
        text: parsed.text.slice(0, 200),
        ctwClickId: parsed.ctwClickId,
        phoneNumberId: parsed.phoneNumberId,
      }),
      entityId: webhookId,
    },
  })

  // ── Resolve tenant + channel via phone_number_id ─────────────────────
  let channelId: string | undefined
  let tenantId: string | undefined
  if (parsed.phoneNumberId) {
    const channel = await findWhatsAppChannelByPhoneNumberId(parsed.phoneNumberId)
    if (channel) {
      channelId = channel.id
      tenantId = channel.tenantId
    }
  }
  // Fallback: if no channel matches the phone_number_id, try the env-var
  // phone number ID (single-tenant dev setup) → first active WhatsApp
  // channel of the seeded `saramantha` tenant.
  if (!tenantId) {
    const envPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (envPhoneId) {
      const ch = await findWhatsAppChannelByPhoneNumberId(envPhoneId)
      if (ch) {
        channelId = ch.id
        tenantId = ch.tenantId
      }
    }
  }
  if (!tenantId || !channelId) {
    // No tenant owns this WA number — log + ACK 200. Meta shouldn't send
    // us webhooks for numbers we don't own, but if it does (misconfigured
    // app subscription) we don't want to retry forever.
    log.warn(
      { phoneNumberId: parsed.phoneNumberId, from: parsed.from },
      'WA inbound for unknown phone_number_id — no tenant/channel match',
    )
    return NextResponse.json({ received: true, status: 'no_channel' })
  }

  try {
    // ── Idempotency layer 3: WA message ID dedup ────────────────────────
    // Meta can retry the same inbound message up to ~24h. The webhookId
    // (body + signature hash) catches most retries, but Meta sometimes
    // re-signs the same payload with a fresh signature (rare). The
    // `waMessageId` is the durable dedup key — check it before persisting.
    if (parsed.messageId) {
      const existing = await db.message.findFirst({
        where: { waMessageId: parsed.messageId },
        select: { id: true },
      })
      if (existing) {
        log.info({ waMessageId: parsed.messageId }, 'WA inbound already persisted (messageId dedup)')
        return NextResponse.json({ received: true, status: 'duplicate_message_id' })
      }
    }

    // ── Resolve / create Customer by phone ─────────────────────────────
    let customer = await db.customer.findFirst({
      where: { tenantId, phone: parsed.from },
    })
    if (!customer) {
      customer = await db.customer.create({
        data: {
          tenantId,
          name: parsed.fromName || parsed.from,
          phone: parsed.from,
        },
      })
      log.info({ customerId: customer.id, phone: parsed.from, tenantId }, 'New customer created from WA inbound')
    }

    // ── Resolve / create open Conversation ─────────────────────────────
    // Look up by (tenantId, customerPhone, status=open). The composite
    // index added in SPRINT-WHATSAPP-FUNCTIONAL-001 makes this cheap.
    let conversation = await db.conversation.findFirst({
      where: { tenantId, customerPhone: parsed.from, status: 'open' },
    })
    if (!conversation) {
      conversation = await db.conversation.create({
        data: {
          tenantId,
          customerId: customer.id,
          channelId,
          status: 'open',
          customerPhone: parsed.from,
          // Stamp CTWA click_id on the conversation at creation time so
          // every order spawned from this conversation inherits it.
          ...(parsed.ctwClickId ? { clickId: parsed.ctwClickId } : {}),
        },
      })
      log.info(
        { conversationId: conversation.id, tenantId, clickId: parsed.ctwClickId },
        'New WhatsApp conversation created',
      )
    } else if (parsed.ctwClickId && !conversation.clickId) {
      // Conversation already existed (e.g. customer replied to a CTWA ad
      // mid-thread). Stamp the click_id retroactively so future orders
      // inherit it. Don't overwrite an existing clickId — the first one
      // is the most reliable attribution signal.
      await db.conversation.update({
        where: { id: conversation.id },
        data: { clickId: parsed.ctwClickId },
      })
    }

    // ── Persist the inbound Message row ────────────────────────────────
    const message = await db.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: 'inbound',
        body: parsed.text,
        type: parsed.type === 'text' ? 'text' : parsed.type,
        mediaUrl: parsed.imageUrl ?? null,
        status: 'received',
        waMessageId: parsed.messageId || null,
      },
    })

    // ── Bump conversation lastMessageAt + unreadCount ──────────────────
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        unreadCount: { increment: 1 },
      },
    })

    // ── Fire-and-forget realtime emit to chat-service ──────────────────
    // Two events for backward compat:
    //   - `message:new` — the existing event the messenger-view frontend
    //     already listens to (so the dashboard updates in real time).
    //   - `message:received` — the new semantic event per study §13.1
    //     (kept for future consumers / analytics; frontend ignores it).
    const livePayload = {
      conversationId: conversation.id,
      customerPhone: parsed.from,
      direction: 'inbound',
      body: parsed.text,
      type: parsed.type,
      timestamp: new Date(parsed.timestampMs).toISOString(),
      messageId: message.id,
      waMessageId: parsed.messageId,
    }
    emitToTenant(tenantId, 'message:new', livePayload)
    emitToTenant(tenantId, 'message:received', { conversationId: conversation.id, message: livePayload })

    // ── Mark message as read (best-effort, non-blocking) ───────────────
    // We do this AFTER the DB write so a slow Meta API call doesn't delay
    // persistence. The adapter swallows its own errors.
    if (parsed.messageId) {
      const adapter = await getWhatsAppAdapter(tenantId)
      if (adapter) {
        // Fire-and-forget — never blocks the webhook ACK.
        adapter.markMessageRead(parsed.messageId).catch((err) =>
          log.warn(
            { messageId: parsed.messageId, err: err instanceof Error ? err.message : String(err) },
            'markMessageRead failed (non-blocking)',
          ),
        )
      }
    }

    log.info(
      {
        conversationId: conversation.id,
        customerId: customer.id,
        tenantId,
        from: parsed.from,
        type: parsed.type,
        clickId: parsed.ctwClickId,
      },
      'WA inbound processed',
    )

    return NextResponse.json({ received: true, status: 'processed', conversationId: conversation.id })
  } catch (err) {
    // Best-effort: capture + ACK 200. Meta must not retry forever on a
    // transient DB error — we already wrote the audit log row above so
    // the message is recoverable from AuditLog.meta.
    captureError(err as Error, {
      action: 'webhook.wa.process',
      tenantId,
      channelId,
      from: parsed.from,
    })
    log.error(
      { err: err instanceof Error ? err.message : String(err), from: parsed.from, tenantId },
      'WA inbound processing failed — ACKing 200 to stop Meta retries',
    )
    return NextResponse.json({ received: true, status: 'processing_failed' })
  }
}
