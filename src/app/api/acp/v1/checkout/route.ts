import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { verifyAcpBearer } from '@/lib/acp/bearer'

const log = getLogger('api/acp/v1/checkout')

// POST /api/acp/v1/checkout
// ACP checkout flow — Documento §9.1.
//
// El agente ACP (ChatGPT / Copilot) llega con un carrito pre-construido +
// un `user_auth_token` que ES el ID del AP2 Intent Mandate firmado por el
// usuario humano. Validamos que el mandato exista, esté activo, no haya
// expirado y cubra los límites del carrito; luego creamos una UcpCheckoutSession
// con `agentDid = agent_id` y devolvemos la URL de continuación UCP.
//
// Body:
//   {
//     agent_id,                 // DID del agente ACP (ej: "did:web:chatgpt.com")
//     items: [{ sku, quantity }],
//     shipping_address?: { name, address, city, country },
//     payment_method,           // 'card' | 'mercadopago' | 'wompi'
//     user_auth_token           // AP2 Intent Mandate ID (Bearer)
//   }
//
// Returns:
//   { checkout_url, checkout_id, expires_at }

const ItemSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
})

const ShippingAddressSchema = z
  .object({
    name: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
  })
  .optional()

const AcpCheckoutSchema = z.object({
  agent_id: z.string().min(1),
  items: z.array(ItemSchema).min(1),
  shipping_address: ShippingAddressSchema,
  payment_method: z.enum(['card', 'mercadopago', 'wompi']),
  user_auth_token: z.string().min(1),
})

// Map ACP payment_method → UCP payment handler ID.
const PAYMENT_METHOD_TO_HANDLER: Record<string, string> = {
  card: 'com.stripe',
  mercadopago: 'com.mercadopago',
  wompi: 'com.wompi',
}

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

  const parsed = AcpCheckoutSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  try {
    // ── 1. Validar el user_auth_token como AP2 Intent Mandate firmado ──
    // V4 (AUDIT-FINAL-SEC-001): el token ya NO es el mandate ID en crudo —
    // es `{mandateId}.{ed25519(mandateId)}` firmado por la clave del tenant.
    // verifyAcpBearer valida la firma, el estado `active` y la vigencia.
    const bearer = await verifyAcpBearer(body.user_auth_token)
    if (!bearer) {
      return NextResponse.json(
        {
          error: 'Token de autorización inválido o expirado',
          code: 'invalid_auth_token',
        },
        { status: 401 },
      )
    }
    // El mandate sigue siendo necesario para los límites (maxAmount,
    // categoryLimits) — lo cargamos completo desde el DB.
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
        {
          error: 'El mandato de intención ha expirado',
          code: 'mandate_expired',
        },
        { status: 401 },
      )
    }

    // ── 2. Resolver productos por SKU ──────────────────────────────────
    const skus = body.items.map(i => i.sku)
    const products = await db.product.findMany({
      where: { tenantId: mandate.tenantId, sku: { in: skus } },
    })
    const missing = skus.filter(s => !products.some(p => p.sku === s))
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `SKUs no encontrados: ${missing.join(', ')}`,
          code: 'sku_not_found',
        },
        { status: 422 },
      )
    }

    // ── 3. Construir carrito + verificar límites del Intent ────────────
    const cartItems = body.items.map(i => {
      const p = products.find(pp => pp.sku === i.sku)!
      return {
        sku: i.sku,
        name: p.name,
        quantity: i.quantity,
        unitPrice: p.price,
        category: p.categoria ?? null,
        tax: 0,
        total: p.price * i.quantity,
      }
    })
    const subtotal = cartItems.reduce((s, c) => s + c.total, 0)
    const currency = mandate.currency ?? 'COP'

    // Verificar tope global del Intent.
    if (mandate.maxAmount !== null && subtotal > mandate.maxAmount) {
      return NextResponse.json(
        {
          error: `El total (${subtotal} ${currency}) excede el tope autorizado por el mandato (${mandate.maxAmount} ${currency})`,
          code: 'amount_exceeds_mandate',
        },
        { status: 422 },
      )
    }
    // Verificar topes por categoría.
    if (mandate.categoryLimits) {
      try {
        const limits = JSON.parse(mandate.categoryLimits) as Record<
          string,
          number
        >
        const perCat: Record<string, number> = {}
        for (const c of cartItems) {
          if (!c.category) continue
          perCat[c.category] = (perCat[c.category] ?? 0) + c.total
        }
        for (const [cat, total] of Object.entries(perCat)) {
          const cap = limits[cat]
          if (cap !== undefined && total > cap) {
            return NextResponse.json(
              {
                error: `La categoría "${cat}" excede el tope autorizado (${total} > ${cap} ${currency})`,
                code: 'category_limit_exceeded',
              },
              { status: 422 },
            )
          }
        }
      } catch {
        // categoryLimits corrupto — fallamos seguro (deny).
        return NextResponse.json(
          { error: 'Límites de categoría del mandato corruptos', code: 'mandate_corrupt' },
          { status: 500 },
        )
      }
    }

    // ── 4. Crear UcpCheckoutSession con agentDid = agent_id ────────────
    const sessionId = randomUUID()
    const chosenHandler =
      PAYMENT_METHOD_TO_HANDLER[body.payment_method] ?? 'com.mercadopago'
    const cartJson = JSON.stringify({
      items: cartItems,
      totals: {
        subtotal,
        tax: 0,
        shipping: 0,
        discount: 0,
        total: subtotal,
      },
      shipping: body.shipping_address,
    })

    const session = await db.ucpCheckoutSession.create({
      data: {
        tenantId: mandate.tenantId,
        sessionId,
        agentDid: body.agent_id,
        intentMandateId: mandate.id,
        state: 'incomplete',
        cart: cartJson,
        negotiatedCaps: JSON.stringify({
          capabilities: ['dev.ucp.shopping.checkout'],
          paymentHandlers: [chosenHandler],
        }),
        paymentHandler: chosenHandler,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
      },
    })

    log.info(
      {
        sessionId: session.sessionId,
        tenantId: mandate.tenantId,
        agentDid: body.agent_id,
        intentMandateId: mandate.id,
      },
      'ACP checkout session creada',
    )

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    return NextResponse.json(
      {
        checkout_id: session.sessionId,
        checkout_url: `${baseUrl}/api/ucp/v1/checkout/${session.sessionId}`,
        expires_at: session.expiresAt,
        total: subtotal,
        currency,
      },
      { status: 201 },
    )
  } catch (err) {
    captureError(err as Error, {
      path: '/api/acp/v1/checkout',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo iniciar el checkout ACP' },
      { status: 500 },
    )
  }
}
