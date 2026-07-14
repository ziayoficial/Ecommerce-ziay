import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import {
  getLocalPaymentAdapter,
  isLocalPaymentMethod,
  getAvailableLocalPayments,
  type LocalPaymentMethod,
} from '@/lib/adapters/local-payments'
import { isCurrencyCode, getCurrencyForCountry } from '@/lib/i18n/currency'
import { calculateTax } from '@/lib/i18n/tax'

const log = getLogger('api/payments/local')

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/local
//
// Create a local payment (PSE / PIX / OXXO / SPEI) for a tenant.
//
// Body:
//   {
//     method:        'pse' | 'pix' | 'oxxo' | 'spei',
//     amount:        number,
//     reference:     string,             // caller-side reference (e.g. cart id)
//     tenantId:      string,
//     countryCode:   'CO' | 'BR' | 'MX' | ...,
//     currency?:     'COP' | 'BRL' | 'MXN' | ...,   // defaults to country's currency
//     bankCode?:     string,             // PSE only
//     returnUrl?:    string,             // PSE only
//     items?:        [{ sku, name, price, quantity, category }],  // for tax calc
//     shipping?:     number,             // for tax calc
//     customerId?:   string,             // link to existing Customer
//     customerName?: string,             // create ad-hoc Customer if missing
//     customerPhone?:string,
//   }
//
// Behaviour:
//   1. Auth: caller must have access to `tenantId` (requireTenantAccess).
//   2. Validate the method is supported for the country via
//      `getAvailableLocalPayments(countryCode)`.
//   3. Compute currency + tax breakdown (when items are provided).
//   4. Create an Order (status='new', paymentStatus='unpaid',
//      paymentGateway=method, paymentRef=null — the ref is stamped on
//      webhook arrival OR on the polling endpoint).
//   5. Call the adapter's `createPayment` → returns the gateway reference +
//      QR/redirect/barcode.
//   6. Stamp `paymentRef` on the Order (atomic with an OrderEvent).
//   7. Return the payment instructions to the caller.
//
// SPRINT-MULTICOUNTRY-001 — study §18 LATAM expansion.
// ─────────────────────────────────────────────────────────────────────────────

const ItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  category: z.string().default('general'),
})

const CreateLocalPaymentSchema = z.object({
  method: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  reference: z.string().min(1),
  tenantId: z.string().min(1),
  countryCode: z.string().min(2).max(2),
  currency: z.string().optional(),
  bankCode: z.string().optional(),
  returnUrl: z.string().url().optional(),
  items: z.array(ItemSchema).optional(),
  shipping: z.union([z.number(), z.string()]).optional(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 30,
    windowMs: 60_000,
    namespace: 'api:payments:local',
  })
  if (limited) return limited

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateLocalPaymentSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  // Validate the method is a known local method.
  if (!isLocalPaymentMethod(body.method)) {
    return NextResponse.json(
      { error: `Unsupported local payment method: ${body.method}` },
      { status: 400 },
    )
  }
  const method = body.method as LocalPaymentMethod

  // Validate the method is available for the country.
  const available = getAvailableLocalPayments(body.countryCode)
  if (!available.includes(method)) {
    return NextResponse.json(
      {
        error: `Method ${method} is not available for country ${body.countryCode}. Available: ${available.join(', ') || 'none'}`,
      },
      { status: 400 },
    )
  }

  // Auth: caller must have access to the tenant.
  const { error } = await requireTenantAccess(body.tenantId)
  if (error) return error

  // Resolve currency: explicit > country default > COP fallback.
  const currency =
    (body.currency && isCurrencyCode(body.currency) && body.currency) ||
    getCurrencyForCountry(body.countryCode)

  const amount = typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
  }

  // Compute tax breakdown if items are provided.
  const shipping =
    typeof body.shipping === 'string' ? parseFloat(body.shipping) : (body.shipping ?? 0)
  const taxBreakdown = body.items && body.items.length > 0
    ? calculateTax({
        items: body.items,
        shipping,
        countryCode: body.countryCode,
      })
    : null

  // PSE requires bankCode + returnUrl.
  if (method === 'pse' && (!body.bankCode || !body.returnUrl)) {
    return NextResponse.json(
      { error: 'PSE requires bankCode and returnUrl' },
      { status: 400 },
    )
  }

  try {
    // ── Resolve or create the Customer ──────────────────────────────────
    let customerId = body.customerId
    if (!customerId && (body.customerName || body.customerPhone)) {
      const newCustomer = await db.customer.create({
        data: {
          tenantId: body.tenantId,
          name: body.customerName ?? 'Cliente',
          phone: body.customerPhone ?? '',
          country: body.countryCode,
        },
      })
      customerId = newCustomer.id
    }
    if (!customerId) {
      return NextResponse.json(
        { error: 'customerId (or customerName+customerPhone to create one) is required' },
        { status: 400 },
      )
    }

    // ── Create the Order (status=new, paymentStatus=unpaid) ─────────────
    // Generate a unique order number. Format: LP-<method>-<timestamp>-<rand>
    // to avoid colliding with the existing UCP- / ORD- prefixes.
    const orderNumber = `LP-${method.toUpperCase()}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`

    const order = await db.order.create({
      data: {
        tenantId: body.tenantId,
        number: orderNumber,
        customerId,
        status: 'new',
        paymentMode: 'advance',
        paymentStatus: 'unpaid',
        paymentGateway: method,
        subtotal: taxBreakdown?.subtotal ?? amount,
        shipping: taxBreakdown?.shipping ?? shipping,
        total: taxBreakdown?.total ?? amount,
        currency,
        countryCode: body.countryCode,
        taxAmount: taxBreakdown?.taxAmount ?? 0,
        taxBreakdown: taxBreakdown ? JSON.stringify(taxBreakdown) : null,
        origen: 'local_payment_api',
      },
    })

    // ── Call the adapter ────────────────────────────────────────────────
    const adapter = getLocalPaymentAdapter(method)
    const result = await adapter.createPayment({
      amount,
      reference: body.reference,
      tenantId: body.tenantId,
      ...(body.bankCode ? { bankCode: body.bankCode } : {}),
      ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
    })

    if (!result.success) {
      // Mark the Order as rejected.
      await db.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'rejected' },
      })
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment_rejected',
          note: `${method} createPayment failed (reference=${body.reference})`,
        },
      })
      return NextResponse.json(
        { ok: false, orderId: order.id, payment: result },
        { status: 200 },
      )
    }

    // ── Stamp paymentRef + write audit event (atomic) ───────────────────
    await db.$transaction([
      db.order.update({
        where: { id: order.id },
        data: {
          paymentRef: result.reference,
          paymentStatus: 'pending_payment',
        },
      }),
      db.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment_link_created',
          note: `${method} payment created (reference=${result.reference})`,
        },
      }),
    ])

    log.info(
      {
        tenantId: body.tenantId,
        orderId: order.id,
        method,
        reference: result.reference,
        amount,
        currency,
        countryCode: body.countryCode,
      },
      'local payment created',
    )

    return NextResponse.json(
      {
        ok: true,
        orderId: order.id,
        orderNumber: order.number,
        currency,
        amount,
        taxBreakdown,
        payment: result,
        // Poll URL — the client polls this for status updates.
        poll: `GET /api/payments/local/${encodeURIComponent(result.reference)}/status`,
      },
      { status: 201 },
    )
  } catch (err) {
    log.error(
      { err, tenantId: body.tenantId, method },
      'local payment creation failed',
    )
    captureError(err as Error, { path: '/api/payments/local', method: 'POST' })
    return NextResponse.json(
      {
        error: 'Local payment creation failed',
        detail: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 },
    )
  }
}
