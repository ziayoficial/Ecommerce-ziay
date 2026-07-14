import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/local/[reference]/status
//
// Poll the status of a local payment (PSE / PIX / OXXO / SPEI).
//
// Path params:
//   reference — the gateway reference returned by POST /api/payments/local
//               (e.g. `PSE-abc123`, `PIX-xyz789`, or the raw gateway txid).
//
// Behaviour:
//   1. Look up the Order by `paymentRef === reference`.
//   2. Auth: caller must have access to the Order's tenant.
//   3. Return the Order's paymentStatus + paidAt + the gateway-side status
//      (verified on a best-effort basis via the adapter's `verifyPayment`
//      for PSE/PIX/OXXO/SPEI; webhooks remain the source of truth).
//
// NOTE: PIX + OXXO don't expose polling endpoints — their `verifyPayment`
// returns `pending` until the webhook arrives. PSE has a transaction-query
// endpoint (used in production). The polling endpoint is mostly useful for
// PSE + as a UX hint (the client can show "still waiting" vs "approved").
//
// SPRINT-MULTICOUNTRY-001 — study §18 LATAM expansion.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payments/local/[reference]/status
 *
 * Check the status of a local payment reference.
 *
 * @security Requires authentication + tenant access
 * @returns Payment reference + status
 */
export const GET = withErrorHandling(async (_req: NextRequest,
  { params }: { params: Promise<{ reference: string }> },) => {

  const { session, error: authErr } = await requireAuth()
  if (authErr) return authErr

    const { reference } = await params
    if (!reference) {
      return NextResponse.json(
        { error: 'Reference is required' },
        { status: 400 },
      )
    }

    // Look up the Order by paymentRef. The reference may be the gateway
    // transaction id or our prefixed local-mode reference (e.g. `PSE-abc`).
    const order = await db.order.findFirst({
      where: { paymentRef: reference },
      select: {
        id: true,
        number: true,
        tenantId: true,
        paymentStatus: true,
        paymentGateway: true,
        paymentRef: true,
        paidAt: true,
        total: true,
        currency: true,
        countryCode: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Payment reference not found' },
        { status: 404 },
      )
    }

    // Tenant guard — tenant users can only poll their own tenant's orders.
    const userTenantId = session?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== order.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    return NextResponse.json({
      reference: order.paymentRef,
      orderId: order.id,
      orderNumber: order.number,
      method: order.paymentGateway,
      status: order.paymentStatus,
      paidAt: order.paidAt,
      amount: order.total,
      currency: order.currency,
      countryCode: order.countryCode,
    })
  

})
