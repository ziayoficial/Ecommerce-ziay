import { NextRequest, NextResponse } from 'next/server'
import { resolveTenantId } from '@/lib/auth-helpers'
import { withCache } from '@/lib/cache'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { overviewService } from '@/lib/services'

// Overview KPIs: revenue, orders, conversations, ad spend, ROAS, CPA, channel split.
// Cached for 60s per (tenantId, days) — heavy multi-table aggregation that
// doesn't need to be re-run on every page reload. Cache key includes the
// tenantId to avoid cross-tenant data leaks.
//
// SPRINT8-SERVICES-REST-001 — migrated the inline `computeOverview` body
// (4 parallel findMany + per-channel/day aggregation) to
// `overviewService.getKPIs`. Response shape unchanged; the service returns
// the exact `{ range, kpis, channelSplit, series }` payload the route was
// already producing.
//
// FIX-SECURITY-AUTH-001 (#28) — tenantId is resolved + verified against
// the caller's session. Tenant users are pinned to their own tenantId
// (cross-tenant attempts return 403); platform admins can pass any
// tenantId or omit it for the legacy "all tenants" view.
//
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapped with `withErrorHandling` so any
// unhandled exception is funneled through Sentry + the structured pino
// logger. The previous manual `try/catch` boilerplate (captureError +
// NextResponse.json 500) is now the wrapper's responsibility.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error

  const days = Number(req.nextUrl.searchParams.get('days') || '14')

  const payload = await withCache(
    `overview:${tenantId ?? 'all'}:${days}`,
    60_000,
    () => overviewService.getKPIs(days, tenantId),
  )
  return NextResponse.json(payload)
})
