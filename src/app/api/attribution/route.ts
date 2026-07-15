import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recomputeAttributionWeights, getCreditedRevenueByAd, AttributionModel } from '@/lib/attribution/engine'

// GET /api/attribution?tenantId=...&model=last_click|first_click|linear|time_decay
// Returns credited revenue per ad using the selected attribution model.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const model = (req.nextUrl.searchParams.get('model') || 'last_click') as AttributionModel
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

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
export async function POST(req: NextRequest) {
  const { tenantId, model } = await req.json()
  if (!tenantId || !model) return NextResponse.json({ error: 'tenantId and model required' }, { status: 400 })

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
      meta: JSON.stringify(result),
    },
  })

  return NextResponse.json({ ...result, model })
}
