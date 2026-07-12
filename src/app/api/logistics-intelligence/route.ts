import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'

// Logistics Intelligence — CustomerScore, CarrierScore, GuideTracking,
// GuideMovement, BuyerBehavior, BehaviorAlert.
//
// GET /api/logistics-intelligence?tenantId=X
// Returns:
//   customerScores, carrierScores, stuckGuides, alerts (with buyerBehavior),
//   stats { confiables, riesgo, devolvedores, stuckCount }
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const [customerScores, carrierScores, stuckGuides, alerts] = await Promise.all([
    db.customerScore.findMany({
      where: { tenantId },
      orderBy: { score: 'desc' },
    }),
    db.carrierScore.findMany({
      where: { tenantId },
      orderBy: { score: 'desc' },
    }),
    db.guideTracking.findMany({
      where: {
        tenantId,
        OR: [{ status: 'stuck' }, { daysStuck: { gt: 3 } }],
      },
      orderBy: { daysStuck: 'desc' },
      take: 100,
    }),
    db.behaviorAlert.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  // BehaviorAlert has no Prisma relation to BuyerBehavior (schema uses a raw
  // `buyerBehaviorId` String), so we manually hydrate the behaviors in a
  // single round-trip.
  const behaviorIds = Array.from(
    new Set(alerts.map((a) => a.buyerBehaviorId).filter(Boolean)),
  )
  const behaviors = behaviorIds.length
    ? await db.buyerBehavior.findMany({ where: { id: { in: behaviorIds } } })
    : []
  const behaviorMap = new Map(behaviors.map((b) => [b.id, b]))
  const alertsWithBehavior = alerts.map((a) => ({
    ...a,
    buyerBehavior: a.buyerBehaviorId ? behaviorMap.get(a.buyerBehaviorId) ?? null : null,
  }))

  const confiables = customerScores.filter(
    (c) => c.category === 'confiable' || c.score >= 50,
  ).length
  const riesgo = customerScores.filter(
    (c) => c.category === 'riesgo' || (c.score >= 1 && c.score < 50),
  ).length
  const devolvedores = customerScores.filter(
    (c) => c.category === 'devolvedor' || c.score === 0,
  ).length
  const stuckCount = stuckGuides.length

  return NextResponse.json({
    customerScores,
    carrierScores,
    stuckGuides,
    alerts: alertsWithBehavior,
    stats: {
      confiables,
      riesgo,
      devolvedores,
      stuckCount,
      totalCustomers: customerScores.length,
      totalCarriers: carrierScores.length,
      totalAlerts: alerts.length,
    },
  })
}
