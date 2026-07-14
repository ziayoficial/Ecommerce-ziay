import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getPaymentAdapter } from '@/lib/adapters/payment-registry'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getLogger } from '@/lib/logger'
import { orderService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/payments/create-link')

const CreateLinkSchema = z.object({
  tenantId: z.string().min(1),
  orderId: z.string().min(1),
  gateway: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().min(1),
  description: z.string().optional(),
})

// POST /api/payments/create-link
// Crea un link de pago en el gateway indicado y actualiza el Order con
// paymentGateway + paymentRef.
//
// Body:
//   { tenantId, orderId, gateway, amount, currency, description }
//
// Auth: requireTenantAccess(tenantId)
//
// SPRINT8-SERVICES-REST-001 — migrated the order.findUnique lookup to
// `orderService.getOrderById` (tenant-scoped) + the order.update +
// orderEvent.create (2 db calls) to a single `orderService.updateOrder`
// call. The order lookup uses `getOrderById` because the existing service
// method already scopes by tenant + includes the same relations. Response
// shape unchanged.
export const POST = withErrorHandling(async (req: NextRequest) => {

  const limited = rateLimit(req, {
    max: 30,
    windowMs: 60_000,
    namespace: 'api:payments:create-link',
  })
  if (limited) return limited

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = CreateLinkSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const { tenantId, orderId, gateway, amount, currency, description } = parseResult.data

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const order = await orderService.getOrderById(orderId, tenantId)
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const adapter = getPaymentAdapter(String(gateway))
  if (!adapter) {
    return NextResponse.json(
      { error: `Unsupported payment gateway: ${gateway}` },
      { status: 400 },
    )
  }

    const result = await adapter.createPaymentLink({
      amount: Number(amount),
      currency: String(currency),
      description: String(description ?? `Orden ${order.number}`),
      reference: order.number,
    })

    if (result.success && (result.paymentId || result.url)) {
      // Persist the gateway + ref on the order + write an audit event
      // atomically — `updateOrder` does both in a single $transaction.
      const updated = await orderService.updateOrder(
        order.id,
        {
          paymentGateway: adapter.name,
          paymentRef: result.paymentId ?? null,
        },
        {
          type: 'payment_link_created',
          note: `gateway=${adapter.name} ref=${result.paymentId ?? ''}`,
        },
        tenantId,
      )
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
  

})
