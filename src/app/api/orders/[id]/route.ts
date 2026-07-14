import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { orderService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// TD-2: Zod schema for order PATCH. All fields optional (only those present
// are applied). `.passthrough()` so unknown keys (e.g. future `note` variants)
// don't 400.
const OrderPatchSchema = z.object({
  status: z.string().optional(),
  paymentStatus: z.string().optional(),
  paidAt: z.string().optional(),
  paymentGateway: z.string().optional(),
  paymentRef: z.string().optional(),
  event: z.string().optional(),
  note: z.string().optional(),
}).passthrough()

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
//
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapped with `withErrorHandling`. The
// 2nd `ctx` arg is forwarded so dynamic routes can destructure `params`.
export const PATCH = withErrorHandling(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { session, error: authErr } = await requireAuth()
    if (authErr) return authErr

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

    const raw = await req.json()
    const parseResult = OrderPatchSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const body = parseResult.data as Record<string, unknown>
    const data: Record<string, unknown> = {}
    if (body.status) data.status = body.status
    if (body.paymentStatus) data.paymentStatus = body.paymentStatus
    if (body.paidAt) data.paidAt = new Date(body.paidAt as string)
    if (body.paymentGateway) data.paymentGateway = body.paymentGateway
    if (body.paymentRef) data.paymentRef = body.paymentRef

    const updated = await orderService.updateOrder(id, data, body.event
      ? { type: body.event as string, note: body.note as string | undefined }
      : undefined)
    return NextResponse.json({ order: updated })
  },
)
