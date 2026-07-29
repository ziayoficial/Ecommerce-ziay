// POST /api/orders/[id]/refund
//
// AUDIT-FINTECH R-11 + R-12 — admin/operator-initiated refund endpoint.
//
// Background: prior to this audit, only ACP refunds existed (mandate-signed
// ed25519 bearer refunds in `src/lib/acp/bearer.ts`). A human operator could
// NOT refund an order from the UI — the only refund paths were the ACP
// bearer flow + the automatic retracto refund in `compliance/retracto.ts`.
// Refunds were also tracked as free-text in `OrderEvent.note` — no
// structured data (amount, reason, partial flag, gateway ref) for finance
// reconciliation or consumer-protection audits.
//
// This endpoint:
//   - Authenticates the caller via `requireRole(['admin', 'operator'])` +
//     `requireTenantAccess(order.tenantId)`.
//   - Validates the order exists, is `paid`, and the requested amount is
//     <= `order.total - sum(already_refunded)`.
//   - Creates a `Refund` row (status='pending') — the structured ledger
//     entry that replaces the free-text OrderEvent note.
//   - Calls `adapter.refund(order.paymentRef, amount)` against the order's
//     `paymentGateway`. The Stripe adapter already handles `cs_`/`pi_`/`ch_`
//     prefix resolution (R-7 fix from a previous sprint).
//   - On success: `Refund.status='processed'`, `gatewayRef`,
//     `processedAt=now`. Creates an `OrderEvent type='refunded'` with a
//     structured note. If the refund is full (covers the entire order
//     total), flips `order.paymentStatus='refunded'`.
//   - On failure: `Refund.status='failed'`, `failureNote`. Creates an
//     `OrderEvent type='refund_failed'`. Returns 502 with the error.
//   - Returns the Refund record.
//
// Body:
//   { amount?: number, reason: string, note?: string }
//   - amount omitted → full refund
//   - amount provided → partial refund (must be > 0 and <= remaining)
//   - reason: 'retracto' | 'customer_request' | 'fraud' | 'duplicate' |
//             'product_issue' | 'other'
//   - note: optional free-text appended to the OrderEvent note (NOT the
//     structured Refund row — the Refund row keeps `reason` as the
//     canonical classification).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, requireTenantAccess } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { getPaymentAdapter } from '@/lib/adapters/payment-registry'
import { getLogger } from '@/lib/logger'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/orders/[id]/refund')

const REFUND_REASONS = [
  'retracto',
  'customer_request',
  'fraud',
  'duplicate',
  'product_issue',
  'other',
] as const

const RefundSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.enum(REFUND_REASONS),
  note: z.string().max(500).optional(),
})

/**
 * POST /api/orders/[id]/refund
 *
 * Initiate a refund (full or partial) for a paid order. Creates a structured
 * `Refund` ledger row + calls the payment gateway's refund API.
 *
 * @security Requires authentication + admin/operator role + tenant access
 * @returns The created Refund record (with status pending/processed/failed)
 */
export const POST = withErrorHandling(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    // ── Auth: admin or operator — both can refund, but the action is
    // audited via `Refund.initiatedBy` so we know who did it. ──────────
    const { session, error: roleErr } = await requireRole(['admin', 'operator'])
    if (roleErr) return roleErr

    const { id: orderId } = await params

    // ── Parse + validate body ───────────────────────────────────────────
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = RefundSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const { amount: requestedAmount, reason, note } = parsed.data

    // ── Fetch the order (lightweight select — we only need refund-relevant
    // fields). Include existing refunds so we can compute the remaining
    // refundable amount. ────────────────────────────────────────────────
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        number: true,
        total: true,
        currency: true,
        paymentStatus: true,
        paymentGateway: true,
        paymentRef: true,
        refunds: {
          where: { status: { in: ['pending', 'processed'] } },
          select: { amount: true },
        },
      },
    })
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // ── Tenant guard — defense-in-depth on top of the role check ───────
    const { error: tenantErr } = await requireTenantAccess(order.tenantId)
    if (tenantErr) return tenantErr

    // ── Order must be in a refundable state ────────────────────────────
    // `paid` is the canonical state. We also accept `partial_refunded`
    // (a webhook from a gateway reporting a partial refund landed) so the
    // operator can issue an additional refund on top. We do NOT refund
    // `unpaid` / `pending_payment` / `rejected` / `cancelled` orders —
    // there's nothing to refund (no capture happened).
    if (!['paid', 'partial_refunded', 'refunded'].includes(order.paymentStatus)) {
      return NextResponse.json(
        {
          error: `Order is not in a refundable state (paymentStatus=${order.paymentStatus}). Only paid/partial_refunded orders can be refunded.`,
        },
        { status: 409 },
      )
    }
    if (order.paymentStatus === 'refunded') {
      return NextResponse.json(
        { error: 'Order is already fully refunded' },
        { status: 409 },
      )
    }

    // ── Validate the requested amount ──────────────────────────────────
    // Sum the already-refunded (pending + processed) amounts — pending
    // refunds reserve the budget so a concurrent operator can't double-spend.
    const alreadyRefunded = order.refunds.reduce((s, r) => s + r.amount, 0)
    const remaining = Math.max(order.total - alreadyRefunded, 0)

    const isPartial = typeof requestedAmount === 'number'
    const refundAmount = isPartial ? (requestedAmount as number) : order.total

    if (refundAmount <= 0) {
      return NextResponse.json(
        { error: 'Refund amount must be greater than 0' },
        { status: 400 },
      )
    }
    if (refundAmount > remaining) {
      return NextResponse.json(
        {
          error: `Refund amount ${refundAmount} exceeds refundable remaining ${remaining} (order total ${order.total} - already refunded ${alreadyRefunded})`,
        },
        { status: 400 },
      )
    }

    // ── Resolve the payment adapter ────────────────────────────────────
    // Without a `paymentGateway` + `paymentRef` we have nothing to refund
    // against. Local payment methods (pse/pix/oxxo/spei) return null from
    // `getPaymentAdapter` — they don't implement the refund contract, so
    // the operator must process those refunds manually offline.
    if (!order.paymentGateway || !order.paymentRef) {
      return NextResponse.json(
        {
          error:
            'Order has no paymentGateway/paymentRef — cannot refund via gateway. Process manually offline.',
        },
        { status: 409 },
      )
    }
    const adapter = getPaymentAdapter(order.paymentGateway)
    if (!adapter) {
      return NextResponse.json(
        {
          error: `Payment gateway '${order.paymentGateway}' does not support refunds via the adapter contract. Process manually.`,
        },
        { status: 409 },
      )
    }

    // ── Create the Refund row (status=pending) ─────────────────────────
    // Persisted BEFORE the gateway call so we have a record even if the
    // gateway call throws an unhandled exception. The row's `status`
    // transitions pending → processed | failed below.
    //
    // AUDIT-FINTECH N-6 — race condition with webhook `charge.refunded`.
    // Race window: an admin clicks "Refund" in the UI while simultaneously
    // a `charge.refunded` webhook for the same order arrives (e.g. the
    // refund was initiated directly in the Stripe dashboard by another
    // operator, or the gateway fires the webhook faster than our admin
    // endpoint's gateway.refund() returns). Without idempotency guards
    // the two paths could create duplicate Refund rows for the same
    // gateway refund ID.
    //
    // Mitigations (defense-in-depth):
    //   1. Pre-create check (this transaction): if a Refund already
    //      exists for this order with the same `amount` + `reason` AND
    //      status in ('pending', 'processed'), treat the request as a
    //      duplicate (e.g. user double-clicked) and return the existing
    //      row. SQLite doesn't support SELECT ... FOR UPDATE, so we use
    //      check-then-insert inside `db.$transaction` — Prisma's
    //      interactive transactions serialize writes per-row, closing
    //      the TOCTOU window for the common case. On Postgres prod the
    //      same code works but a `SELECT ... FOR UPDATE` on the Order
    //      row would harden it further (TODO — add a raw-SQL variant
    //      once we migrate off SQLite).
    //   2. Post-gateway check (after the gateway returns a `gatewayRef`):
    //      see below — if a Refund with that `gatewayRef` already exists
    //      (created by the webhook path), we cancel the admin's Refund
    //      and return the existing one rather than persisting a duplicate.
    //   3. Webhook side (payment-webhook-utils.ts sync block): the
    //      `charge.refunded` handler does `findFirst` by `gatewayRef`
    //      BEFORE flipping status, so a webhook arriving after the
    //      admin's Refund exists will adopt that row instead of
    //      creating a new one.
    const initiatedBy = session?.user?.id ?? 'unknown'

    // Pre-create idempotency check inside a transaction. If the check
    // passes, we immediately insert — both ops are inside the same
    // `db.$transaction` so a concurrent admin request that started its
    // own transaction will either see our inserted row (after we commit)
    // or block until we do (Prisma interactive transactions on SQLite
    // are serialized at the connection level).
    const refund = await db.$transaction(async (tx) => {
      const existing = await tx.refund.findFirst({
        where: {
          orderId: order.id,
          amount: refundAmount,
          reason,
          status: { in: ['pending', 'processed'] },
        },
        orderBy: { initiatedAt: 'desc' },
      })
      if (existing) {
        // Treat as idempotent retry — return the existing Refund so the
        // operator sees the same record. The `duplicate` flag in the
        // response lets the client distinguish a fresh refund from a
        // deduplicated one.
        return { __existing: true, row: existing }
      }
      const created = await tx.refund.create({
        data: {
          orderId: order.id,
          tenantId: order.tenantId,
          amount: refundAmount,
          currency: order.currency,
          reason,
          partial: isPartial,
          status: 'pending',
          gatewayName: adapter.name,
          initiatedBy,
        },
      })
      return { __existing: false, row: created }
    })

    // Idempotent path — a matching Refund already exists (concurrent
    // admin double-click OR a webhook that pre-created a Refund with
    // the same amount + reason). Return it without calling the gateway
    // a second time (which would either fail with "already refunded"
    // or create a duplicate gateway-side refund).
    if (refund.__existing) {
      log.info(
        { orderId, refundId: refund.row.id, amount: refundAmount, reason },
        'Refund request deduplicated — returning existing Refund row (race N-6 mitigation)',
      )
      return NextResponse.json({ ok: true, refund: refund.row, duplicate: true })
    }

    log.info(
      { orderId, refundId: refund.row.id, amount: refundAmount, reason, partial: isPartial, initiatedBy },
      'Refund initiated — calling gateway',
    )

    // ── Call the gateway ───────────────────────────────────────────────
    const refundResult = await adapter.refund(order.paymentRef, refundAmount)

    if (refundResult.success) {
      // ── Post-gateway idempotency check (N-6 mitigation #2) ──────────
      // If the webhook path created a Refund row with the gateway-returned
      // `gatewayRef` while we were calling the gateway, cancel our pending
      // Refund (we'd otherwise overwrite the webhook's row with status
      // 'processed' + a different `initiatedBy`). Return the existing row.
      const returnedGatewayRef = refundResult.paymentId ?? null
      if (returnedGatewayRef) {
        const webhookRefund = await db.refund.findFirst({
          where: {
            gatewayRef: returnedGatewayRef,
            id: { not: refund.row.id },
          },
        })
        if (webhookRefund) {
          await db.$transaction(async (tx) => {
            await tx.refund.update({
              where: { id: refund.row.id },
              data: {
                status: 'cancelled',
                failureNote: `Superseded by webhook-created Refund ${webhookRefund.id} (race N-6)`,
              },
            })
            // Make sure the webhook's Refund is in `processed` state —
            // it may have been left `pending` if the webhook fired
            // before the gateway returned the gatewayRef.
            if (webhookRefund.status === 'pending') {
              await tx.refund.update({
                where: { id: webhookRefund.id },
                data: { status: 'processed', processedAt: new Date() },
              })
            }
          })
          log.info(
            { orderId, adminRefundId: refund.row.id, webhookRefundId: webhookRefund.id, gatewayRef: returnedGatewayRef },
            'Admin refund superseded by webhook-created Refund (race N-6 mitigation #2)',
          )
          const updated = await db.refund.findUnique({ where: { id: webhookRefund.id } })
          return NextResponse.json({ ok: true, refund: updated, duplicate: true })
        }
      }

      // ── Success — flip Refund to processed + structured OrderEvent ──
      // If full refund (covers the remaining order.total), also flip the
      // order's paymentStatus to 'refunded'. Partial refunds leave the
      // order as 'paid' (the customer still owes nothing; the partial
      // refund is recorded in the Refund ledger + OrderEvent).
      const isFullRefund = !isPartial && refundAmount >= order.total

      await db.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: refund.row.id },
          data: {
            status: 'processed',
            gatewayRef: refundResult.paymentId ?? null,
            processedAt: new Date(),
          },
        })
        if (isFullRefund) {
          await tx.order.update({
            where: { id: orderId },
            data: { paymentStatus: 'refunded' },
          })
        }
        await tx.orderEvent.create({
          data: {
            orderId,
            type: 'refunded',
            note: JSON.stringify({
              refundId: refund.row.id,
              amount: refundAmount,
              currency: order.currency,
              reason,
              partial: isPartial,
              gateway: adapter.name,
              gatewayRef: refundResult.paymentId ?? null,
              initiatedBy,
              note: note ?? null,
            }),
          },
        })
      })

      log.info(
        { orderId, refundId: refund.row.id, gatewayRef: refundResult.paymentId, isFullRefund },
        'Refund processed via gateway',
      )

      const updated = await db.refund.findUnique({ where: { id: refund.row.id } })
      return NextResponse.json({ ok: true, refund: updated })
    }

    // ── Failure — flip Refund to failed + record the failure note ─────
    const failureNote = refundResult.message || 'Gateway refund returned non-success'
    await db.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.row.id },
        data: {
          status: 'failed',
          failureNote,
        },
      })
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'refund_failed',
          note: JSON.stringify({
            refundId: refund.row.id,
            amount: refundAmount,
            reason,
            gateway: adapter.name,
            initiatedBy,
            failureNote,
            note: note ?? null,
          }),
        },
      })
    })

    log.warn(
      { orderId, refundId: refund.row.id, failureNote },
      'Refund failed via gateway',
    )

    return NextResponse.json(
      {
        ok: false,
        error: failureNote,
        refund: await db.refund.findUnique({ where: { id: refund.row.id } }),
      },
      { status: 502 },
    )
  },
)
