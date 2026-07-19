// ZIAY — /api/agents/traces (admin-only)
//
// IA-2 (agent-hardening) — surfaces the in-memory trace store for live
// debugging. Returns the N most recent traces across all tenants, with
// optional `?limit=` (default 50, max 200) and `?agentName=` filter.
//
// Auth: admin-only. Traces include `tenantId`, `conversationId`, agent
// input (which may contain PII like customer message text), and token/cost
// data — restricted to platform admins.
//
// Note: this endpoint reads from the in-memory `Map` (1h TTL). For
// historical queries beyond 1h, hit the `DecisionLog` table directly
// via `/api/governance/decisions` (already exists). The two are
// complementary — this endpoint is for "what's happening right now?".

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { agentTracer } from '@/lib/agents/tracing'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(async (req: NextRequest) => {
  const { error } = await requireRole(['admin'])
  if (error) return error

  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50, 1),
    200,
  )
  const agentName = req.nextUrl.searchParams.get('agentName') || undefined

  const traces = agentTracer.getRecentTraces(limit)
  const filtered = agentName ? traces.filter((t) => t.agentName === agentName) : traces

  return NextResponse.json({
    traces: filtered,
    count: filtered.length,
    window: '1h in-memory TTL',
  })
})
