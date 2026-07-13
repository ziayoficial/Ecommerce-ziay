import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'

// Update order status / payment status.
//
// If `body.event` is provided, the order update + OrderEvent insert are
// wrapped in a single $transaction so the audit trail never diverges from
// the order state (e.g. an event recorded for a status that never landed).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const { id } = await params
    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.status) data.status = body.status
    if (body.paymentStatus) data.paymentStatus = body.paymentStatus
    if (body.paidAt) data.paidAt = new Date(body.paidAt)
    if (body.paymentGateway) data.paymentGateway = body.paymentGateway
    if (body.paymentRef) data.paymentRef = body.paymentRef

    if (body.event) {
      // Two writes that must be atomic: order update + event insert.
      const [updated] = await db.$transaction([
        db.order.update({ where: { id }, data }),
        db.orderEvent.create({ data: { orderId: id, type: body.event, note: body.note } }),
      ])
      return NextResponse.json({ order: updated })
    }

    const updated = await db.order.update({ where: { id }, data })
    return NextResponse.json({ order: updated })
  } catch (err) {
    captureError(err as Error, { path: '/api/orders/[id]', method: 'PATCH' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
