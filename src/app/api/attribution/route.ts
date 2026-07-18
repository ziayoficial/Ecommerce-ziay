import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recomputeAttributionWeights, getCreditedRevenueByAd, AttributionModel } from '@/lib/attribution/engine'
import { requireTenantAccess } from '@/lib/auth-helpers'

// GET /api/attribution?tenantId=...&model=last_click|first_click|linear|time_decay
// Returns credited revenue per ad using the selected attribution model.
//
// SECURITY · IF-2 · S-6 — cross-tenant bypass closed. The `tenantId` query
// param is gated by `requireTenantAccess`.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const model = (req.nextUrl.searchParams.get('model') || 'last_click') as AttributionModel
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  // IF-2 · S-6 — verify the caller may access this tenant before reading revenue.
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const validModels: AttributionModel[] = ['last_click', 'first_click', 'linear', 'time_decay']
  if (!validModels.includes(model)) {
    return NextResponse.json({ error: `model must be one of: ${validModels.join(', ')}` }, { status: 400 })
  }

  const credited = await getCreditedRevenueByAd(tenantId, model)

  return NextResponse.json({
    model,
    tenantId,
    ads: credited,
    totalCreditedRevenue: credited.reduce((s, a) => s + a.creditedRevenue, 0),
  })
}

// POST /api/attribution
// Body: { tenantId, model } — recomputes all attribution weights using the given model.
//
// SECURITY · IF-2 · S-6 — cross-tenant bypass closed. The `tenantId` body
// param is gated by `requireTenantAccess` BEFORE `recomputeAttributionWeights`
// (which rewrites data) + AuditLog insert.
export async function POST(req: NextRequest) {
  const { tenantId, model } = await req.json()
  if (!tenantId || !model) return NextResponse.json({ error: 'tenantId and model required' }, { status: 400 })

  // IF-2 · S-6 — verify the caller may access this tenant before recomputing
  // attribution weights (data rewrite) and writing the AuditLog row.
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const validModels: AttributionModel[] = ['last_click', 'first_click', 'linear', 'time_decay']
  if (!validModels.includes(model)) {
    return NextResponse.json({ error: `model must be one of: ${validModels.join(', ')}` }, { status: 400 })
  }

  const result = await recomputeAttributionWeights(tenantId, model)

  await db.auditLog.create({
    data: {
      tenantId,
      action: `attribution.recomputed.${model}`,
      entity: 'Attribution',
      metadata: JSON.stringify(result),
    },
  })

  return NextResponse.json({ ...result, model })
}

