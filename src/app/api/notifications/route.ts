import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'

// Customer Notifications — manual + auto-generated customer-facing messages.
//
// GET /api/notifications?tenantId=X&status=Y
//   CustomerNotification[] + stats
//
// POST /api/notifications { action, ...payload }
//   create | auto_generate | mark_sent | mark_delivered | cancel_pending
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const status = req.nextUrl.searchParams.get('status') || undefined
  const where: { tenantId: string; status?: string } = { tenantId }
  if (status) where.status = status

  const [notifications, all] = await Promise.all([
    db.customerNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.customerNotification.findMany({ where: { tenantId } }),
  ])

  const stats = {
    total: all.length,
    pending: all.filter((n) => n.status === 'pending').length,
    sent: all.filter((n) => n.status === 'sent').length,
    delivered: all.filter((n) => n.status === 'delivered').length,
    failed: all.filter((n) => n.status === 'failed').length,
  }

  return NextResponse.json({ notifications, stats })
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body?.action as string | undefined
  const validActions = ['create', 'auto_generate', 'mark_sent', 'mark_delivered', 'cancel_pending']
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const tenantId = body?.tenantId as string | undefined
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    if (action === 'create') {
      const { customerPhone, customerName, type, channel, body: msgBody, scheduledAt } = body
      if (!customerPhone || !type || !msgBody) {
        return NextResponse.json(
          { error: 'customerPhone, type, body are required' },
          { status: 400 },
        )
      }
      const notification = await db.customerNotification.create({
        data: {
          tenantId,
          customerPhone,
          customerName: customerName ?? null,
          type,
          channel: channel || 'whatsapp',
          body: msgBody,
          status: 'pending',
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        },
      })
      return NextResponse.json({ ok: true, notification })
    }

    if (action === 'auto_generate') {
      // Auto-generate shipping-update notifications for orders that were just
      // marked as despachado but don't yet have a notification. We look at
      // GuideTracking rows that are in_transit and create one notification
      // per guide that lacks one.
      const guides = await db.guideTracking.findMany({
        where: { tenantId, status: 'in_transit' },
        take: 50,
      })
      const created: any[] = []
      for (const g of guides) {
        const exists = await db.customerNotification.findFirst({
          where: {
            tenantId,
            type: 'shipping_update',
            metadata: { contains: g.guideNumber },
          },
          select: { id: true },
        })
        if (exists) continue
        const n = await db.customerNotification.create({
          data: {
            tenantId,
            customerPhone: g.carrierName || 'unknown',
            customerName: null,
            type: 'shipping_update',
            channel: 'whatsapp',
            body: `Tu pedido con guía ${g.guideNumber} está en camino.`,
            status: 'pending',
            metadata: JSON.stringify({ guideNumber: g.guideNumber }),
          },
        })
        created.push(n)
      }
      return NextResponse.json({ ok: true, generated: created.length, notifications: created })
    }

    if (action === 'mark_sent') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const updated = await db.customerNotification.update({
        where: { id },
        data: { status: 'sent', sentAt: new Date() },
      })
      return NextResponse.json({ ok: true, notification: updated })
    }

    if (action === 'mark_delivered') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const updated = await db.customerNotification.update({
        where: { id },
        data: { status: 'delivered' },
      })
      return NextResponse.json({ ok: true, notification: updated })
    }

    // cancel_pending — bulk-cancel all pending notifications older than X
    // minutes (default 60). Useful when a queued batch becomes stale.
    const olderThanMinutes = Number(body?.olderThanMinutes ?? 60)
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000)
    const result = await db.customerNotification.updateMany({
      where: {
        tenantId,
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      data: { status: 'failed' },
    })
    return NextResponse.json({ ok: true, cancelled: result.count })
  } catch (e) {
    return NextResponse.json(
      { error: 'Operation failed', detail: (e as Error).message },
      { status: 500 },
    )
  }
}
