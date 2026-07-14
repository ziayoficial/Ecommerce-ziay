import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import {
  createW3CVC,
  getOrCreateTenantKeypair,
  signVC,
  verifyVC,
  getTenantPublicKey,
  computeHash,
} from '@/lib/crypto/signing'
import {
  enforceMandateBounds,
  normalizeUcpCartToItems,
} from '@/lib/governance/mandate-enforcement'

const log = getLogger('api/ap2/mandates/cart')

// POST /api/ap2/mandates/cart
// Crea un Cart Mandate vinculado a un Intent Mandate.
// Documento §10.2: "lo produce el comercio o su agente, y vincula un SKU
// específico, precio, impuestos, envío y total al Intent".
//
// Reglas:
//   1. El Intent Mandate debe existir, estar `active`, no expirado.
//   2. La firma del Intent Mandate debe verificarse contra la pubKey del tenant.
//   3. El total del carrito no debe superar `Intent.maxAmount`.
//   4. Cada categoría del carrito no debe superar `Intent.categoryLimits[cat]`.
//
// Body:
//   { tenantId, intentMandateId, cart: { items, totals, shipping } }

const CartItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  category: z.string().optional(),
  tax: z.number().nonnegative().default(0),
})

const CartTotalsSchema = z.object({
  subtotal: z.number().nonnegative(),
  tax: z.number().nonnegative().default(0),
  shipping: z.number().nonnegative().default(0),
  discount: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
})

const CreateCartSchema = z.object({
  tenantId: z.string().min(1),
  intentMandateId: z.string().min(1),
  cart: z.object({
    items: z.array(CartItemSchema).min(1),
    totals: CartTotalsSchema,
    shipping: z
      .object({
        name: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
      })
      .optional(),
  }),
})

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
  const parsed = CreateCartSchema.safeParse(raw)
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
    // 1) Cargar el Intent Mandate padre.
    const intent = await db.aP2Mandate.findUnique({
      where: { id: body.intentMandateId },
    })
    if (!intent) {
      return NextResponse.json(
        { error: 'Intent Mandate no encontrado' },
        { status: 404 },
      )
    }
    if (intent.tenantId !== body.tenantId) {
      return NextResponse.json(
        { error: 'Intent Mandate no pertenece al tenant' },
        { status: 403 },
      )
    }
    if (intent.type !== 'intent') {
      return NextResponse.json(
        { error: 'El mandateId proporcionado no es un Intent Mandate' },
        { status: 400 },
      )
    }
    if (intent.status !== 'active') {
      return NextResponse.json(
        { error: `Intent Mandate no activo (estado: ${intent.status})` },
        { status: 409 },
      )
    }
    if (intent.expiresAt && intent.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Intent Mandate expirado' },
        { status: 409 },
      )
    }

    // 2) Verificar la firma del Intent Mandate.
    const pubKey = await getTenantPublicKey(body.tenantId)
    if (!pubKey) {
      return NextResponse.json(
        { error: 'No hay llave pública del tenant' },
        { status: 500 },
      )
    }
    let intentVc
    try {
      intentVc = JSON.parse(intent.vcPayload)
    } catch {
      return NextResponse.json(
        { error: 'Intent Mandate con payload corrupto' },
        { status: 500 },
      )
    }
    if (!verifyVC(intentVc, pubKey)) {
      return NextResponse.json(
        { error: 'Firma del Intent Mandate inválida' },
        { status: 400 },
      )
    }

    // 3) SPRINT-GOVERNANCE-001 — Pilar #1: enforceMandateBounds.
    // Llamada centralizada al módulo de gobernanza. Verifica monto total y
    // límites por categoría en un solo lugar (single source of truth).
    // Si el carrito excede los límites del Intent → 403 con las violaciones.
    //
    // Los checks inline (4) permanecen como defense-in-depth: si por algún
    // bug el módulo central no atrapa una violación, los checks inline
    // todavía la rechazan con 400.
    const governanceCartItems = normalizeUcpCartToItems({
      items: body.cart.items.map((it) => ({
        sku: it.sku,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        tax: it.tax,
        category: it.category,
      })),
      totals: body.cart.totals,
    })
    const enforcement = await enforceMandateBounds(intent.id, governanceCartItems)
    if (!enforcement.allowed) {
      return NextResponse.json(
        {
          error: 'Carrito excede los límites del Intent Mandate',
          violations: enforcement.violations,
        },
        { status: 403 },
      )
    }

    // 4) Validar que el carrito respeta los límites del Intent.
    // (Defense-in-depth — el módulo de gobernanza ya verificó arriba.)
    const total = body.cart.totals.total
    if (intent.maxAmount != null && total > intent.maxAmount) {
      return NextResponse.json(
        {
          error: `Total del carrito (${total}) supera el máximo autorizado (${intent.maxAmount})`,
        },
        { status: 400 },
      )
    }
    const catLimits: Record<string, number> = intent.categoryLimits
      ? (() => {
          try {
            return JSON.parse(intent.categoryLimits) as Record<string, number>
          } catch {
            return {}
          }
        })()
      : {}
    if (Object.keys(catLimits).length > 0) {
      const perCategory: Record<string, number> = {}
      for (const it of body.cart.items) {
        if (!it.category) continue
        const line = (it.unitPrice + it.tax) * it.quantity
        perCategory[it.category] = (perCategory[it.category] ?? 0) + line
      }
      for (const [cat, amount] of Object.entries(perCategory)) {
        const cap = catLimits[cat]
        if (cap != null && amount > cap) {
          return NextResponse.json(
            {
              error: `Categoría "${cat}" excede el límite (${amount} > ${cap})`,
            },
            { status: 400 },
          )
        }
      }
    }

    // 4) Crear el Cart Mandate firmado por el tenant.
    const { privateKey, did } = await getOrCreateTenantKeypair(body.tenantId)
    const subject = {
      intentMandateId: intent.id,
      items: body.cart.items,
      totals: body.cart.totals,
      shipping: body.cart.shipping ?? null,
      totalHash: computeCartHash(body.cart),
    }
    const unsigned = createW3CVC(did, ['AP2CartMandate'], subject)
    const signed = signVC(unsigned, privateKey)
    const vcJson = JSON.stringify(signed)
    const signature = signed.proof?.proofValue ?? ''

    const cart = await db.aP2Mandate.create({
      data: {
        tenantId: body.tenantId,
        type: 'cart',
        parentMandateId: intent.id,
        vcPayload: vcJson,
        vcSignature: signature,
        signatoryDid: did,
        status: 'active',
      },
    })

    log.info({ cartMandateId: cart.id, intentMandateId: intent.id }, 'Cart mandate creado')

    return NextResponse.json(
      {
        mandateId: cart.id,
        type: 'cart',
        parentMandateId: intent.id,
        did,
        status: cart.status,
        vc: signed,
      },
      { status: 201 },
    )
  } catch (err) {
    captureError(err as Error, {
      path: '/api/ap2/mandates/cart',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo crear el Cart Mandate' },
      { status: 500 },
    )
  }
}

/** Hash determinístico del carrito (sin la firma) para enlace con Payment. */
function computeCartHash(cart: {
  items: Array<{ sku: string; quantity: number; unitPrice: number; tax?: number }>
  totals: { total: number; subtotal: number; shipping?: number; tax?: number }
}): string {
  // Order items by SKU for stability.
  const itemsSorted = [...cart.items].sort((a, b) => a.sku.localeCompare(b.sku))
  const payload = JSON.stringify({
    items: itemsSorted.map(i => ({
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      tax: i.tax ?? 0,
    })),
    totals: cart.totals,
  })
  return computeHash(payload)
}
