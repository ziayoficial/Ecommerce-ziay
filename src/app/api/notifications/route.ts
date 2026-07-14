import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { notificationService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const CreateNotificationSchema = z.object({
  action: z.literal('create'),
  tenantId: z.string().min(1),
  customerPhone: z.string().min(1),
  customerName: z.string().nullable().optional(),
  type: z.string().min(1),
  channel: z.string().optional(),
  body: z.string().min(1),
  scheduledAt: z.string().nullable().optional(),
})

const AutoGenerateSchema = z.object({
  action: z.literal('auto_generate'),
  tenantId: z.string().min(1),
})

const MarkSentSchema = z.object({
  action: z.literal('mark_sent'),
  tenantId: z.string().min(1),
  id: z.string().min(1),
})

const MarkDeliveredSchema = z.object({
  action: z.literal('mark_delivered'),
  tenantId: z.string().min(1),
  id: z.string().min(1),
})

const CancelPendingSchema = z.object({
  action: z.literal('cancel_pending'),
  tenantId: z.string().min(1),
  olderThanMinutes: z.union([z.number(), z.string()]).optional(),
})

const NotificationBodySchema = z.discriminatedUnion('action', [
  CreateNotificationSchema,
  AutoGenerateSchema,
  MarkSentSchema,
  MarkDeliveredSchema,
  CancelPendingSchema,
])

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
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const status = req.nextUrl.searchParams.get('status') || undefined

  const { notifications, stats } = await notificationService.getNotifications(tenantId, status)
  return NextResponse.json({ notifications, stats })


})

export const POST = withErrorHandling(async (req: NextRequest) => {

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = NotificationBodySchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const action = body.action
  const tenantId = body.tenantId

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  if (action === 'create') {
    const { customerPhone, customerName, type, channel, body: msgBody, scheduledAt } = body
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
    const updated = await notificationService.updateStatus(body.id, 'sent')
    return NextResponse.json({ ok: true, notification: updated })
  }

  if (action === 'mark_delivered') {
    const updated = await notificationService.updateStatus(body.id, 'delivered')
    return NextResponse.json({ ok: true, notification: updated })
  }

  // cancel_pending — bulk-cancel all pending notifications older than X
  // minutes (default 60). Useful when a queued batch becomes stale.
  const olderThanMinutes = Number(body.olderThanMinutes ?? 60)
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000)
  const cancelled = await notificationService.cancelPendingBefore(tenantId, cutoff)
  return NextResponse.json({ ok: true, cancelled })


})
