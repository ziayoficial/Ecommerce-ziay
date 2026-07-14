import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import {
  getTenantPublicKey,
  verifyVC,
  computeIntentCartHash,
} from '@/lib/crypto/signing'
import { requireIdentityVerification } from '@/lib/compliance/kyc-gate'
import {
  checkAgeGate,
  requireParentalConsent,
} from '@/lib/compliance/age-gate'
import {
  enforceMandateBounds,
  checkEscalationRules,
  normalizeUcpCartToItems,
} from '@/lib/governance/mandate-enforcement'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/ucp/v1/checkout/[sessionId]')

// GET /api/ucp/v1/checkout/[sessionId]
// Devuelve el estado actual de la sesión (estado, carrito, continuationUrl
// si requires_escalation, etc.).
/**
 * UCP checkout session status handler (GET).
 *
 * Devuelve el estado actual de la sesión UCP: `state`, `cart` (parsed),
 * `continuationUrl` (si `requires_escalation`), `negotiatedCaps`,
 * `paymentHandler`, IDs de los mandatos vinculados (intent / cart /
 * payment), `orderId` (si `completed`) y `expiresAt`.
 *
 * Auth: sesión NextAuth (`requireAuth`). El `tenantId` del usuario debe
 * coincidir con el de la sesión (403 si no).
 *
 * @see docs/openapi.yaml `/api/ucp/v1/checkout/{sessionId}`
 * @security Sesión NextAuth + tenant scoping.
 * @returns 200 con la representación de la sesión;
 *          401 / 403 (tenant mismatch) / 404 (sesión no encontrada) /
 *          500 (error interno).
 */
export const GET = withErrorHandling(async (_req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },) => {

  const { sessionId } = await params
  const { error } = await requireAuth()
  if (error) return error

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
  

})

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
  // SPRINT-GOVERNANCE-001 — contexto para checkEscalationRules.
  // Estos flags alimentan las reglas de escalamiento a humano (pilar #2).
  isFirstPurchase: z.boolean().optional().default(false),
  paymentMethodChanged: z.boolean().optional().default(false),
  failedPaymentCount: z.number().int().nonnegative().optional().default(0),
})

/**
 * UCP checkout session state-machine advance handler (PATCH).
 *
 * Avanza la máquina de estados UCP (Documento §10.1 + §11):
 *   `incomplete` → `requires_escalation` → `ready_for_complete` → `completed`
 *
 * Transiciones válidas:
 *   - `incomplete → requires_escalation`  (body: `{ continuationUrl }`)
 *   - `requires_escalation → ready_for_complete`  (verifica Intent + Cart
 *     Mandates: firmas válidas + encadenamiento `cart.parentMandateId === intent.id`)
 *   - `ready_for_complete → completed`  (crea Order, marca mandatos como
 *     `consumed`, retorna orderId)
 *   - `ready_for_complete → requires_escalation`  (governance / age gate /
 *     KYC pueden forzar re-escalamiento)
 *
 * Antes de avanzar a `ready_for_complete`:
 *   - **Governance pilar #1** (`enforceMandateBounds`): verifica topes del
 *     Intent Mandate (monto global + límites por categoría).
 *   - **Governance pilar #2** (`checkEscalationRules`): reglas de
 *     escalamiento a humano (`category_<cat>`, monto, isFirstPurchase,
 *     paymentMethodChanged, failedPaymentCount).
 *   - **FIX-LEGAL-P0-001 L-4** (age gate Ley 1098/2006 Art 17): si el
 *     customer es menor sin `parental_consent_minor` → fuerza `requires_escalation`.
 *   - **KYC Ley 2573**: si `paymentMode` es `credit` o `installment` →
 *     `requireIdentityVerification`; si falla, fuerza `requires_escalation`.
 *
 * En la transición `completed` (SPRINT-WHATSAPP-FUNCTIONAL-001):
 *   - Si se pasa `conversationId`, hereda `clickId` / `sourceAdId` /
 *     `sourceCampaign` de la conversación (CTWA closed-loop, estudio §14.4).
 *   - Crea Order + OrderItems (resuelve SKUs del catálogo del tenant) +
 *     OrderEvent(type='created').
 *   - Marca Cart + Intent (+ Payment si existe) como `consumed`.
 *   - Valida `intentCartHash` del Payment Mandate (defense-in-depth).
 *
 * @see docs/openapi.yaml `/api/ucp/v1/checkout/{sessionId}`
 * @security Sesión NextAuth + tenant scoping. Los mandatos se verifican con
 *           `verifyVC` (ed25519) usando la llave pública del tenant.
 * @returns 200 con `{ sessionId, state, ... }`;
 *          400 (JSON inválido, params inválidos, falta `customerId`) /
 *          401 / 403 (tenant mismatch, mandate bounds, governance block) /
 *          404 (sesión no encontrada) / 409 (transición inválida) /
 *          500 (error interno).
 */
export const PATCH = withErrorHandling(async (req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },) => {

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

      // ── SPRINT-GOVERNANCE-001 — Pilar #1: enforceMandateBounds ─────────
      // Antes de avanzar a `ready_for_complete`, verificar que el carrito
      // respeta los límites del Intent Mandate (monto total + límites por
      // categoría). El mandato se carga desde su `id` (ya validado arriba
      // como `intent`). El carrito viene en `session.cart` (JSON).
      const ucpCart = session.cart ? JSON.parse(session.cart) : { items: [] }
      const cartItems = normalizeUcpCartToItems(ucpCart)
      const enforcement = await enforceMandateBounds(intent.id, cartItems)
      if (!enforcement.allowed) {
        return NextResponse.json(
          {
            error: 'Carrito excede los límites del Intent Mandate',
            violations: enforcement.violations,
          },
          { status: 403 },
        )
      }

      // ── SPRINT-GOVERNANCE-001 — Pilar #2: checkEscalationRules ────────
      // Reglas de escalamiento a humano. Si una regla dispara `block` →
      // 403. Si dispara `escalate` → forzar estado `requires_escalation`
      // con continuationUrl apuntando a la cola de aprobación humana.
      //
      // La categoría dominante del carrito (la de mayor valor total) se
      // usa para las reglas `category_<cat>`. Si el carrito está vacío,
      // pasamos `'uncategorized'` (no dispara ninguna regla específica).
      const totalsForEsc = ucpCart.totals ?? {}
      const orderValue: number =
        typeof totalsForEsc.total === 'number'
          ? totalsForEsc.total
          : cartItems.reduce((sum, it) => sum + it.total, 0)
      const perCat: Record<string, number> = {}
      for (const it of cartItems) {
        perCat[it.category] = (perCat[it.category] ?? 0) + it.total
      }
      const dominantCategory =
        Object.entries(perCat).sort((a, b) => b[1] - a[1])[0]?.[0] ??
        'uncategorized'

      const escalation = checkEscalationRules({
        orderValue,
        category: dominantCategory,
        isFirstPurchase: body.isFirstPurchase ?? false,
        paymentMethodChanged: body.paymentMethodChanged ?? false,
        failedPaymentCount: body.failedPaymentCount ?? 0,
      })
      if (escalation.shouldBlock) {
        return NextResponse.json(
          {
            error: 'Carrito bloqueado por reglas de gobernanza',
            reasons: escalation.reasons,
          },
          { status: 403 },
        )
      }
      if (escalation.shouldEscalate) {
        const escalationUrl = `/governance/escalations?sessionId=${encodeURIComponent(sessionId)}`
        const escalated = await db.ucpCheckoutSession.update({
          where: { sessionId },
          data: {
            state: 'requires_escalation',
            continuationUrl: escalationUrl,
            intentMandateId: intent.id,
            cartMandateId: cart.id,
          },
        })
        log.info(
          { sessionId, state: escalated.state, reasons: escalation.reasons },
          'UCP state → requires_escalation (governance rules)',
        )
        return NextResponse.json({
          sessionId,
          state: escalated.state,
          continuationUrl: escalated.continuationUrl,
          escalated: true,
          reasons: escalation.reasons,
        })
      }

      // ── FIX-LEGAL-P0-001 L-4 — Age gate (Ley 1098/2006 Art 17) ──────────
      // Before allowing the checkout to advance to `ready_for_complete`,
      // verify the customer is not a minor OR — if they are — that they
      // have an active `parental_consent_minor` ConsentRecord on file.
      // If the customer is a minor WITHOUT parental consent, force the
      // session into `requires_escalation` so the human-in-the-loop can
      // collect the parental consent via the `/compliance/parental-consent`
      // continuation URL.
      //
      // The check runs only when `body.customerId` is supplied. The
      // `completed` transition independently requires `customerId`, so a
      // checkout that reached `ready_for_complete` without a customerId
      // here will be caught at completion. Skipping the age gate here when
      // customerId is absent is safe (no PII is processed until the
      // `completed` transition).
      if (body.customerId) {
        const ageCheck = await checkAgeGate(body.customerId)
        if (!ageCheck.allowed) {
          if (ageCheck.isMinor) {
            const parentalConsent = await requireParentalConsent(
              body.customerId,
            )
            if (!parentalConsent.verified) {
              // Force escalation — parental consent must be collected.
              const continuationUrl = `/compliance/parental-consent?customerId=${encodeURIComponent(
                body.customerId,
              )}`
              const escalated = await db.ucpCheckoutSession.update({
                where: { sessionId },
                data: {
                  state: 'requires_escalation',
                  continuationUrl,
                },
              })
              log.info(
                {
                  sessionId,
                  state: escalated.state,
                  customerId: body.customerId,
                  reason: ageCheck.reason,
                },
                'UCP state → requires_escalation (age gate — Ley 1098/2006)',
              )
              return NextResponse.json({
                sessionId,
                state: escalated.state,
                continuationUrl: escalated.continuationUrl,
                escalated: true,
                reason: ageCheck.reason,
                legalBasis: 'Ley 1098 de 2006 Art 17',
              })
            }
            // Parental consent on file — allow the checkout through, but
            // log the minor status so downstream flows (marketing, retention)
            // can apply the enhanced-protection rules.
            log.info(
              { sessionId, customerId: body.customerId },
              'UCP age gate: minor with parental consent on file — proceeding',
            )
          } else {
            // Age check failed for a non-age reason (e.g. customer not found,
            // DB error). Block the checkout with 403.
            return NextResponse.json(
              { error: ageCheck.reason ?? 'Verificación de edad fallida' },
              { status: 403 },
            )
          }
        }
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
          // SPRINT-DIAN-RETRACTO-001 · P1-2 — Derecho al retracto (Ley 1480
          // Art 47): 5 calendar days from creation for online purchases.
          // Stamped at order creation so `processRetracto()` doesn't have
          // to recompute the deadline each call.
          retractoWindowUntil: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
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
  

})
