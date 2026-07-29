import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { resolveNocodbSecret } from '@/lib/middleware/webhook-secrets'
import { timingSafeEqual } from 'node:crypto'

// POST /api/webhooks/nocodb-in
// Inbound webhook FROM NocoDB (Saramantha §10 — bidirectional sync).
// When the operational team moves a card in NocoDB's Kanban, NocoDB calls
// this endpoint so we update the Order.status in our DB too.
// Security: requires X-Nocodb-Token header matching NOCODB_WEBHOOK_SECRET env.
//
// SECURITY · IF-2 · S-11 — removed the hardcoded `'commerceflow_nocodb'`
// fallback. In production, if `NOCODB_WEBHOOK_SECRET` is missing, every
// request is rejected with 500 (so the operator notices the misconfig
// immediately). In dev we warn + use a deterministic insecure default.
//
// AUDIT-FIX F-01: token comparison changed from !== to timingSafeEqual
// to prevent timing attacks on the webhook secret.
// AUDIT-FIX F-05: added idempotency dedup (webhookId from body + signature).

const NocodbInSchema = z.object({
  orderId: z.string().min(1),
  newStatus: z.string().min(1).max(50),
  tenantId: z.string().optional(),
  webhookId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-nocodb-token')
  const expected = resolveNocodbSecret()
  if (!expected) {
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 },
    )
  }

  // AUDIT-FIX F-01: timing-safe comparison instead of !==
  const tokenBuf = Buffer.from(token || '')
  const expectedBuf = Buffer.from(expected)
  if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  const rawBody = await req.text()
  const parsed = NocodbInSchema.safeParse(JSON.parse(rawBody))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const { orderId, newStatus, tenantId, webhookId } = parsed.data

  // AUDIT-FIX F-05: idempotency dedup (matching pattern from other webhooks)
  const dedupKey = `nocodb-in:${webhookId || `${orderId}:${newStatus}:${rawBody.length}`}`
  const existing = await db.auditLog.findFirst({
    where: { entityId: dedupKey, action: 'webhook.nocodb-in.dedup' },
    select: { id: true },
  }).catch(() => null)
  if (existing) {
    return NextResponse.json({ ok: true, status: 'duplicate' })
  }

  const order = await db.order.findUnique({ where: { id: orderId }})
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  await db.order.update({
    where: { id: orderId },
    data: { status: newStatus },
  })
  await db.orderEvent.create({
    data: { orderId, type: newStatus, note: 'via NocoDB webhook' },
  })
  await db.auditLog.create({
    data: {
      tenantId: tenantId || order.tenantId,
      action: 'nocodb.in.order_moved',
      entity: 'Order',
      entityId: orderId,
      metadata: JSON.stringify({ newStatus }),
    },
  })

  // AUDIT-FIX F-05: persist dedup marker
  await db.auditLog.create({
    data: {
      tenantId: tenantId || order.tenantId,
      action: 'webhook.nocodb-in.dedup',
      entity: 'Webhook',
      entityId: dedupKey,
      metadata: JSON.stringify({ orderId, newStatus }),
    },
  }).catch(() => {})

  return NextResponse.json({ ok: true, orderId, newStatus })
}
