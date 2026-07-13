import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { notificationService } from '@/lib/services'

// Customer Notifications — manual + auto-generated customer-facing messages.
//
// GET /api/notifications?tenantId=X&status=Y
//   CustomerNotification[] + stats
//
// POST /api/notifications { action, ...payload }
//   create | auto_generate | mark_sent | mark_delivered | cancel_pending
//
// SPRINT8-SERVICES-REST-001 — migrated every CustomerNotification + the
// GuideTracking lookup (used by `auto_generate`) to `notificationService`.
// Response shapes unchanged.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const status = req.nextUrl.searchParams.get('status') || undefined

  try {
    const { notifications, stats } = await notificationService.getNotifications(tenantId, status)
    return NextResponse.json({ notifications, stats })
  } catch (err) {
    captureError(err as Error, { path: '/api/notifications', method: 'GET', tenantId })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
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
      const notification = await notificationService.createNotification({
        tenantId,
        customerPhone,
        customerName: customerName ?? null,
        type,
        channel: channel || 'whatsapp',
        body: msgBody,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      })
      return NextResponse.json({ ok: true, notification })
    }

    if (action === 'auto_generate') {
      const created = await notificationService.autoGenerateShippingUpdates(tenantId)
      return NextResponse.json({ ok: true, generated: created.length, notifications: created })
    }

    if (action === 'mark_sent') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const updated = await notificationService.updateStatus(id, 'sent')
      return NextResponse.json({ ok: true, notification: updated })
    }

    if (action === 'mark_delivered') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const updated = await notificationService.updateStatus(id, 'delivered')
      return NextResponse.json({ ok: true, notification: updated })
    }

    // cancel_pending — bulk-cancel all pending notifications older than X
    // minutes (default 60). Useful when a queued batch becomes stale.
    const olderThanMinutes = Number(body?.olderThanMinutes ?? 60)
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000)
    const cancelled = await notificationService.cancelPendingBefore(tenantId, cutoff)
    return NextResponse.json({ ok: true, cancelled })
  } catch (e) {
    return NextResponse.json(
      { error: 'Operation failed', detail: (e as Error).message },
      { status: 500 },
    )
  }
}
