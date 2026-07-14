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
  computeIntentCartHash,
} from '@/lib/crypto/signing'

const log = getLogger('api/ap2/mandates/payment')

// POST /api/ap2/mandates/payment
// Crea un Payment Mandate vinculado a un Cart Mandate.
// Documento §10.2: "finaliza el tramo entre el agente y la red de pago,
// llevando el monto autorizado, la referencia del instrumento de fondeo y
// un hash que vincula el Intent y el Cart ya verificados".
//
// Reglas:
//   1. El Cart Mandate debe existir, estar `active`, no revocado.
//   2. La firma del Cart Mandate debe verificarse contra la pubKey del tenant.
//   3. El Intent padre del Cart debe estar `active`.
//   4. Se computa `intentCartHash = sha256(sort(intentId, cartId))` y se
//      incluye en el subject del Payment VC (no repudio).
//
// Body:
//   { tenantId, cartMandateId, paymentMethod: { type, token, holder? } }

const PaymentMethodSchema = z.object({
  type: z.enum(['card', 'pse', 'wallet', 'tokenized']),
  handler: z.string().min(1), // "com.mercadopago" | "com.stripe" etc
  token: z.string().min(1), // token del instrumento (no PAN)
  holder: z.string().optional(),
})

const CreatePaymentSchema = z.object({
  tenantId: z.string().min(1),
  cartMandateId: z.string().min(1),
  paymentMethod: PaymentMethodSchema,
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
  const parsed = CreatePaymentSchema.safeParse(raw)
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
    // 1) Cargar Cart Mandate + Intent padre.
    const cart = await db.aP2Mandate.findUnique({
      where: { id: body.cartMandateId },
      include: { parentMandate: true },
    })
    if (!cart) {
      return NextResponse.json(
        { error: 'Cart Mandate no encontrado' },
        { status: 404 },
      )
    }
    if (cart.tenantId !== body.tenantId) {
      return NextResponse.json(
        { error: 'Cart Mandate no pertenece al tenant' },
        { status: 403 },
      )
    }
    if (cart.type !== 'cart') {
      return NextResponse.json(
        { error: 'El mandateId proporcionado no es un Cart Mandate' },
        { status: 400 },
      )
    }
    if (cart.status !== 'active') {
      return NextResponse.json(
        { error: `Cart Mandate no activo (estado: ${cart.status})` },
        { status: 409 },
      )
    }

    const intent = cart.parentMandate
    if (!intent) {
      return NextResponse.json(
        { error: 'Cart Mandate no tiene Intent padre' },
        { status: 500 },
      )
    }
    if (intent.status !== 'active') {
      return NextResponse.json(
        { error: `Intent padre no activo (estado: ${intent.status})` },
        { status: 409 },
      )
    }
    if (intent.expiresAt && intent.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Intent padre expirado' },
        { status: 409 },
      )
    }

    // 2) Verificar firma del Cart Mandate.
    const pubKey = await getTenantPublicKey(body.tenantId)
    if (!pubKey) {
      return NextResponse.json(
        { error: 'No hay llave pública del tenant' },
        { status: 500 },
      )
    }
    let cartVc
    try {
      cartVc = JSON.parse(cart.vcPayload)
    } catch {
      return NextResponse.json(
        { error: 'Cart Mandate con payload corrupto' },
        { status: 500 },
      )
    }
    if (!verifyVC(cartVc, pubKey)) {
      return NextResponse.json(
        { error: 'Firma del Cart Mandate inválida' },
        { status: 400 },
      )
    }

    // 3) Calcular hash que vincula Intent + Cart (no repudio).
    const intentCartHash = computeIntentCartHash(intent.id, cart.id)

    // 4) Crear el Payment Mandate firmado por el tenant.
    const { privateKey, did } = await getOrCreateTenantKeypair(body.tenantId)
    const subject = {
      intentMandateId: intent.id,
      cartMandateId: cart.id,
      intentCartHash,
      paymentMethod: {
        type: body.paymentMethod.type,
        handler: body.paymentMethod.handler,
        // NO almacenar PAN ni datos sensibles — solo el token del instrumento.
        tokenRef: computeHash(body.paymentMethod.token),
        holder: body.paymentMethod.holder ?? null,
      },
      maxAmount: intent.maxAmount ?? null,
      currency: intent.currency ?? 'COP',
    }
    const unsigned = createW3CVC(did, ['AP2PaymentMandate'], subject)
    const signed = signVC(unsigned, privateKey)
    const vcJson = JSON.stringify(signed)
    const signature = signed.proof?.proofValue ?? ''

    const payment = await db.aP2Mandate.create({
      data: {
        tenantId: body.tenantId,
        type: 'payment',
        parentMandateId: cart.id,
        vcPayload: vcJson,
        vcSignature: signature,
        signatoryDid: did,
        status: 'active',
      },
    })

    log.info(
      { paymentMandateId: payment.id, cartMandateId: cart.id, intentMandateId: intent.id },
      'Payment mandate creado',
    )

    return NextResponse.json(
      {
        mandateId: payment.id,
        type: 'payment',
        parentMandateId: cart.id,
        intentMandateId: intent.id,
        intentCartHash,
        did,
        status: payment.status,
        vc: signed,
      },
      { status: 201 },
    )
  } catch (err) {
    captureError(err as Error, {
      path: '/api/ap2/mandates/payment',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo crear el Payment Mandate' },
      { status: 500 },
    )
  }
}
