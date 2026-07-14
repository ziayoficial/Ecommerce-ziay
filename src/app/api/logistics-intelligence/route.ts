import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { logisticsService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// Logistics Intelligence — CustomerScore, CarrierScore, GuideTracking,
// GuideMovement, BuyerBehavior, BehaviorAlert.
//
// GET /api/logistics-intelligence?tenantId=X
// Returns:
//   customerScores, carrierScores, stuckGuides, alerts (with buyerBehavior),
//   stats { confiables, riesgo, devolvedores, stuckCount }
//
// SPRINT7-POSTGRES-SERVICES-001 — migrated the four parallel findMany calls
// + manual behavior hydration to `logisticsService.getDashboardData`.
// The service returns the exact same response shape; the route still owns
// HTTP concerns (auth, 400, error capture). Response shape is unchanged.
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

    const payload = await logisticsService.getDashboardData(tenantId)
    return NextResponse.json(payload)
  

})
