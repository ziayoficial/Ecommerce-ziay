import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveNocodbSecret } from '@/lib/middleware/webhook-secrets'

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
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-nocodb-token')
  const expected = resolveNocodbSecret()
  if (!expected) {
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 },
    )
  }
  if (token !== expected) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  const body = await req.json()
  const { orderId, newStatus, tenantId } = body

  if (!orderId || !newStatus) {
    return NextResponse.json({ error: 'orderId and newStatus required' }, { status: 400 })
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

  return NextResponse.json({ ok: true, orderId, newStatus })
}
