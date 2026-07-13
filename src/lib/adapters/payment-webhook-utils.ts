// ZIAY — Payment webhook shared helpers
// Saramantha §10 — lógica común a los 4 webhooks de pago (MP, Wompi, Stripe,
// PayU): lookup de Order por paymentRef, update de paymentStatus y creación
// de OrderEvent. Mantiene los 4 route handlers DRY.

import { db } from '@/lib/db'

/**
 * Best-effort audit log write. Webhooks must ALWAYS ACK with 200 to stop
 * gateway retries, even when the local DB is read-only or unreachable.
 * Errors are logged to stderr and swallowed.
 */
export async function safeAudit(
  action: string,
  entity: string,
  meta: string,
): Promise<void> {
  try {
    await db.auditLog.create({ data: { action, entity, meta } })
  } catch (err) {
    console.error(`[auditLog:${action}]`, err instanceof Error ? err.message : err)
  }
}

/**
 * Estados de pago canónicos del gateway → `Order.paymentStatus` interno.
 * Los valores no listados se guardan tal cual (en minúsculas) para auditoría.
 */
export function normalizePaymentStatus(gatewayStatus: string): string {
  const s = gatewayStatus.toLowerCase()
  if (
    s === 'approved' ||
    s === 'paid' ||
    s === 'succeeded' ||
    s === 'completed' ||
    s === 'captured'
  ) {
    return 'paid'
  }
  if (s === 'rejected' || s === 'declined' || s === 'failed' || s === 'cancelled') {
    return 'rejected'
  }
  if (s === 'refunded' || s === 'partial_refunded') return 'refunded'
  if (s === 'pending' || s === 'in_process' || s === 'in_progress' || s === 'open' || s === 'authorized') {
    return 'pending_payment'
  }
  return s || 'unknown'
}

export interface OrderUpdateResult {
  found: boolean
  orderId?: string
  newStatus: string
}

/**
 * Busca una Order por `paymentRef` o `number` (la referencia interna que el
 * gateway envía de vuelta) y actualiza `paymentStatus`, `paidAt` y `paymentRef`.
 * Crea siempre un `OrderEvent` con el estado crudo del gateway para auditoría.
 *
 * Best-effort: si la DB no está disponible (read-only sandbox), la función
 * registra el error y retorna `{ found: false }` para que el webhook siga
 * ACKeando con 200.
 */
export async function applyPaymentUpdate(opts: {
  gateway: string
  paymentId: string
  externalReference?: string
  status: string
  success: boolean
}): Promise<OrderUpdateResult> {
  const { gateway, paymentId, externalReference, status, success } = opts
  const newStatus = normalizePaymentStatus(status)

  try {
    // Lookup por paymentRef o por number (la referencia interna del comercio).
    const order = await db.order.findFirst({
      where: {
        OR: [
          { paymentRef: paymentId },
          ...(externalReference ? [{ paymentRef: externalReference }, { number: externalReference }] : []),
        ],
      },
    })

    if (!order) {
      return { found: false, newStatus }
    }

    const shouldMarkPaid = success || newStatus === 'paid'
    const wasAlreadyPaid = order.paymentStatus === 'paid'

    await db.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: shouldMarkPaid ? 'paid' : newStatus,
        paidAt: shouldMarkPaid && !wasAlreadyPaid ? new Date() : order.paidAt,
        paymentRef: paymentId,
        paymentGateway: gateway,
      },
    })

    const eventType =
      newStatus === 'paid' ? 'paid' : newStatus === 'refunded' ? 'refunded' : 'payment_update'

    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: eventType,
        note: `${gateway} webhook: status=${status} paymentId=${paymentId}`,
      },
    })

    return { found: true, orderId: order.id, newStatus }
  } catch (err) {
    console.error(
      `[applyPaymentUpdate:${gateway}]`,
      err instanceof Error ? err.message : err,
    )
    return { found: false, newStatus }
  }
}

