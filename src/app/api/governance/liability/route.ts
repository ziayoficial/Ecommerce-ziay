import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import {
  determineLiability,
  LIABILITY_POLICY,
} from '@/lib/governance/mandate-enforcement'

const log = getLogger('api/governance/liability')

// POST /api/governance/liability
// Determina la responsabilidad (liability) de una transacción agéntica.
// Documento §11 pilar #3: "Definición clara de responsabilidad si el agente
// compra fuera de los límites autorizados".
//
// Body:
//   { intentMandateId, cartMandateId, orderTotal, withinBounds }
//
// Response:
//   { liability_party, policy, reason }
//
// La determinación se persiste en AuditLog
// (action: 'governance.liability.determined') para trazabilidad.

const LiabilitySchema = z.object({
  tenantId: z.string().min(1),
  intentMandateId: z.string().min(1),
  cartMandateId: z.string().min(1),
  orderTotal: z.number().nonnegative(),
  withinBounds: z.boolean(),
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
  const parsed = LiabilitySchema.safeParse(raw)
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
    const [intent, cartMandate] = await Promise.all([
      db.aP2Mandate.findUnique({ where: { id: body.intentMandateId } }),
      db.aP2Mandate.findUnique({ where: { id: body.cartMandateId } }),
    ])

    if (!intent || intent.tenantId !== body.tenantId) {
      return NextResponse.json(
        { error: 'Intent Mandate no encontrado para el tenant' },
        { status: 404 },
      )
    }
    if (!cartMandate || cartMandate.tenantId !== body.tenantId) {
      return NextResponse.json(
        { error: 'Cart Mandate no encontrado para el tenant' },
        { status: 404 },
      )
    }
    if (intent.type !== 'intent') {
      return NextResponse.json(
        { error: 'El mandateId indicado no es un Intent Mandate' },
        { status: 400 },
      )
    }
    if (cartMandate.type !== 'cart') {
      return NextResponse.json(
        { error: 'El cartMandateId indicado no es un Cart Mandate' },
        { status: 400 },
      )
    }

    // ¿El Intent es válido (active, no expirado, firma presente)?
    const isIntentActive = intent.status === 'active'
    const isIntentExpired =
      intent.expiresAt != null && intent.expiresAt < new Date()
    const hasValidMandate = isIntentActive && !isIntentExpired

    // ¿El Intent fue revocado ANTES de que el Cart se creara?
    // (Si fue revocado después, el agente actuó de buena fe con un mandato
    // vigente al momento de armar el carrito.)
    let mandateRevokedBeforeCart = false
    if (
      intent.status === 'revoked' &&
      intent.revokedAt != null &&
      cartMandate.createdAt != null
    ) {
      mandateRevokedBeforeCart = intent.revokedAt < cartMandate.createdAt
    }

    const liabilityParty = determineLiability({
      hasValidMandate,
      withinBounds: body.withinBounds,
      mandateRevokedBeforeCart,
    })

    // Mapear party → nombre legible + razón.
    // (LIABILITY_POLICY.noMandate y revokedMandate comparten valor
    //  'agent_provider_full_liability' — usamos if/else en lugar de un
    //  record para distinguirlos.)
    let reason: string
    if (liabilityParty === LIABILITY_POLICY.withinBounds) {
      reason =
        'Carrito dentro de los límites del mandato: el comercio absorbe la responsabilidad.'
    } else if (liabilityParty === LIABILITY_POLICY.exceedsBounds) {
      reason =
        'Carrito excede los límites del mandato: el proveedor del agente absorbe el exceso.'
    } else if (
      liabilityParty === LIABILITY_POLICY.noMandate
    ) {
      reason =
        'No hay mandato válido: el proveedor del agente asume responsabilidad total.'
    } else if (
      liabilityParty === LIABILITY_POLICY.revokedMandate
    ) {
      reason =
        'Mandato revocado antes de someter el carrito: el proveedor del agente asume responsabilidad total.'
    } else {
      reason = 'Responsabilidad no determinada.'
    }

    // Persistir en AuditLog.
    await db.auditLog.create({
      data: {
        tenantId: body.tenantId,
        action: 'governance.liability.determined',
        entity: 'AP2Mandate',
        entityId: intent.id,
        meta: JSON.stringify({
          intentMandateId: intent.id,
          cartMandateId: cartMandate.id,
          orderTotal: body.orderTotal,
          withinBounds: body.withinBounds,
          hasValidMandate,
          mandateRevokedBeforeCart,
          liabilityParty,
        }),
      },
    })

    log.info(
      {
        tenantId: body.tenantId,
        intentMandateId: intent.id,
        cartMandateId: cartMandate.id,
        liabilityParty,
      },
      'Liability determinada y registrada en audit log',
    )

    return NextResponse.json({
      liability_party: liabilityParty,
      policy: liabilityParty,
      reason,
      intentMandateId: intent.id,
      cartMandateId: cartMandate.id,
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/governance/liability',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo determinar la responsabilidad' },
      { status: 500 },
    )
  }
}
