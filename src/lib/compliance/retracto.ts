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
 * Steps (all inside a single DB transaction for atomicity):
 *   1. Validate the order exists + belongs to the tenant.
 *   2. Check the 5-day retracto window — reject if expired (Spanish msg).
 *   3. Reject if already cancelled.
 *   4. Set `status = 'cancelled'`, `cancelReason`, `cancelledAt`.
 *   5. Create an `OrderEvent` (type `retracto_requested`) with the refund
 *      deadline in the note (auditable timeline).
 *   6. Create an `AuditLog` row tagged `compliance.retracto` for the
 *      compliance audit trail.
 *
 * The actual payment-gateway refund (`paymentAdapter.refund(...)`) is NOT
 * triggered here — it's a follow-up task that depends on which gateway
 * processed the original payment (Wompi/Stripe/MercadoPago/PayU/PSE/PIX).
 * The refund deadline is computed + persisted so ops/finance can track SLA.
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
        meta: JSON.stringify({ reason, refundDeadline }),
      },
    })
  })

  log.info(
    { orderId, tenantId, refundDeadline: refundDeadline.toISOString() },
    'Retracto processed (Ley 1480 Art 47)',
  )

  // TODO: Initiate refund via payment gateway (if payment was processed).
  // This would call paymentAdapter.refund(order.paymentRef, order.total) —
  // the adapter is selected by `order.paymentGateway` (wompi | stripe |
  // mercadopago | payu | pse | pix). Tracked as a follow-up — the refund
  // deadline is already persisted so ops/finance can track SLA manually
  // until the automated refund is wired.

  return {
    accepted: true,
    refundDeadline,
    message: `Retracto aceptado. El reembolso se procesará antes del ${refundDeadline.toLocaleDateString('es-CO')} (Ley 1480 Art 47).`,
  }
}
