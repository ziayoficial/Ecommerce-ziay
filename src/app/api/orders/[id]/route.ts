import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { orderService } from '@/lib/services'
import { captureError } from '@/lib/capture-error'

// Update order status / payment status.
//
// If `body.event` is provided, the order update + OrderEvent insert are
// wrapped in a single $transaction so the audit trail never diverges from
// the order state (e.g. an event recorded for a status that never landed).
//
// SPRINT7-POSTGRES-SERVICES-001 — migrated from inline `db.$transaction` /
// `db.order.update` to `orderService.updateOrder(...)`. The service wraps
// the same atomic transaction internally; response shape is unchanged.
//
// FIX-SECURITY-AUTH-001 (#8) — fetch the order first, verify the caller's
// tenantId matches (or caller is a platform admin with no tenantId) before
// update. `orderService.updateOrder` does NOT inject tenantId into the
// where clause (per the service's own comment), so the route must enforce
// the tenant guard. Mirrors `/api/novedades/[id]` `getCaseOrFail()`.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error: authErr } = await requireAuth()
  if (authErr) return authErr
  try {
    const { id } = await params

    // Fetch the order's tenantId first (lightweight select) and verify.
    const existing = await orderService.getOrderById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    const userTenantId = session?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== existing.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.status) data.status = body.status
    if (body.paymentStatus) data.paymentStatus = body.paymentStatus
    if (body.paidAt) data.paidAt = new Date(body.paidAt)
    if (body.paymentGateway) data.paymentGateway = body.paymentGateway
    if (body.paymentRef) data.paymentRef = body.paymentRef

    const updated = await orderService.updateOrder(id, data, body.event
      ? { type: body.event, note: body.note }
      : undefined)
    return NextResponse.json({ order: updated })
  } catch (err) {
    captureError(err as Error, { path: '/api/orders/[id]', method: 'PATCH' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
