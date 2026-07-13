import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { withCache } from '@/lib/cache'
import { captureError } from '@/lib/capture-error'
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
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const days = Number(req.nextUrl.searchParams.get('days') || '14')
    const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined

    const payload = await withCache(
      `overview:${tenantId ?? 'all'}:${days}`,
      60_000,
      () => overviewService.getKPIs(days, tenantId),
    )
    return NextResponse.json(payload)
  } catch (err) {
    captureError(err as Error, { path: '/api/overview', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
