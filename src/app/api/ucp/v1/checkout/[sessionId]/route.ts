import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import {
  getTenantPublicKey,
  verifyVC,
  computeIntentCartHash,
} from '@/lib/crypto/signing'
import { requireIdentityVerification } from '@/lib/compliance/kyc-gate'

const log = getLogger('api/ucp/v1/checkout/[sessionId]')

// GET /api/ucp/v1/checkout/[sessionId]
// Devuelve el estado actual de la sesión (estado, carrito, continuationUrl
// si requires_escalation, etc.).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { error } = await requireAuth()
  if (error) return error

  try {
    const session = await db.ucpCheckoutSession.findUnique({
      where: { sessionId },
    })
    if (!session) {
      return NextResponse.json(
        { error: 'Sesión de checkout no encontrada' },
        { status: 404 },
      )
    }

    // Tenant guard.
    const { session: userSession, error: tErr } = await requireAuth()
    if (tErr) return tErr
    const userTenantId = userSession?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== session.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    return NextResponse.json({
      sessionId: session.sessionId,
      state: session.state,
      cart: session.cart ? JSON.parse(session.cart) : null,
      continuationUrl: session.continuationUrl,
      negotiatedCaps: session.negotiatedCaps
        ? JSON.parse(session.negotiatedCaps)
        : null,
      paymentHandler: session.paymentHandler,
      intentMandateId: session.intentMandateId,
      cartMandateId: session.cartMandateId,
      paymentMandateId: session.paymentMandateId,
      orderId: session.orderId,
      expiresAt: session.expiresAt,
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/ucp/v1/checkout/[sessionId]',
      method: 'GET',
    })
    return NextResponse.json(
      { error: 'No se pudo obtener la sesión' },
      { status: 500 },
    )
  }
}

// PATCH /api/ucp/v1/checkout/[sessionId]
// Avanza la máquina de estados.
//   incomplete → requires_escalation → ready_for_complete → completed
//
// Transiciones válidas:
//   incomplete → requires_escalation  (body: { continuationUrl })
//   requires_escalation → ready_for_complete  (verifica Intent + Cart)
//   ready_for_complete → completed  (crea order, return orderId)
//
// Body (todas opcionales según la transición):
//   { to: 'requires_escalation' | 'ready_for_complete' | 'completed',
//     continuationUrl?, intentMandateId?, cartMandateId?, paymentMandateId?,
//     customerId?, paymentMode?, conversationId?, clickId?, sourceAdId?,
//     sourceCampaign?, sourcePlatform? }
//
// SPRINT-WHATSAPP-FUNCTIONAL-001 — when `conversationId` is supplied on the
// `completed` transition, the resulting Order inherits the conversation's
// `clickId` / `sourceAdId` / `sourceCampaign` (CTWA attribution closed
// loop, study §14.4). The caller may also pass these fields directly to
// override (e.g. for web-checkout flows where the click_id was captured
// client-side and never went through a WhatsApp conversation).

const PatchSchema = z.object({
  to: z.enum(['requires_escalation', 'ready_for_complete', 'completed']),
  continuationUrl: z.string().url().optional(),
  intentMandateId: z.string().optional(),
  cartMandateId: z.string().optional(),
  paymentMandateId: z.string().optional(),
  customerId: z.string().optional(),
  paymentMode: z.enum(['advance', 'cod', 'hybrid', 'credit', 'installment']).optional(),
  conversationId: z.string().optional(),
  clickId: z.string().optional(),
  sourceAdId: z.string().optional(),
  sourceCampaign: z.string().optional(),
  sourcePlatform: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { error } = await requireAuth()
  if (error) return error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = PatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  try {
    const session = await db.ucpCheckoutSession.findUnique({
      where: { sessionId },
    })
    if (!session) {
      return NextResponse.json(
        { error: 'Sesión de checkout no encontrada' },
        { status: 404 },
      )
    }

    // Tenant guard.
    const { session: userSession, error: tErr } = await requireAuth()
    if (tErr) return tErr
    const userTenantId = userSession?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== session.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    // Validar transición legal.
    const VALID: Record<string, string[]> = {
      incomplete: ['requires_escalation', 'ready_for_complete'],
      requires_escalation: ['ready_for_complete'],
      ready_for_complete: ['completed', 'requires_escalation'],
      completed: [],
      failed: [],
    }
    if (!VALID[session.state]?.includes(body.to)) {
      return NextResponse.json(
        {
          error: `Transición inválida: ${session.state} → ${body.to}`,
        },
        { status: 409 },
      )
    }

    // ── requires_escalation ────────────────────────────────────────────
    if (body.to === 'requires_escalation') {
      if (!body.continuationUrl) {
        return NextResponse.json(
          { error: 'continuationUrl requerida para requires_escalation' },
          { status: 400 },
        )
      }
      const updated = await db.ucpCheckoutSession.update({
        where: { sessionId },
        data: {
          state: 'requires_escalation',
          continuationUrl: body.continuationUrl,
        },
      })
      log.info({ sessionId, state: updated.state }, 'UCP state → requires_escalation')
      return NextResponse.json({
        sessionId,
        state: updated.state,
        continuationUrl: updated.continuationUrl,
      })
    }

    // ── ready_for_complete ─────────────────────────────────────────────
    // Verifica Intent + Cart Mandates (firmas válidas + encadenamiento).
    if (body.to === 'ready_for_complete') {
      const intentId = body.intentMandateId ?? session.intentMandateId
      const cartId = body.cartMandateId ?? session.cartMandateId
      if (!intentId || !cartId) {
        return NextResponse.json(
          { error: 'Intent y Cart Mandate son requeridos para ready_for_complete' },
          { status: 400 },
        )
      }
      const intent = await db.aP2Mandate.findUnique({ where: { id: intentId } })
      const cart = await db.aP2Mandate.findUnique({
        where: { id: cartId },
        include: { parentMandate: true },
      })
      if (!intent || intent.type !== 'intent' || intent.status !== 'active') {
        return NextResponse.json(
          { error: 'Intent Mandate inválido o inactivo' },
          { status: 400 },
        )
      }
      if (!cart || cart.type !== 'cart' || cart.status !== 'active') {
        return NextResponse.json(
          { error: 'Cart Mandate inválido o inactivo' },
          { status: 400 },
        )
      }
      if (cart.parentMandateId !== intent.id) {
        return NextResponse.json(
          { error: 'Cart Mandate no está vinculado al Intent indicado' },
          { status: 400 },
        )
      }

      // Verificar firmas.
      const pub = await getTenantPublicKey(session.tenantId)
      if (!pub) {
        return NextResponse.json(
          { error: 'No hay llave pública del tenant' },
          { status: 500 },
        )
      }
      const intentVc = JSON.parse(intent.vcPayload)
      const cartVc = JSON.parse(cart.vcPayload)
      if (!verifyVC(intentVc, pub) || !verifyVC(cartVc, pub)) {
        return NextResponse.json(
          { error: 'Firma del Intent o Cart Mandate inválida' },
          { status: 400 },
        )
      }

      // Si el pago es a crédito/cuotas, validar KYC (Ley 2573).
      if (body.paymentMode === 'credit' || body.paymentMode === 'installment') {
        if (!intent.userId) {
          return NextResponse.json(
            { error: 'Intent Mandate no tiene userId para validar KYC' },
            { status: 400 },
          )
        }
        const kyc = await requireIdentityVerification(
          session.tenantId,
          intent.userId,
          body.paymentMode === 'credit' ? 'credit_purchase' : 'installment_plan',
          sessionId,
        )
        if (!kyc.verified) {
          // Forzar escalamiento: el humano debe completar KYC.
          const updated = await db.ucpCheckoutSession.update({
            where: { sessionId },
            data: {
              state: 'requires_escalation',
              continuationUrl: `/compliance/kyc?verificationId=${kyc.verificationId}`,
            },
          })
          return NextResponse.json({
            sessionId,
            state: updated.state,
            continuationUrl: updated.continuationUrl,
            kycRequired: true,
            verificationId: kyc.verificationId,
            reason: kyc.reason,
          })
        }
      }

      const updated = await db.ucpCheckoutSession.update({
        where: { sessionId },
        data: {
          state: 'ready_for_complete',
          intentMandateId: intent.id,
          cartMandateId: cart.id,
        },
      })
      log.info({ sessionId, state: updated.state }, 'UCP state → ready_for_complete')
      return NextResponse.json({
        sessionId,
        state: updated.state,
        intentMandateId: updated.intentMandateId,
        cartMandateId: updated.cartMandateId,
      })
    }

    // ── completed ──────────────────────────────────────────────────────
    // Crea un Order a partir del carrito + marca los mandatos como consumed.
    if (body.to === 'completed') {
      if (!session.cartMandateId || !session.intentMandateId) {
        return NextResponse.json(
          { error: 'La sesión no está ready_for_complete' },
          { status: 409 },
        )
      }
      if (!body.customerId) {
        return NextResponse.json(
          { error: 'customerId requerido para completar' },
          { status: 400 },
        )
      }
      const cart = JSON.parse(session.cart ?? '{}')
      const totals = cart.totals ?? { total: 0, subtotal: 0, shipping: 0, tax: 0 }

      // SPRINT-WHATSAPP-FUNCTIONAL-001 — CTWA attribution inheritance.
      // When the caller passes a `conversationId`, pull the conversation's
      // `clickId` / `sourceAdId` / `sourceCampaign` and stamp them on the
      // new Order. This closes the attribution loop: WA webhook captured
      // the CTWA click_id → conversation → order → CAPI Purchase event
      // (auto-fired when the order is marked paid).
      //
      // Explicit `body.clickId` / `body.sourceAdId` etc. take precedence
      // over the conversation's values — useful for web checkout flows
      // where the click_id was captured client-side.
      let attribution: {
        clickId?: string
        sourceAdId?: string
        sourceCampaign?: string
        sourcePlatform?: string
        conversationId?: string
      } = {}
      if (body.conversationId) {
        const conv = await db.conversation.findUnique({
          where: { id: body.conversationId },
          select: {
            id: true,
            tenantId: true,
            clickId: true,
            sourceAdId: true,
            sourceCampaign: true,
            customerPhone: true,
          },
        })
        // Defense-in-depth: only inherit from a conversation of the same tenant.
        if (conv && conv.tenantId === session.tenantId) {
          attribution = {
            clickId: body.clickId ?? conv.clickId ?? undefined,
            sourceAdId: body.sourceAdId ?? conv.sourceAdId ?? undefined,
            sourceCampaign: body.sourceCampaign ?? conv.sourceCampaign ?? undefined,
            sourcePlatform: body.sourcePlatform ?? undefined,
            conversationId: conv.id,
          }
        } else if (conv) {
          log.warn(
            { sessionId, conversationId: body.conversationId, tenantId: session.tenantId },
            'UCP checkout: conversation tenant mismatch — skipping attribution inheritance',
          )
        }
      } else if (body.clickId || body.sourceAdId) {
        attribution = {
          clickId: body.clickId,
          sourceAdId: body.sourceAdId,
          sourceCampaign: body.sourceCampaign,
          sourcePlatform: body.sourcePlatform,
        }
      }

      // Crear el Order (espajo local del pedido UCP).
      const order = await db.order.create({
        data: {
          tenantId: session.tenantId,
          number: `UCP-${session.sessionId.slice(0, 8)}`,
          customerId: body.customerId,
          status: 'new',
          paymentMode: body.paymentMode ?? 'advance',
          paymentStatus: 'unpaid',
          subtotal: totals.subtotal ?? 0,
          shipping: totals.shipping ?? 0,
          discount: totals.discount ?? 0,
          total: totals.total ?? 0,
          currency: 'COP',
          origen: 'ucp_agent',
          ...(attribution.conversationId ? { conversationId: attribution.conversationId } : {}),
          ...(attribution.clickId ? { clickId: attribution.clickId } : {}),
          ...(attribution.sourceAdId ? { sourceAdId: attribution.sourceAdId } : {}),
          ...(attribution.sourceCampaign ? { sourceCampaign: attribution.sourceCampaign } : {}),
          ...(attribution.sourcePlatform ? { sourcePlatform: attribution.sourcePlatform } : {}),
          attributedAt: attribution.clickId || attribution.sourceAdId ? new Date() : undefined,
        },
      })

      // OrderItems (si hay productos con productId válido, omitimos el FK
      // y dejamos productId como string — OrderItem.productId no es FK
      // estricto en SQLite dev; es solo un campo String. Para no romper la
      // FK real (OrderItem.productId → Product.id), sólo creamos OrderItem
      // cuando el SKU existe en el catálogo del tenant).
      const items = (cart.items ?? []) as Array<{
        sku: string
        name: string
        quantity: number
        unitPrice: number
        tax?: number
      }>
      for (const it of items) {
        const product = await db.product.findFirst({
          where: { tenantId: session.tenantId, sku: it.sku },
          select: { id: true },
        })
        if (!product) continue // skip si no existe el SKU
        await db.orderItem.create({
          data: {
            orderId: order.id,
            productId: product.id,
            name: it.name,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            cost: 0,
          },
        })
      }
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'created',
          note: `Pedido creado vía UCP (session ${session.sessionId})`,
        },
      })

      // Marcar Cart + Intent como consumed.
      await db.aP2Mandate.updateMany({
        where: { id: { in: [session.intentMandateId, session.cartMandateId].filter(Boolean) as string[] } },
        data: { status: 'consumed', orderId: order.id },
      })
      if (session.paymentMandateId) {
        await db.aP2Mandate.update({
          where: { id: session.paymentMandateId },
          data: { status: 'consumed', orderId: order.id },
        })
      }

      // Si hay Payment Mandate, validar encadenamiento con intentCartHash.
      if (session.paymentMandateId) {
        const pm = await db.aP2Mandate.findUnique({
          where: { id: session.paymentMandateId },
        })
        if (pm) {
          let pmSubject: Record<string, unknown> | null = null
          try {
            const pmVc = JSON.parse(pm.vcPayload)
            pmSubject = pmVc.credentialSubject
          } catch {
            pmSubject = null
          }
          const expectedHash = computeIntentCartHash(
            session.intentMandateId,
            session.cartMandateId,
          )
          if (pmSubject?.intentCartHash !== expectedHash) {
            log.warn(
              { sessionId, paymentMandateId: pm.id },
              'Payment Mandate intentCartHash mismatch',
            )
          }
        }
      }

      const updated = await db.ucpCheckoutSession.update({
        where: { sessionId },
        data: { state: 'completed', orderId: order.id },
      })

      log.info(
        { sessionId, orderId: order.id },
        'UCP state → completed (order created)',
      )

      return NextResponse.json({
        sessionId,
        state: updated.state,
        orderId: order.id,
        orderNumber: order.number,
      })
    }

    // Should not reach here.
    return NextResponse.json(
      { error: 'Transición no implementada' },
      { status: 400 },
    )
  } catch (err) {
    captureError(err as Error, {
      path: '/api/ucp/v1/checkout/[sessionId]',
      method: 'PATCH',
    })
    return NextResponse.json(
      { error: 'No se pudo avanzar la sesión de checkout' },
      { status: 500 },
    )
  }
}
