// GET /api/orders/[id]/refunds
//
// AUDIT-FINTECH R-12 — list refunds for an order (structured ledger view).
//
// Replaces the previous "grep OrderEvent.note for 'refunded'" pattern that
// finance reconciliation had to use to find refunds. Now the operator UI
// can render a structured refund history per order with the canonical
// amount / reason / status / gateway ref / initiator / timestamps.
//
// Auth: `requireRole(['admin', 'operator', 'finance'])` + tenant access.
// `finance` is included because the finance team needs to reconcile refunds
// without being able to initiate them (separation of duties — only
// admin/operator can POST to /refund, but finance can read the ledger).
//
// Returns:
//   { refunds: Refund[], total: number, refundedAmount: number, remaining: number }
//   - `refundedAmount` = sum of amounts with status='processed'
//   - `remaining` = order.total - refundedAmount (>= 0)

import { NextRequest, NextResponse } from 'next/server'
import { requireRole, requireTenantAccess } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

/**
 * GET /api/orders/[id]/refunds
 *
 * List all refunds (pending/processed/failed/cancelled) for an order.
 *
 * @security Requires authentication + admin/operator/finance role + tenant access
 * @returns Refunds + summary totals (refundedAmount, remaining)
 */
export const GET = withErrorHandling(
  async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    // ── Auth: admin/operator/finance — finance can read but not initiate ──
    const { error: roleErr } = await requireRole(['admin', 'operator', 'finance'])
    if (roleErr) return roleErr

    const { id: orderId } = await params

    // ── Fetch the order + its refunds ──────────────────────────────────
    // Lightweight select on Order (just need total + currency + tenantId
    // for the summary). Refunds are ordered by initiatedAt DESC so the
    // most recent action shows first in the UI.
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        total: true,
        currency: true,
        refunds: {
          orderBy: { initiatedAt: 'desc' },
        },
      },
    })
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // ── Tenant guard ───────────────────────────────────────────────────
    const { error: tenantErr } = await requireTenantAccess(order.tenantId)
    if (tenantErr) return tenantErr

    // ── Summary totals — only `processed` refunds count toward the
    // refundedAmount (pending may still fail; failed/cancelled didn't
    // move money). `remaining` is the budget for future refunds. ──────
    const refundedAmount = order.refunds
      .filter((r) => r.status === 'processed')
      .reduce((s, r) => s + r.amount, 0)
    const remaining = Math.max(order.total - refundedAmount, 0)

    return NextResponse.json({
      refunds: order.refunds,
      total: order.total,
      currency: order.currency,
      refundedAmount,
      remaining,
    })
  },
)
