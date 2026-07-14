import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { monetizationService } from '@/lib/services'

// GET /api/monetization/gmv?tenantId=...&period=2026-07
// Returns GMV (sum of orders with origen='agente_whatsapp'), commission recognized,
// pending commission, current tramo, fee base, and projected invoice total.
//
// SPRINT7-POSTGRES-SERVICES-001 — migrated the inline tenant/order/invoice
// queries to `monetizationService.getGMV(tenantId)`. The service returns
// the exact same response shape; the route still owns HTTP concerns
// (auth, 400/404 handling, error capture). Response shape is unchanged.
//
// FIX-SECURITY-AUTH-001 (#27) — requireTenantAccess(tenantId). Any authed
// user used to be able to read any tenant's financial GMV.
//
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapped with `withErrorHandling` so any
// unhandled exception is funneled through Sentry + the structured pino
// logger.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const payload = await monetizationService.getGMV(tenantId)
  if (!payload) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  return NextResponse.json(payload)
})
