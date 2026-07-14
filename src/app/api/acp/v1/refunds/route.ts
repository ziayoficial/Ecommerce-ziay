import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { getPaymentAdapter } from '@/lib/adapters/payment-registry'
import { verifyAcpBearer } from '@/lib/acp/bearer'

const log = getLogger('api/acp/v1/refunds')

// POST /api/acp/v1/refunds
// ACP refund initiation — Documento §9.1: capability `refunds`.
//
// Auth: Bearer = `{mandateId}.{ed25519(mandateId)}` firmado por el tenant.
// V4 (AUDIT-FINAL-SEC-001): el bearer ya NO es el mandate ID en crudo —
// verifyAcpBearer valida la firma ed25519 + estado active + vigencia.
//
// Body:
//   { order_id, reason, amount? }
//     - order_id: ID interno del pedido
//     - reason: motivo legible del reembolso
//     - amount?: si se omite → reembolso TOTAL; si se incluye → parcial
//
// Returns:
//   { refund_id, status, amount, currency }

const RefundSchema = z.object({
  order_id: z.string().min(1),
  reason: z.string().min(1).max(500),
  amount: z.number().positive().optional(),
})

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  return m ? m[1].trim() : null
}

export async function POST(req: NextRequest) {
  const token = extractBearerToken(req)
  if (!token) {
    return NextResponse.json(
      { error: 'Authorization Bearer requerido', code: 'missing_auth_token' },
      { status: 401 },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }

  const parsed = RefundSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  try {
    // Validar el bearer firmado + cargar el mandate.
    const bearer = await verifyAcpBearer(token)
    if (!bearer) {
      return NextResponse.json(
        {
          error: 'Token de autorización inválido o expirado',
          code: 'invalid_auth_token',
        },
        { status: 401 },
      )
    }
    const mandate = await db.aP2Mandate.findUnique({
      where: { id: bearer.mandateId },
    })
    if (!mandate || mandate.status !== 'active') {
      return NextResponse.json(
        {
          error: 'Token de autorización inválido o expirado',
          code: 'invalid_auth_token',
        },
        { status: 401 },
      )
    }
    if (mandate.expiresAt && mandate.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'El mandato de intención ha expirado', code: 'mandate_expired' },
        { status: 401 },
      )
    }

    const order = await db.order.findUnique({
      where: { id: body.order_id },
    })
    if (!order) {
      return NextResponse.json(
        { error: 'Pedido no encontrado', code: 'order_not_found' },
        { status: 404 },
      )
    }
    if (order.tenantId !== mandate.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch', code: 'tenant_mismatch' },
        { status: 403 },
      )
    }
    if (order.paymentStatus !== 'paid') {
      return NextResponse.json(
        {
          error: `No se puede reembolsar un pedido con estado de pago "${order.paymentStatus}"`,
          code: 'order_not_paid',
        },
        { status: 422 },
      )
    }
    if (!order.paymentGateway || !order.paymentRef) {
      return NextResponse.json(
        {
          error: 'El pedido no tiene referencia de pasarela de pago registrada',
          code: 'missing_payment_ref',
        },
        { status: 422 },
      )
    }

    // Resolver el adaptador de pago concreto (MercadoPago / Wompi / Stripe / PayU).
    const adapter = getPaymentAdapter(order.paymentGateway)
    if (!adapter) {
      return NextResponse.json(
        {
          error: `Pasarela de pago no soportada: ${order.paymentGateway}`,
          code: 'unsupported_gateway',
        },
        { status: 422 },
      )
    }

    // amount <= order.total (no se puede reembolsar más de lo cobrado).
    const refundAmount = body.amount ?? order.total
    if (refundAmount > order.total) {
      return NextResponse.json(
        {
          error: `El monto a reembolsar (${refundAmount}) excede el total del pedido (${order.total})`,
          code: 'amount_exceeds_total',
        },
        { status: 422 },
      )
    }

    // Llamar al adaptador de pago.
    const result = await adapter.refund(order.paymentRef, body.amount)

    if (!result.success) {
      log.warn(
        {
          orderId: order.id,
          gateway: order.paymentGateway,
          paymentRef: order.paymentRef,
          status: result.status,
          message: result.message,
        },
        'ACP refund falló en la pasarela',
      )
      return NextResponse.json(
        {
          error: result.message || 'El reembolso fue rechazado por la pasarela',
          code: 'gateway_rejected',
          gateway_status: result.status,
        },
        { status: 502 },
      )
    }

    // Persistir el reembolso: marcar el pedido como `returned` + paymentStatus
    // `refunded` + crear un OrderEvent.
    await db.order.update({
      where: { id: order.id },
      data: {
        status: 'returned',
        paymentStatus: 'refunded',
      },
    })
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'refunded',
        note: `ACP refund — reason: ${body.reason}${body.amount ? ` — partial: ${body.amount} ${order.currency}` : ' — full'}`,
      },
    })

    // Auditoría firmable (Verifiable Intent — sprint SPRINT-PROTOCOLS-TRINITY-001 §11).
    await db.auditLog.create({
      data: {
        tenantId: order.tenantId,
        userId: mandate.userId,
        action: 'acp.refund.initiated',
        entity: 'Order',
        entityId: order.id,
        meta: JSON.stringify({
          gateway: order.paymentGateway,
          paymentRef: order.paymentRef,
          amount: refundAmount,
          currency: order.currency,
          reason: body.reason,
          partial: body.amount !== undefined,
          agentDid: 'acp',
          intentMandateId: mandate.id,
          gatewayRefundId: result.paymentId ?? null,
        }),
      },
    })

    log.info(
      {
        orderId: order.id,
        gateway: order.paymentGateway,
        amount: refundAmount,
        partial: body.amount !== undefined,
      },
      'ACP refund procesado',
    )

    return NextResponse.json(
      {
        refund_id: result.paymentId ?? `refund-${order.id}`,
        status: 'refunded',
        amount: refundAmount,
        currency: order.currency,
        order_id: order.id,
        partial: body.amount !== undefined,
      },
      { status: 201 },
    )
  } catch (err) {
    captureError(err as Error, {
      path: '/api/acp/v1/refunds',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo procesar el reembolso' },
      { status: 500 },
    )
  }
}
