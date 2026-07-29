import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getPaymentAdapter } from '@/lib/adapters/payment-registry'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getLogger } from '@/lib/logger'
import { orderService } from '@/lib/services'
import { fraudService } from '@/lib/services/fraud.service'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { db } from '@/lib/db'
import { CURRENCIES, isCurrencyCode } from '@/lib/i18n/currency'

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
/**
 * POST /api/payments/create-link
 *
 * Create a payment link for an order (checkout URL).
 *
 * @security Requires authentication + tenant access
 * @returns Payment link URL + reference
 */
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

  // AUDIT-FINTECH-V2 / R-17 — validate amount against the currency's
  // gateway-imposed minimum BEFORE the fraud check. A COP 500 link would
  // be rejected by Wompi (min COP 2500) with a confusing gateway error;
  // surfacing it here as a 400 lets the client retry with a valid amount.
  // Placed before the fraud check so we don't waste a FraudEvent row on
  // invalid input (defense-in-depth on the reasons/PII audit trail).
  const resolvedCurrency = String(currency).toUpperCase()
  if (isCurrencyCode(resolvedCurrency)) {
    const currencyConfig = CURRENCIES[resolvedCurrency]
    if (currencyConfig.minimumAmount && Number(amount) < currencyConfig.minimumAmount) {
      return NextResponse.json(
        {
          error: `Amount ${amount} ${resolvedCurrency} is below minimum (${currencyConfig.minimumAmount})`,
        },
        { status: 400 },
      )
    }
  }

  const adapter = getPaymentAdapter(String(gateway))
  if (!adapter) {
    return NextResponse.json(
      { error: `Unsupported payment gateway: ${gateway}` },
      { status: 400 },
    )
  }

    // ── I2-R3 — Anti-fraud check (BEFORE creating the payment link) ──────
    // Runs the layered fraud pipeline: blocklist, OFAC, velocity, sanctioned
    // country, first-purchase high-value, test card BIN. Block → 402; review
    // → flag the order with a `fraud_review` event but still proceed; allow
    // → proceed normally. A `FraudEvent` row is always written for audit.
    const customerIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      undefined
    try {
      const fraudResult = await fraudService.checkTransaction({
        tenantId,
        customerId: order.customerId,
        customerName: order.customer?.name ?? undefined,
        customerEmail: order.customer?.email ?? undefined,
        customerPhone: order.customer?.phone ?? undefined,
        customerIp,
        amount: Number(amount),
        currency: String(currency),
        countryCode: order.countryCode ?? '',
        paymentMethod: adapter.name,
        isReturningCustomer:
          (order.customer?.ordersCount ?? 0) > 0 ||
          (order.customer?.lifetimeValue ?? 0) > 0,
      })

      if (fraudResult.decision === 'block') {
        log.warn(
          {
            tenantId,
            orderId,
            riskScore: fraudResult.riskScore,
            reasons: fraudResult.reasons,
          },
          'payment link blocked by fraud detection',
        )
        return NextResponse.json(
          {
            error: 'Transaction blocked by fraud detection',
            reasons: fraudResult.reasons,
            riskScore: fraudResult.riskScore,
          },
          { status: 402 },
        )
      }

      if (fraudResult.decision === 'review') {
        log.warn(
          {
            tenantId,
            orderId,
            riskScore: fraudResult.riskScore,
            reasons: fraudResult.reasons,
          },
          'payment link flagged for fraud review — proceeding',
        )
        // Flag the order with a `fraud_review` event so fulfillment can
        // hold for manual review. Atomic with no state change to the order
        // itself — the link is still created below.
        try {
          await orderService.updateOrder(
            order.id,
            {},
            {
              type: 'fraud_review',
              note: `riskScore=${fraudResult.riskScore} reasons=${fraudResult.reasons.join('; ')}`.slice(0, 500),
            },
            tenantId,
          )
        } catch (flagErr) {
          log.error(
            { orderId, err: flagErr instanceof Error ? flagErr.message : String(flagErr) },
            'failed to write fraud_review event (non-blocking)',
          )
        }
      }
    } catch (fraudErr) {
      // Fail-open: if the fraud pipeline itself crashes, do NOT block a
      // legitimate payment. Log + proceed; the blocklist/velocity stores
      // are best-effort and a DB outage shouldn't take checkout down.
      log.error(
        {
          tenantId,
          orderId,
          err: fraudErr instanceof Error ? fraudErr.message : String(fraudErr),
        },
        'fraud check pipeline crashed — proceeding (fail-open)',
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

      // ── AUDIT-FINTECH R-8 — retracto notice (Ley 1480 Art 47) ──────────
      // The customer is now receiving the checkout link — this is the formal
      // moment we inform them of their 5-day retracto right for non-in-person
      // sales (ventas no presenciales) per Colombia's Estatuto del Consumidor.
      // We persist a separate `retracto_notice` OrderEvent so the audit trail
      // clearly shows the customer was informed (compliance defense if the
      // customer later disputes that they were unaware of the right). The
      // `Order.retractoWindowUntil` field is the canonical deadline; this
      // event is the proof of notification. Best-effort — a failure here is
      // logged + swallowed so it doesn't block the payment-link flow.
      try {
        await db.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'retracto_notice',
            note: 'Customer informed of 5-day retracto right per Ley 1480 Art 47 (Estatuto del Consumidor, Colombia). Ventas no presenciales — window expires on order.retractoWindowUntil.',
          },
        })
      } catch (noticeErr) {
        log.error(
          {
            orderId: order.id,
            err: noticeErr instanceof Error ? noticeErr.message : String(noticeErr),
          },
          'retracto_notice: failed to persist OrderEvent (non-blocking)',
        )
      }

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
