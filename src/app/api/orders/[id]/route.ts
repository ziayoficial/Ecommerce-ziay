import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

// Update order status / payment status
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth()
  if (error) return error
  const { id } = await params
  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.status) data.status = body.status
  if (body.paymentStatus) data.paymentStatus = body.paymentStatus
  if (body.paidAt) data.paidAt = new Date(body.paidAt)
  if (body.paymentGateway) data.paymentGateway = body.paymentGateway
  if (body.paymentRef) data.paymentRef = body.paymentRef

  const updated = await db.order.update({ where: { id }, data })
  if (body.event) {
    await db.orderEvent.create({ data: { orderId: id, type: body.event, note: body.note } })
  }
  return NextResponse.json({ order: updated })
}
