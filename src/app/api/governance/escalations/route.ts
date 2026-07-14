import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTenantId, requireAuth } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/governance/escalations')

// GET /api/governance/escalations?tenantId=X
// Lista las sesiones de checkout UCP en estado `requires_escalation` del
// tenant. Documento §11 pilar #2: "Reglas de escalamiento a humano" — el
// operador humano consulta esta cola para aprobar/rechazar cada caso.
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  if (!tenantIdParam) {
    return NextResponse.json(
      { error: 'tenantId requerido' },
      { status: 400 },
    )
  }
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error

    const sessions = await db.ucpCheckoutSession.findMany({
      where: {
        // Platform admins (no tenantId on session) → list across tenants
        // when no specific tenantId is provided. Tenant users → scoped.
        ...(tenantId ? { tenantId } : {}),
        state: 'requires_escalation',
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        sessionId: true,
        tenantId: true,
        intentMandateId: true,
        cartMandateId: true,
        paymentMandateId: true,
        cart: true,
        continuationUrl: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
    })

    return NextResponse.json({
      escalations: sessions.map((s) => ({
        ...s,
        cart: s.cart ? JSON.parse(s.cart) : null,
      })),
    })
  

})

// POST /api/governance/escalations
// Aprueba o rechaza una escalación.
// Body: { sessionId, decision: 'approve' | 'reject', reason? }
//   - approve → avanza la sesión a `ready_for_complete`
//   - reject  → setea la sesión a `failed` + AuditLog
const DecisionSchema = z.object({
  sessionId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().min(1).max(500).optional(),
})

export const POST = withErrorHandling(async (req: NextRequest) => {

  const { session: authSession } = await requireAuth()
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // V7 (AUDIT-FINAL-SEC-001): role gate — only admin / finance / support
  // can approve or reject escalations. Previously any authed tenant user
  // could approve their own escalation.
  const role = authSession.user.role
  if (role !== 'admin' && role !== 'finance' && role !== 'support') {
    return NextResponse.json(
      { error: 'Forbidden: solo admin, finance o support pueden decidir escalaciones' },
      { status: 403 },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = DecisionSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

    const existing = await db.ucpCheckoutSession.findUnique({
      where: { sessionId: body.sessionId },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Sesión de checkout no encontrada' },
        { status: 404 },
      )
    }

    // Tenant guard — platform admins (no tenantId on session) bypass.
    const userTenantId = authSession.user.tenantId ?? null
    if (userTenantId && userTenantId !== existing.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    if (existing.state !== 'requires_escalation') {
      return NextResponse.json(
        {
          error: `La sesión no está en requires_escalation (estado actual: ${existing.state})`,
        },
        { status: 409 },
      )
    }

    const reviewerId = authSession.user.id ?? null
    const reason = body.reason ?? (body.decision === 'approve' ? 'Aprobado por revisor humano' : 'Rechazado por revisor humano')

    if (body.decision === 'approve') {
      const updated = await db.ucpCheckoutSession.update({
        where: { sessionId: body.sessionId },
        data: { state: 'ready_for_complete' },
      })
      await db.auditLog.create({
        data: {
          tenantId: existing.tenantId,
          userId: reviewerId,
          action: 'governance.escalation.approved',
          entity: 'UcpCheckoutSession',
          entityId: existing.id,
          metadata: JSON.stringify({
            sessionId: existing.sessionId,
            reason,
            previousState: 'requires_escalation',
            newState: 'ready_for_complete',
          }),
        },
      })
      log.info(
        { sessionId: body.sessionId, reviewerId },
        'Escalación aprobada → ready_for_complete',
      )
      return NextResponse.json({
        sessionId: body.sessionId,
        state: updated.state,
        decision: 'approve',
        reason,
      })
    }

    // reject
    const updated = await db.ucpCheckoutSession.update({
      where: { sessionId: body.sessionId },
      data: { state: 'failed' },
    })
    await db.auditLog.create({
      data: {
        tenantId: existing.tenantId,
        userId: reviewerId,
        action: 'governance.escalation.rejected',
        entity: 'UcpCheckoutSession',
        entityId: existing.id,
        metadata: JSON.stringify({
          sessionId: existing.sessionId,
          reason,
          previousState: 'requires_escalation',
          newState: 'failed',
        }),
      },
    })
    log.info(
      { sessionId: body.sessionId, reviewerId },
      'Escalación rechazada → failed',
    )
    return NextResponse.json({
      sessionId: body.sessionId,
      state: updated.state,
      decision: 'reject',
      reason,
    })
  

})
