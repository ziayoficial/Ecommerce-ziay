import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/webhooks/nocodb-in
// Inbound webhook FROM NocoDB (Saramantha §10 — bidirectional sync).
// When the operational team moves a card in NocoDB's Kanban, NocoDB calls
// this endpoint so we update the Order.status in our DB too.
// Security: requires X-Nocodb-Token header matching NOCODB_WEBHOOK_SECRET env.
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-nocodb-token')
  const expected = process.env.NOCODB_WEBHOOK_SECRET || 'commerceflow_nocodb'
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
