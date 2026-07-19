// ZIAY — /api/agents/traces/[conversationId]
//
// IA-2 (agent-hardening) — returns all traces for a single conversation,
// ordered by `startedAt` ascending (parent before children). Used by the
// dashboard to render the agent call tree for a conversation.
//
// Auth: any authed user with tenant access (`requireTenantAccess`).
// Tenant users can only see their own conversations — the trace's
// `tenantId` must match the session's `tenantId`. Platform admins can
// query any conversation.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { agentTracer } from '@/lib/agents/tracing'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ conversationId: string }> },
  ) => {
    const { error, session } = await requireAuth()
    if (error) return error

    const { conversationId } = await params
    const traces = agentTracer.getConversationTraces(conversationId)

    // Tenant isolation: if the session user is tenant-bound, they can
    // only see traces whose tenantId matches. Platform admins (no
    // tenantId on session) bypass.
    const userTenantId = session?.user?.tenantId ?? null
    const filtered = userTenantId
      ? traces.filter((t) => t.tenantId === userTenantId)
      : traces

    return NextResponse.json({
      conversationId,
      traces: filtered,
      count: filtered.length,
    })
  },
)
