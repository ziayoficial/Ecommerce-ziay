import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'

const log = getLogger('api/ucp/v1/checkout')

// POST /api/ucp/v1/checkout
// Inicia una UCP Checkout Session.
// Documento §10.1: el agente llega con su perfil de capacidades; el comercio
// calcula la intersección y responde con el resultado negociado + sessionId.
//
// Body:
//   {
//     tenantId,
//     agentDid,
//     intentMandateId?,
//     cart: { items, totals, shipping? },
//     agentCapabilities: string[],          // ej: ["dev.ucp.shopping.checkout"]
//     agentPaymentHandlers: string[],       // ej: ["com.mercadopago", "com.stripe"]
//     paymentHandler?: string,              // preferido
//   }

const CartItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  category: z.string().optional(),
  tax: z.number().nonnegative().default(0),
})

const TotalsSchema = z.object({
  subtotal: z.number().nonnegative(),
  tax: z.number().nonnegative().default(0),
  shipping: z.number().nonnegative().default(0),
  discount: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
})

const ShippingSchema = z
  .object({
    name: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
  })
  .optional()

const CheckoutStartSchema = z.object({
  tenantId: z.string().min(1),
  agentDid: z.string().min(1),
  intentMandateId: z.string().optional(),
  cart: z.object({
    items: z.array(CartItemSchema).min(1),
    totals: TotalsSchema,
    shipping: ShippingSchema,
  }),
  agentCapabilities: z.array(z.string()).default([]),
  agentPaymentHandlers: z.array(z.string()).default([]),
  paymentHandler: z.string().optional(),
})

// Capacidades que el tenant soporta (declaradas en /.well-known/ucp).
const TENANT_CAPABILITIES = [
  'dev.ucp.shopping.checkout',
  'dev.ucp.common.identity_linking',
  'dev.ucp.shopping.order',
  'dev.ucp.shopping.payment_token_exchange',
]

// Manejadores de pago que el tenant soporta.
const TENANT_PAYMENT_HANDLERS = [
  'com.mercadopago',
  'com.wompi',
  'com.stripe',
  'com.payu',
]

/**
 * UCP checkout session start handler.
 *
 * Inicia una UCP Checkout Session (Documento §10.1). El agente llega con
 * su perfil de capacidades + payment handlers soportados; el comercio
 * calcula la intersección con sus propias capabilities y responde con el
 * resultado negociado + sessionId para avanzar la máquina de estados.
 *
 * Pasos:
 *   1. Validar body con `CheckoutStartSchema` (cart, capabilities, etc.).
 *   2. `requireTenantAccess` valida la sesión NextAuth + tenant match.
 *   3. Negociación: intersectar `agentCapabilities` con `TENANT_CAPABILITIES`
 *      y `agentPaymentHandlers` con `TENANT_PAYMENT_HANDLERS`.
 *   4. Si la intersección no incluye `dev.ucp.shopping.checkout` → 422.
 *   5. Resolver el handler preferido (validar que esté en la intersección).
 *   6. Crear `UcpCheckoutSession` (state='incomplete', expira en 30 min).
 *
 * Body (validado con `CheckoutStartSchema`):
 *   - `tenantId`, `agentDid`, `intentMandateId?`
 *   - `cart`: `{ items, totals, shipping? }`
 *   - `agentCapabilities: string[]` (ej: `["dev.ucp.shopping.checkout"]`)
 *   - `agentPaymentHandlers: string[]` (ej: `["com.mercadopago", "com.stripe"]`)
 *   - `paymentHandler?` (preferido)
 *
 * @see docs/openapi.yaml `/api/ucp/v1/checkout`
 * @security Sesión NextAuth (`requireTenantAccess`). El `tenantId` del body
 *           debe coincidir con el de la sesión salvo platform-admin.
 * @returns 201 con `{ sessionId, state, negotiatedCapabilities,
 *          negotiatedPaymentHandlers, paymentHandler, expiresAt, next }`;
 *          400 (JSON inválido o parámetros inválidos) /
 *          401 / 403 (tenant mismatch) /
 *          422 (falta capability `dev.ucp.shopping.checkout`) /
 *          500 (error interno).
 */
export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = CheckoutStartSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { error } = await requireTenantAccess(body.tenantId)
  if (error) return error

  try {
    // Negociación: intersección de capacidades y manejadores de pago.
    const negotiatedCaps = body.agentCapabilities.filter(c =>
      TENANT_CAPABILITIES.includes(c),
    )
    const negotiatedHandlers = body.agentPaymentHandlers.filter(h =>
      TENANT_PAYMENT_HANDLERS.includes(h),
    )

    // Si el agente no soporta `checkout`, no podemos continuar.
    if (!negotiatedCaps.includes('dev.ucp.shopping.checkout')) {
      return NextResponse.json(
        {
          error:
            'El agente no soporta la capacidad dev.ucp.shopping.checkout requerida',
        },
        { status: 422 },
      )
    }

    // Handler preferido: validar que esté en la intersección.
    const chosenHandler =
      body.paymentHandler && negotiatedHandlers.includes(body.paymentHandler)
        ? body.paymentHandler
        : negotiatedHandlers[0] ?? null

    const sessionId = randomUUID()
    const cartJson = JSON.stringify(body.cart)

    const session = await db.ucpCheckoutSession.create({
      data: {
        tenantId: body.tenantId,
        sessionId,
        agentDid: body.agentDid,
        intentMandateId: body.intentMandateId ?? null,
        state: 'incomplete',
        cart: cartJson,
        negotiatedCaps: JSON.stringify({
          capabilities: negotiatedCaps,
          paymentHandlers: negotiatedHandlers,
        }),
        paymentHandler: chosenHandler,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
      },
    })

    log.info(
      { sessionId: session.sessionId, tenantId: body.tenantId, agentDid: body.agentDid },
      'UCP checkout session iniciada',
    )

    return NextResponse.json(
      {
        sessionId: session.sessionId,
        state: session.state,
        negotiatedCapabilities: negotiatedCaps,
        negotiatedPaymentHandlers: negotiatedHandlers,
        paymentHandler: chosenHandler,
        expiresAt: session.expiresAt,
        // URL para avanzar la máquina de estados.
        next: {
          poll: `GET /api/ucp/v1/checkout/${session.sessionId}`,
          advance: `PATCH /api/ucp/v1/checkout/${session.sessionId}`,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    captureError(err as Error, {
      path: '/api/ucp/v1/checkout',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo iniciar la sesión de checkout' },
      { status: 500 },
    )
  }
}
