import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/governance/decisions/[id]')

// GET /api/governance/decisions/[id]
// Devuelve un DecisionLog específico.
export const GET = withErrorHandling(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {

  const { id } = await params
  const { error } = await requireAuth()
  if (error) return error

    const decision = await db.decisionLog.findUnique({ where: { id } })
    if (!decision) {
      return NextResponse.json(
        { error: 'DecisionLog no encontrado' },
        { status: 404 },
      )
    }

    // Tenant guard — platform admins (no tenantId on session) bypass.
    const { session: userSession } = await requireAuth()
    const userTenantId = userSession?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== decision.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    return NextResponse.json({
      decision: {
        id: decision.id,
        tenantId: decision.tenantId,
        agentName: decision.agentName,
        conversationId: decision.conversationId,
        orderId: decision.orderId,
        mandateId: decision.mandateId,
        input: safeJson(decision.input),
        output: safeJson(decision.output),
        reasoning: decision.reasoning ? safeJson(decision.reasoning) : null,
        confidence: decision.confidence,
        enforcementResult: decision.enforcementResult
          ? safeJson(decision.enforcementResult)
          : null,
        liabilityParty: decision.liabilityParty,
        humanReviewed: decision.humanReviewed,
        humanDecision: decision.humanDecision,
        humanReviewerId: decision.humanReviewerId,
        humanReviewedAt: decision.humanReviewedAt,
        createdAt: decision.createdAt,
      },
    })
  

})

// PATCH /api/governance/decisions/[id]
// Marca un DecisionLog como revisado por humano (approve/reject/modify).
// Body: { humanDecision: 'approved' | 'rejected' | 'modified', reviewerId?, note? }
const PatchSchema = z.object({
  humanDecision: z.enum(['approved', 'rejected', 'modified']),
  reviewerId: z.string().optional(),
  note: z.string().max(500).optional(),
})

export const PATCH = withErrorHandling(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {

  const { id } = await params
  const { session: authSession, error } = await requireAuth()
  if (error) return error

  // V7 (AUDIT-FINAL-SEC-001): role gate — only admin / finance / support
  // can mark a DecisionLog as reviewed. Previously any authed tenant user
  // could approve their own escalation.
  const role = authSession?.user?.role
  if (role !== 'admin' && role !== 'finance' && role !== 'support') {
    return NextResponse.json(
      { error: 'Forbidden: solo admin, finance o support pueden revisar decisiones' },
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
  const parsed = PatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

    const existing = await db.decisionLog.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'DecisionLog no encontrado' },
        { status: 404 },
      )
    }

    // Tenant guard.
    const userTenantId = authSession?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== existing.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    const reviewerId = body.reviewerId ?? authSession?.user?.id ?? null
    const updated = await db.decisionLog.update({
      where: { id },
      data: {
        humanReviewed: true,
        humanDecision: body.humanDecision,
        humanReviewerId: reviewerId,
        humanReviewedAt: new Date(),
      },
    })

    // AuditLog entry for the human review.
    await db.auditLog.create({
      data: {
        tenantId: existing.tenantId,
        userId: reviewerId,
        action: 'governance.decision.reviewed',
        entity: 'DecisionLog',
        entityId: existing.id,
        metadata: JSON.stringify({
          agentName: existing.agentName,
          humanDecision: body.humanDecision,
          note: body.note ?? null,
        }),
      },
    })

    log.info(
      { decisionId: id, humanDecision: body.humanDecision, reviewerId },
      'DecisionLog revisado por humano',
    )

    return NextResponse.json({
      id: updated.id,
      humanReviewed: updated.humanReviewed,
      humanDecision: updated.humanDecision,
      humanReviewerId: updated.humanReviewerId,
      humanReviewedAt: updated.humanReviewedAt,
    })
  

})

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
