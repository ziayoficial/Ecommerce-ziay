// Unit tests for src/app/api/agents/traces/route.ts — platform-admin gate
// TASK: AUDIT-CYCLE-4-M2
//
// Traces are cross-tenant and carry PII (agent input contains customer
// message text). The file documents "restricted to platform admins" but
// the guard was requireRole(['admin']) alone — a tenant-bound admin could
// read every other tenant's traces. The fix 403s tenant-bound admins;
// platform admins (tenantId null) keep access.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock: auth-helpers (requireRole) ─────────────────────────────────────
const { authMock } = vi.hoisted(() => ({
  authMock: { requireRole: vi.fn() },
}))
vi.mock('@/lib/auth-helpers', () => authMock)

// ── Mock: agent tracer (in-memory store) ─────────────────────────────────
const { tracerMock } = vi.hoisted(() => ({
  tracerMock: { getRecentTraces: vi.fn() },
}))
vi.mock('@/lib/agents/tracing', () => ({ agentTracer: tracerMock }))

// ── Mock: logger + Sentry (withErrorHandling imports them) ───────────────
const { loggerMock } = vi.hoisted(() => {
  const m: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
    child: () => unknown
  } = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => m,
  }
  return { loggerMock: m }
})
vi.mock('@/lib/logger', () => ({
  getLogger: () => loggerMock,
  logger: loggerMock,
  default: loggerMock,
}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

// ── Import the route handler AFTER all mocks are in place ────────────────
import { GET } from '@/app/api/agents/traces/route'

const TRACES = [
  { agentName: 'quote', tenantId: 'ten-a', conversationId: 'c1' },
  { agentName: 'profile', tenantId: 'ten-b', conversationId: 'c2' },
]

function buildReq(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/agents/traces${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  tracerMock.getRecentTraces.mockReturnValue(TRACES)
})

describe('GET /api/agents/traces · platform-admin gate (AUDIT-CYCLE-4-M2)', () => {
  it('403s when the admin is tenant-bound (cross-tenant PII)', async () => {
    authMock.requireRole.mockResolvedValue({
      session: { user: { id: 'u1', role: 'admin', tenantId: 'ten-a' } },
      error: null,
    })

    const res = await GET(buildReq(), undefined as never)
    expect(res.status).toBe(403)
    expect(tracerMock.getRecentTraces).not.toHaveBeenCalled()
  })

  it('200s with traces when the admin is a platform admin (tenantId null)', async () => {
    authMock.requireRole.mockResolvedValue({
      session: { user: { id: 'u1', role: 'admin', tenantId: null } },
      error: null,
    })

    const res = await GET(buildReq(), undefined as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { traces: typeof TRACES; count: number }
    expect(body.traces).toHaveLength(2)
    expect(body.count).toBe(2)
  })

  it('filters by agentName for platform admins', async () => {
    authMock.requireRole.mockResolvedValue({
      session: { user: { id: 'u1', role: 'admin', tenantId: null } },
      error: null,
    })

    const res = await GET(buildReq('?agentName=quote'), undefined as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { traces: typeof TRACES }
    expect(body.traces).toHaveLength(1)
    expect(body.traces[0].agentName).toBe('quote')
  })

  it('passes the auth error through when the caller is not admin', async () => {
    const { NextResponse } = await import('next/server')
    authMock.requireRole.mockResolvedValue({
      session: null,
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    })

    const res = await GET(buildReq(), undefined as never)
    expect(res.status).toBe(403)
  })
})
