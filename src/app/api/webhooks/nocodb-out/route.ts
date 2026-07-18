import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/webhooks/nocodb-out
// Outbound webhook to NocoDB (Saramantha §10 — bidirectional sync).
// When an order moves columns in our Kanban, we POST the change to NocoDB
// so the operational team sees the update in their Kanban too.
// The NocoDB endpoint URL is configured via env NOCODB_WEBHOOK_URL.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { event, orderId, newStatus, tenantId } = body

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
