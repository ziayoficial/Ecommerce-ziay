import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { logisticsService } from '@/lib/services'

const BuyerBehaviorSchema = z.object({
  tenantId: z.string().min(1),
  phone: z.string().min(1),
  riskLevel: z.enum(['normal', 'caution', 'high_risk', 'blacklist']),
  patternDetails: z.string().nullable().optional(),
})

// GET /api/buyer-behavior?tenantId=X
// Devuelve los BuyerBehavior del tenant + conteos por nivel de riesgo.
//
// SPRINT8-SERVICES-REST-001 — migrated `db.buyerBehavior.findMany` +
// `groupBy` to `logisticsService.getBuyerBehaviors`. Response shape
// unchanged (`{ behaviors, stats }`).
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId is required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    const { behaviors, stats } = await logisticsService.getBuyerBehaviors(tenantId)
    return NextResponse.json({ behaviors, stats })
  } catch (err) {
    captureError(err as Error, { path: '/api/buyer-behavior', method: 'GET', tenantId })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

// POST /api/buyer-behavior
// Body: { tenantId, phone, riskLevel, patternDetails }
// Upserta el BuyerBehavior para (tenantId, phone). Si riskLevel='high_risk' o
// 'blacklist', crea además un BehaviorAlert para que el equipo revise.
//
// SPRINT8-SERVICES-REST-001 — migrated the upsert + conditional alert
// create (2 db calls + 1 conditional) to
// `logisticsService.upsertBuyerBehavior`. Response shape unchanged
// (`{ behavior, alert }`).
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 60,
    windowMs: 60_000,
    namespace: 'api:buyer-behavior:post',
  })
  if (limited) return limited

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = BuyerBehaviorSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const { tenantId, phone, riskLevel, patternDetails } = parseResult.data

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    const { behavior, alert } = await logisticsService.upsertBuyerBehavior({
      tenantId,
      phone: String(phone),
      riskLevel,
      patternDetails: patternDetails ?? null,
    })
    return NextResponse.json({ behavior, alert })
  } catch (err) {
    captureError(err as Error, { path: '/api/buyer-behavior', method: 'POST', tenantId })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
