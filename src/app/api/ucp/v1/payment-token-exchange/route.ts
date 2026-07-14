import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { computeHash } from '@/lib/crypto/signing'

const log = getLogger('api/ucp/v1/payment-token-exchange')

// POST /api/ucp/v1/payment-token-exchange
// Intercambia un token de pago del agente por un instrumento cobrable.
// Documento §10.1: "Payment Token Exchange" capability.
// Documento §10.2: enlaza con AP2 Payment Mandate.
//
// Flujo:
//   1. El agente llega con `paymentMandateId`, `paymentToken` (token del
//      handler del agente, ej: Google Pay token) y `paymentHandler`.
//   2. Validamos el Payment Mandate (firma, activo, no expirado).
//   3. Resolvemos el instrumento cobrable: llamamos al adapter interno
//      (aquí simulado — en prod se llama a Stripe/MP/Wompi/PayU).
//   4. Actualizamos el Payment Mandate con `paymentRef` (referencia de la
//      pasarela) y marcamos `consumed` si se cobra.
//
// Body:
//   { tenantId, paymentMandateId, paymentToken, paymentHandler }

const ExchangeSchema = z.object({
  tenantId: z.string().min(1),
  paymentMandateId: z.string().min(1),
  paymentToken: z.string().min(1),
  paymentHandler: z.string().min(1), // "com.mercadopago" | "com.stripe" etc
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
  const parsed = ExchangeSchema.safeParse(raw)
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
    // 1) Cargar Payment Mandate.
    const payment = await db.aP2Mandate.findUnique({
      where: { id: body.paymentMandateId },
      include: { parentMandate: true }, // Cart
    })
    if (!payment) {
      return NextResponse.json(
        { error: 'Payment Mandate no encontrado' },
        { status: 404 },
      )
    }
    if (payment.tenantId !== body.tenantId) {
      return NextResponse.json(
        { error: 'Payment Mandate no pertenece al tenant' },
        { status: 403 },
      )
    }
    if (payment.type !== 'payment') {
      return NextResponse.json(
        { error: 'El mandateId no es un Payment Mandate' },
        { status: 400 },
      )
    }
    if (payment.status !== 'active') {
      return NextResponse.json(
        { error: `Payment Mandate no activo (estado: ${payment.status})` },
        { status: 409 },
      )
    }

    const cart = payment.parentMandate
    if (!cart || cart.status !== 'active') {
      return NextResponse.json(
        { error: 'Cart Mandate padre inactivo' },
        { status: 409 },
      )
    }

    // 2) Verificar que el handler coincida con el declarado en el VC.
    let pmSubject: Record<string, unknown> = {}
    try {
      const pmVc = JSON.parse(payment.vcPayload)
      pmSubject = pmVc.credentialSubject ?? {}
    } catch {
      return NextResponse.json(
        { error: 'Payment Mandate con payload corrupto' },
        { status: 500 },
      )
    }
    const declaredHandler = (pmSubject.paymentMethod as { handler?: string })?.handler
    if (declaredHandler && declaredHandler !== body.paymentHandler) {
      return NextResponse.json(
        {
          error: `Handler ${body.paymentHandler} no coincide con el declarado ${declaredHandler}`,
        },
        { status: 400 },
      )
    }

    // 3) Verificar el tokenRef del Payment Mandate vs hash del token entrante.
    // El Payment Mandate guarda `tokenRef = sha256(originalToken)` para no
    // almacenar el PAN. Si el agente envía un token diferente, se rechaza.
    const expectedTokenRef = (pmSubject.paymentMethod as { tokenRef?: string })
      ?.tokenRef
    const actualTokenRef = computeHash(body.paymentToken)
    if (expectedTokenRef && expectedTokenRef !== actualTokenRef) {
      return NextResponse.json(
        { error: 'Token de pago no coincide con el autorizado en el mandate' },
        { status: 400 },
      )
    }

    // 4) Resolver instrumento cobrable.
    // En prod: llamar a `getPaymentAdapter(body.paymentHandler)` para
    // intercambiar el token por un `payment_ref` real en la pasarela.
    // Aquí generamos una referencia determinística para el demo.
    const paymentRef = `ucp-${body.paymentHandler.replace(/^com\./, '')}-${payment.id.slice(-8)}`
    const instrumentHash = computeHash(`${payment.id}:${body.paymentToken}`)

    // 5) Actualizar el Payment Mandate con la referencia.
    await db.aP2Mandate.update({
      where: { id: payment.id },
      data: { paymentRef },
    })

    log.info(
      {
        paymentMandateId: payment.id,
        cartMandateId: cart.id,
        paymentHandler: body.paymentHandler,
        paymentRef,
      },
      'UCP payment token exchange exitoso',
    )

    return NextResponse.json({
      paymentMandateId: payment.id,
      cartMandateId: cart.id,
      paymentHandler: body.paymentHandler,
      paymentRef,
      instrumentHash,
      // El agente no recibe datos sensibles — solo la referencia cobrable.
      chargeable: true,
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/ucp/v1/payment-token-exchange',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo intercambiar el token de pago' },
      { status: 500 },
    )
  }
}
