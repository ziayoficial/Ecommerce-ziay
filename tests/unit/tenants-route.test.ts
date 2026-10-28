// Unit tests for src/app/api/tenants/route.ts — per-session role filter
// TASK: AUDIT-CYCLE-4-M1
//
// The docstring promised "platform admins see all; tenant users see only
// their own" but the code returned the full cached tenant list (with
// internal config fields) to ANY authenticated user of ANY role. The fix
// filters per session AFTER the 5-min cached fetch (so no cache key can
// leak a filtered list across sessions).

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock: auth-helpers ───────────────────────────────────────────────────
const { authMock } = vi.hoisted(() => ({
  authMock: { requireAuth: vi.fn() },
}))
vi.mock('@/lib/auth-helpers', () => authMock)

// ── Mock: services (tenantsService) ─────────────────────────────────────
const { tenantsServiceMock } = vi.hoisted(() => ({
  tenantsServiceMock: { listActiveTenants: vi.fn() },
}))
vi.mock('@/lib/services', () => ({ tenantsService: tenantsServiceMock }))

// ── Mock: logger + Sentry (withErrorHandling imports them) ──────────────
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
import { GET } from '@/app/api/tenants/route'

const ALL_TENANTS = [
  { id: 'ten-a', slug: 'a', nombreNegocio: 'A', marca: 'A', planMonetizacion: 'conecta', proveedorIa: 'zai', proveedorLogistico: 'dropi', plataformaCatalogo: 'woocommerce', politicaPago: 'híbrido' },
  { id: 'ten-b', slug: 'b', nombreNegocio: 'B', marca: 'B', planMonetizacion: 'completo', proveedorIa: 'chatgpt', proveedorLogistico: '99envios', plataformaCatalogo: 'shopify', politicaPago: 'anticipado' },
]

beforeEach(() => {
  vi.clearAllMocks()
  tenantsServiceMock.listActiveTenants.mockResolvedValue(ALL_TENANTS)
})

describe('GET /api/tenants · per-session role filter (AUDIT-CYCLE-4-M1)', () => {
  it('returns ONLY the caller tenant when the session is tenant-bound', async () => {
    authMock.requireAuth.mockResolvedValue({
      session: { user: { id: 'u1', tenantId: 'ten-a', role: 'agent' } },
      error: null,
    })

    const res = await GET(undefined as never, undefined as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tenants: typeof ALL_TENANTS }
    expect(body.tenants).toHaveLength(1)
    expect(body.tenants[0].id).toBe('ten-a')

    // The full list is still fetched from the (shared) cache — the
    // filter must run per session, not per fetch.
    expect(tenantsServiceMock.listActiveTenants).toHaveBeenCalledTimes(1)
  })

  it('returns the full list when the session is a platform user (tenantId null)', async () => {
    authMock.requireAuth.mockResolvedValue({
      session: { user: { id: 'u1', tenantId: null, role: 'trafficker' } },
      error: null,
    })

    const res = await GET(undefined as never, undefined as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tenants: typeof ALL_TENANTS }
    expect(body.tenants).toHaveLength(2)
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.requireAuth.mockResolvedValue({
      session: null,
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const res = await GET(undefined as never, undefined as never)
    expect(res.status).toBe(401)
    expect(tenantsServiceMock.listActiveTenants).not.toHaveBeenCalled()
  })
})
