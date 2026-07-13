import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getPaymentAdapter } from '@/lib/adapters/payment-registry'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getLogger } from '@/lib/logger'

const log = getLogger('api/payments/create-link')

// POST /api/payments/create-link
// Crea un link de pago en el gateway indicado y actualiza el Order con
// paymentGateway + paymentRef.
//
// Body:
//   { tenantId, orderId, gateway, amount, currency, description }
//
// Auth: requireTenantAccess(tenantId)
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 30,
    windowMs: 60_000,
    namespace: 'api:payments:create-link',
  })
  if (limited) return limited

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tenantId, orderId, gateway, amount, currency, description } = body ?? {}
  if (!tenantId || !orderId || !gateway || amount == null || !currency) {
    return NextResponse.json(
      {
        error:
          'tenantId, orderId, gateway, amount, currency are required',
      },
      { status: 400 },
    )
  }

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (order.tenantId !== tenantId) {
    return NextResponse.json(
      { error: 'Order does not belong to this tenant' },
      { status: 403 },
    )
  }

  const adapter = getPaymentAdapter(String(gateway))
  if (!adapter) {
    return NextResponse.json(
      { error: `Unsupported payment gateway: ${gateway}` },
      { status: 400 },
    )
  }

  try {
    const result = await adapter.createPaymentLink({
      amount: Number(amount),
      currency: String(currency),
      description: String(description ?? `Orden ${order.number}`),
      reference: order.number,
    })

    if (result.success && (result.paymentId || result.url)) {
      // Persist the gateway + ref on the order
      const updated = await db.order.update({
        where: { id: order.id },
        data: {
          paymentGateway: adapter.name,
          paymentRef: result.paymentId ?? null,
        },
      })
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment_link_created',
          note: `gateway=${adapter.name} ref=${result.paymentId ?? ''}`,
        },
      })
      log.info(
        { tenantId, orderId, gateway: adapter.name, ref: result.paymentId },
        'payment link created',
      )
      return NextResponse.json({
        ok: true,
        order: updated,
        payment: result,
      })
    }

    // Stub or error: still return the result so the caller can degrade gracefully.
    log.warn(
      {
        tenantId,
        orderId,
        gateway: adapter.name,
        status: result.status,
        message: result.message,
      },
      'payment link not created (stub or error)',
    )
    return NextResponse.json(
      {
        ok: false,
        payment: result,
      },
      { status: 200 },
    )
  } catch (err) {
    log.error(
      { err, tenantId, orderId, gateway },
      'payment link creation failed',
    )
    return NextResponse.json(
      {
        error: 'Payment link creation failed',
        detail: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 },
    )
  }
}
