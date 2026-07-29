// ───────────────────────────────────────────────────────────────────────────
// Derecho al retracto — Ley 1480 de 2011, Art 47 (Estatuto del Consumidor,
// Colombia).
//
// SPRINT-DIAN-RETRACTO-001 · P1-2 — closes the gap flagged by
// AUDIT-LEGAL-COMPLIANCE-001: the platform had ZERO retracto flow despite
// being mandatory for online purchases under Colombian consumer law.
//
// What Ley 1480 Art 47 requires:
//   - Consumer has 5 calendar days to retract from an online purchase
//     (ventas no presenciales — internet, teléfono, catálogo).
//   - During the window the consumer can request cancellation + full refund
//     with NO justification required.
//   - The merchant must process the refund within 30 days maximum.
//   - The merchant may deduct only the cost of returning the goods (if any).
//
// This module exposes the pure helpers (`calculateRetractoDeadline`,
// `isWithinRetractoWindow`) so the WhatsApp keyword handler + checkout
// creation can compute the window without DB round-trips, and the
// `processRetracto()` function which performs the actual cancellation +
// refund-deadline persistence in a single DB transaction.
// ───────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { getPaymentAdapter } from '@/lib/adapters/payment-registry'

const log = getLogger('compliance/retracto')

/** Ventana legal de retracto — 5 días calendario (Ley 1480 Art 47). */
const RETRACTO_WINDOW_DAYS = 5

/** Plazo máximo para procesar el reembolso — 30 días (Ley 1480 Art 47). */
const REFUND_PROCESSING_DAYS = 30

/**
 * Calculate the retracto deadline (createdAt + 5 calendar days).
 *
 * Pure function — exported so the checkout flow can stamp
 * `Order.retractoWindowUntil` at creation time without re-implementing the
 * constant, and the WhatsApp keyword handler can check the window without
 * loading the Order's `retractoWindowUntil` field.
 */
export function calculateRetractoDeadline(orderCreatedAt: Date): Date {
  const deadline = new Date(orderCreatedAt)
  deadline.setDate(deadline.getDate() + RETRACTO_WINDOW_DAYS)
  return deadline
}

/**
 * Returns `true` if the current time is within the 5-day retracto window.
 *
 * Pure function — uses `calculateRetractoDeadline` so the constant lives in
 * one place. Honors the consumer's local timezone implicitly via `Date.now()`
 * (the deadline is computed from `orderCreatedAt` which is UTC-stored).
 */
export function isWithinRetractoWindow(orderCreatedAt: Date): boolean {
  const deadline = calculateRetractoDeadline(orderCreatedAt)
  return new Date() <= deadline
}

export interface RetractoResult {
  accepted: boolean
  refundDeadline?: Date
  message: string
}

/**
 * Process a retracto request for an order.
 *
 * Steps:
 *   1. Validate the order exists + belongs to the tenant.
 *   2. Check the 5-day retracto window — reject if expired (Spanish msg).
 *   3. Reject if already cancelled.
 *   4. Set `status = 'cancelled'`, `cancelReason`, `cancelledAt`.
 *      (Steps 1-4 inside a single DB transaction for atomicity.)
 *   5. Create an `OrderEvent` (type `retracto_requested`) with the refund
 *      deadline in the note (auditable timeline).
 *   6. Create an `AuditLog` row tagged `compliance.retracto` for the
 *      compliance audit trail.
 *   7. SPRINT-LEGAL-FINAL-001 — best-effort automated refund via the
 *      payment gateway that processed the original payment (resolved by
 *      `order.paymentGateway`). Fire-and-forget: the order cancellation
 *      in step 4 is the source of truth; if the refund fails, an
 *      `OrderEvent` (`refund_failed` / `refund_error`) is persisted so
 *      ops/finance can process it manually before the 30-day deadline.
 *      Non-blocking — the retracto itself always succeeds if the window
 *      check passes.
 */
export async function processRetracto(
  orderId: string,
  tenantId: string,
  reason?: string,
): Promise<RetractoResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })

  if (!order) {
    return { accepted: false, message: 'Orden no encontrada' }
  }
  if (order.tenantId !== tenantId) {
    return { accepted: false, message: 'Tenant mismatch' }
  }

  // Check if within retracto window — use the stamped `retractoWindowUntil`
  // when present (set at order creation), fall back to `createdAt + 5d` for
  // legacy orders that pre-date this sprint.
  const deadline =
    order.retractoWindowUntil ?? calculateRetractoDeadline(order.createdAt)
  if (new Date() > deadline) {
    return {
      accepted: false,
      message: `El plazo de 5 días para retracto ha expirado (vencía el ${deadline.toLocaleDateString('es-CO')}).`,
    }
  }

  // Reject if already cancelled — idempotent guard.
  if (order.status === 'cancelled') {
    return { accepted: false, message: 'La orden ya fue cancelada' }
  }

  // Refund deadline — 30 calendar days from today (Ley 1480 Art 47).
  const refundDeadline = new Date()
  refundDeadline.setDate(refundDeadline.getDate() + REFUND_PROCESSING_DAYS)

  await db.$transaction(async (tx) => {
    // 1. Cancel the order + persist cancellation metadata.
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'cancelled',
        cancelReason: reason || 'Retracto (Ley 1480 Art 47)',
        cancelledAt: new Date(),
      },
    })

    // 2. OrderEvent — auditable timeline entry. OrderEvent has no tenantId
    //    in the schema (only orderId), so we don't pass it here.
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'retracto_requested',
        note: `Retracto solicitado por cliente. Motivo: ${reason || 'No especificado'}. Plazo de reembolso: ${refundDeadline.toLocaleDateString('es-CO')}`,
      },
    })

    // 3. AuditLog — compliance trail tagged `compliance.retracto`.
    await tx.auditLog.create({
      data: {
        tenantId,
        action: 'compliance.retracto',
        entityId: orderId,
        entity: 'order',
        metadata: JSON.stringify({ reason, refundDeadline }),
      },
    })
  })

  log.info(
    { orderId, tenantId, refundDeadline: refundDeadline.toISOString() },
    'Retracto processed (Ley 1480 Art 47)',
  )

  // ── SPRINT-LEGAL-FINAL-001 — automated refund post-retracto ──────────
  // Fire-and-forget: the order cancellation above (in the $transaction)
  // is the source of truth. The refund is best-effort automation — if it
  // fails, the audit log + OrderEvent below document the failure for
  // manual processing before the 30-day deadline (Ley 1480 Art 47).
  //
  // Only attempt the refund if the order was actually paid via a gateway
  // (skipped for COD / unpaid / already-refunded orders). The adapter is
  // resolved by `order.paymentGateway` (mercadopago | wompi | stripe |
  // payu). Local methods (pse / pix) return null from
  // `getPaymentAdapter` — they don't implement the refund contract, so
  // the refund is left for manual processing (logged below).
  if (
    order.paymentStatus === 'paid' &&
    order.paymentRef &&
    order.paymentGateway
  ) {
    try {
      const adapter = getPaymentAdapter(order.paymentGateway)
      if (adapter) {
        const refundResult = await adapter.refund(order.paymentRef, order.total)

        if (refundResult.success) {
          // Update order payment status to refunded.
          await db.order.update({
            where: { id: orderId },
            data: { paymentStatus: 'refunded' },
          })

          // OrderEvent — auditable timeline entry. OrderEvent has no
          // tenantId in the schema (only orderId), so we don't pass it
          // here (same as the retracto_requested event above). The
          // PaymentAdapter contract returns `paymentId` (the gateway's
          // refund reference), not `refundId` — see payment-adapter.ts.
          await db.orderEvent.create({
            data: {
              orderId,
              type: 'refund_processed',
              note: `Reembolso procesado automáticamente por retracto. Ref: ${refundResult.paymentId || 'N/A'}`,
            },
          })

          log.info(
            { orderId, refundRef: refundResult.paymentId },
            'Refund processed post-retracto',
          )
        } else {
          // Refund failed — log + create alert event for manual
          // processing before the 30-day deadline.
          await db.orderEvent.create({
            data: {
              orderId,
              type: 'refund_failed',
              note: `Reembolso falló: ${refundResult.message || 'unknown'}. Procesar manualmente antes del ${refundDeadline.toLocaleDateString('es-CO')}.`,
            },
          })

          log.warn(
            { orderId, error: refundResult.message },
            'Refund failed post-retracto',
          )
        }
      } else {
        // Gateway not supported by getPaymentAdapter (e.g. local methods
        // pse/pix). Log so ops can pick it up — non-blocking.
        await db.orderEvent.create({
          data: {
            orderId,
            type: 'refund_failed',
            note: `Gateway ${order.paymentGateway} no soporta reembolso automático. Procesar manualmente antes del ${refundDeadline.toLocaleDateString('es-CO')}.`,
          },
        })

        log.warn(
          { orderId, gateway: order.paymentGateway },
          'No refund adapter for gateway post-retracto (manual refund required)',
        )
      }
    } catch (error) {
      // Non-blocking — the order is already cancelled, refund can be
      // processed manually before the 30-day deadline.
      log.error(
        { err: error, orderId },
        'Refund exception post-retracto (non-blocking)',
      )

      await db.orderEvent
        .create({
          data: {
            orderId,
            type: 'refund_error',
            note: `Error al procesar reembolso: ${error instanceof Error ? error.message : 'unknown'}. Procesar manualmente antes del ${refundDeadline.toLocaleDateString('es-CO')}.`,
          },
        })
        .catch(() => {}) // best-effort — don't fail the retracto on event-log error
    }
  }

  return {
    accepted: true,
    refundDeadline,
    message: `Retracto aceptado. El reembolso se procesará antes del ${refundDeadline.toLocaleDateString('es-CO')} (Ley 1480 Art 47).`,
  }
}
