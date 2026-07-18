import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyHmacSha256 } from '@/lib/middleware/hmac'
import { resolveNocodbSecret } from '@/lib/middleware/webhook-secrets'

// POST /api/webhooks/nocodb-out
// Outbound webhook to NocoDB (Saramantha §10 — bidirectional sync).
// When an order moves columns in our Kanban, we POST the change to NocoDB
// so the operational team sees the update in their Kanban too.
// The NocoDB endpoint URL is configured via env NOCODB_WEBHOOK_URL.
//
// SECURITY · IF-2 · S-9 — webhook was previously UNAUTHENTICATED (the route
// lives under `/api/webhooks/**` which is public in middleware). Anyone
// could trigger outgoing webhooks to the configured `NOCODB_WEBHOOK_URL`
// AND inject AuditLog rows with attacker-controlled `tenantId` (audit-log
// poisoning). Now requires an HMAC-SHA256 signature over the raw body with
// the `NOCODB_WEBHOOK_SECRET` env var. In production the env var MUST be
// set (otherwise every request is rejected with 500). In dev we warn and
// allow a deterministic insecure default so local flows still work.
export async function POST(req: NextRequest) {
  // ── HMAC verification (IF-2 · S-9) ────────────────────────────────────
  // The caller MUST send `x-nocodb-signature: <hex HMAC-SHA256(rawBody, secret)>`.
  // The comparison is timing-safe via `verifyHmacSha256`.
  const secret = resolveNocodbSecret()
  if (!secret) {
    // Production without NOCODB_WEBHOOK_SECRET — reject everything so
    // the operator notices the misconfiguration immediately.
    await db.auditLog.create({
      data: {
        action: 'webhook.nocodb_out.no_secret',
        entity: 'Webhook',
        metadata: 'NOCODB_WEBHOOK_SECRET missing in production',
      },
    }).catch(() => undefined /* never block the response on the audit log */)
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 },
    )
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-nocodb-signature')
  if (!signature || !verifyHmacSha256(rawBody, signature, secret)) {
    await db.auditLog.create({
      data: {
        action: 'webhook.nocodb_out.invalid_sig',
        entity: 'Webhook',
        metadata: rawBody.slice(0, 1000),
      },
    }).catch(() => undefined)
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let body: { event?: string; orderId?: string; newStatus?: string; tenantId?: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { event, orderId, newStatus, tenantId } = body
  if (!event || !orderId || !tenantId) {
    return NextResponse.json(
      { error: 'event, orderId and tenantId required' },
      { status: 400 },
    )
  }

  // Persist audit log
  await db.auditLog.create({
    data: {
      tenantId,
      action: `nocodb.out.${event}`,
      entity: 'Order',
      entityId: orderId,
      metadata: JSON.stringify({ newStatus }),
    },
  })

  const webhookUrl = process.env.NOCODB_WEBHOOK_URL
  if (!webhookUrl) {
    // NocoDB not configured — silent skip (the Kanban internal is the source of truth)
    return NextResponse.json({ ok: true, synced: false, reason: 'NOCODB_WEBHOOK_URL not set' })
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        orderId,
        newStatus,
        tenantId,
        timestamp: new Date().toISOString(),
      }),
    })
    return NextResponse.json({ ok: res.ok, synced: true, status: res.status })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ ok: false, synced: false, error: message }, { status: 502 })
  }
}
