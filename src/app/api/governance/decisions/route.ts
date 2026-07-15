import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTenantId } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/governance/decisions')

// GET /api/governance/decisions?tenantId=X&agentName=Y&orderId=Z&conversationId=W
// Lista los DecisionLog del tenant, opcionalmente filtrados.
// Documento §11 pilar #4: "Trazabilidad de decisiones del agente".
/**
 * GET /api/governance/decisions
 *
 * List governance DecisionLog entries (verifiable intent audit trail).
 *
 * @security Requires authentication + tenant access
 * @returns Decision log list
 */
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

    const agentName = req.nextUrl.searchParams.get('agentName') || undefined
    const orderId = req.nextUrl.searchParams.get('orderId') || undefined
    const conversationId =
      req.nextUrl.searchParams.get('conversationId') || undefined
    const mandateId = req.nextUrl.searchParams.get('mandateId') || undefined
    const humanReviewedRaw =
      req.nextUrl.searchParams.get('humanReviewed') || undefined
    const humanReviewed =
      humanReviewedRaw === 'true'
        ? true
        : humanReviewedRaw === 'false'
          ? false
          : undefined

    const decisions = await db.decisionLog.findMany({
      where: {
        // Platform admins (no tenantId on session) → list across tenants
        // when no specific tenantId is provided. Tenant users → scoped.
        ...(tenantId ? { tenantId } : {}),
        ...(agentName ? { agentName } : {}),
        ...(orderId ? { orderId } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(mandateId ? { mandateId } : {}),
        ...(humanReviewed !== undefined ? { humanReviewed } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({
      decisions: decisions.map((d) => ({
        id: d.id,
        tenantId: d.tenantId,
        agentName: d.agentName,
        conversationId: d.conversationId,
        orderId: d.orderId,
        mandateId: d.mandateId,
        input: d.input ? safeJson(d.input) : null,
        output: d.output ? safeJson(d.output) : null,
        reasoning: d.reasoning ? safeJson(d.reasoning) : null,
        confidence: d.confidence,
        enforcementResult: d.enforcementResult
          ? safeJson(d.enforcementResult)
          : null,
        liabilityParty: d.liabilityParty,
        humanReviewed: d.humanReviewed,
        humanDecision: d.humanDecision,
        humanReviewerId: d.humanReviewerId,
        humanReviewedAt: d.humanReviewedAt,
        createdAt: d.createdAt,
      })),
    })
  

})

// POST /api/governance/decisions
// Crea un DecisionLog. Llamado internamente por el runner del agente
// (/api/agents/[agentName]) y por cualquier otro componente que ejecute
// agentes y quiera dejar trazabilidad.
//
// Body:
//   { tenantId, agentName, conversationId?, orderId?, mandateId?,
//     input, output, reasoning?, confidence?,
//     enforcementResult?, liabilityParty? }
const CreateSchema = z.object({
  tenantId: z.string().min(1),
  agentName: z.string().min(1),
  conversationId: z.string().optional(),
  orderId: z.string().optional(),
  mandateId: z.string().optional(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  reasoning: z.unknown().optional(),
  confidence: z.number().min(0).max(1).optional(),
  enforcementResult: z.unknown().optional(),
  liabilityParty: z.string().optional(),
})

/**
 * POST /api/governance/decisions
 *
 * Record a new governance decision (escalation, age-gate override, mandate enforcement).
 *
 * @security Requires authentication + tenant access
 * @returns Created decision record
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = CreateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { error } = await resolveTenantId(body.tenantId)
  if (error) return error

    const created = await db.decisionLog.create({
      data: {
        tenantId: body.tenantId,
        agentName: body.agentName,
        conversationId: body.conversationId,
        orderId: body.orderId,
        mandateId: body.mandateId,
        input: JSON.stringify(body.input),
        output: JSON.stringify(body.output),
        reasoning:
          body.reasoning !== undefined ? JSON.stringify(body.reasoning) : null,
        confidence: body.confidence,
        enforcementResult:
          body.enforcementResult !== undefined
            ? JSON.stringify(body.enforcementResult)
            : null,
        liabilityParty: body.liabilityParty,
      },
    })

    log.info(
      { decisionId: created.id, agentName: body.agentName, tenantId: body.tenantId },
      'DecisionLog creado',
    )

    return NextResponse.json(
      {
        id: created.id,
        tenantId: created.tenantId,
        agentName: created.agentName,
        createdAt: created.createdAt,
      },
      { status: 201 },
    )
  

})

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
