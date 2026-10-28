// Unit tests for src/app/api/integrations/credentials/route.ts — write guards
// TASK: AUDIT-CYCLE-4-M3
//
// Previously POST/DELETE (which write credentials for WhatsApp,
// MercadoPago, Stripe, etc.) validated the body with manual typeof checks
// and accepted ANY authenticated user — a tenant agent could overwrite or
// wipe the tenant's gateway credentials. The fix adds Zod schemas + a
// requireRole(['admin']) gate on both writes.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock: auth-helpers ───────────────────────────────────────────────────
const { authMock } = vi.hoisted(() => ({
  authMock: {
    requireAuth: vi.fn(),
    requireRole: vi.fn(),
  },
}))
vi.mock('@/lib/auth-helpers', () => authMock)

// ── Mock: services (credentials + namespace helpers) ────────────────────
const { credentialsServiceMock } = vi.hoisted(() => ({
  credentialsServiceMock: {
    listForNamespace: vi.fn(),
    getForIntegration: vi.fn(),
    upsertCredentialRow: vi.fn(),
    updateCredentialValue: vi.fn(),
    deleteCredentialRow: vi.fn(),
  },
}))
vi.mock('@/lib/services', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services')>(
    '@/lib/services',
  )
  return {
    ...actual,
    credentialsService: credentialsServiceMock,
    // Re-exported helpers used by the route — real implementations are
    // pure and safe; spread the actual module to keep them.
  }
})

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

// ── Import the route handlers AFTER all mocks are in place ───────────────
// NOTE: '@/lib/adapters/credential-fields' is NOT mocked — the real
// registry runs so the whitelist + unknown-integration paths are tested
// against the actual INTEGRATION_REGISTRY.
import { POST, DELETE } from '@/app/api/integrations/credentials/route'

function buildReq(method: 'POST' | 'DELETE', body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/integrations/credentials', {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function setRole(role: string, tenantId: string | null = 'ten-1') {
  const session = { user: { id: 'u1', role, tenantId } }
  // Honest mock: replicates the real requireRole semantics (403 when the
  // caller's role is not in the allowed list) instead of always passing.
  authMock.requireRole.mockImplementation(async (roles: string[]) => {
    if (!roles.includes(role)) {
      const { NextResponse } = await import('next/server')
      return {
        session: null,
        error: NextResponse.json(
          { error: 'Forbidden: insufficient role' },
          { status: 403 },
        ),
      }
    }
    return { session, error: null }
  })
  authMock.requireAuth.mockResolvedValue({ session, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  setRole('admin')
  credentialsServiceMock.getForIntegration.mockResolvedValue(null)
  credentialsServiceMock.upsertCredentialRow.mockResolvedValue(undefined)
})

describe('POST /api/integrations/credentials · admin-only write (AUDIT-CYCLE-4-M3)', () => {
  it('403s when the caller is a tenant agent (no credential overwrite)', async () => {
    setRole('agent')
    const res = await POST(buildReq('POST', {
      integration: 'mercadopago',
      fields: { accessToken: 'APP_USR-123' },
    }), undefined as never)
    expect(res.status).toBe(403)
    expect(credentialsServiceMock.upsertCredentialRow).not.toHaveBeenCalled()
  })

  it('400s on a body missing `fields` (Zod)', async () => {
    const res = await POST(buildReq('POST', { integration: 'mercadopago' }), undefined as never)
    expect(res.status).toBe(400)
    expect(credentialsServiceMock.upsertCredentialRow).not.toHaveBeenCalled()
  })

  it('400s on an integration id that is not in the registry', async () => {
    const res = await POST(buildReq('POST', {
      integration: 'not-a-real-integration',
      fields: { anything: 'x' },
    }), undefined as never)
    expect(res.status).toBe(400)
    expect(credentialsServiceMock.upsertCredentialRow).not.toHaveBeenCalled()
  })

  it('200s and persists for an admin, whitelisting fields against the registry', async () => {
    const res = await POST(buildReq('POST', {
      integration: 'mercadopago',
      fields: {
        accessToken: 'APP_USR-test-token',
        notARegistryField: 'dropped-by-whitelist',
      },
    }), undefined as never)
    expect(res.status).toBe(200)
    expect(credentialsServiceMock.upsertCredentialRow).toHaveBeenCalledTimes(1)

    const [ns, integration, json] = credentialsServiceMock.upsertCredentialRow
      .mock.calls[0] as [string, string, string]
    expect(integration).toBe('mercadopago')
    // Namespace derived from the session (auto-scoping, V5).
    expect(ns).toContain('ten-1')
    // Stuffed field must NOT be persisted (registry whitelist).
    const stored = JSON.parse(json) as Record<string, string>
    expect(stored.notARegistryField).toBeUndefined()
    expect(stored.accessToken).toBe('APP_USR-test-token')
    // Response is masked — never the raw secret.
    const body = (await res.json()) as { fields: Record<string, string> }
    expect(JSON.stringify(body)).not.toContain('APP_USR-test-token')
  })
})

describe('DELETE /api/integrations/credentials · admin-only write (AUDIT-CYCLE-4-M3)', () => {
  it('403s when the caller is a tenant agent', async () => {
    setRole('agent')
    const res = await DELETE(buildReq('DELETE', { integration: 'mercadopago' }), undefined as never)
    expect(res.status).toBe(403)
    expect(credentialsServiceMock.deleteCredentialRow).not.toHaveBeenCalled()
  })

  it('400s when `integration` is missing (Zod)', async () => {
    const res = await DELETE(buildReq('DELETE', {}), undefined as never)
    expect(res.status).toBe(400)
  })

  it('deletes the whole integration row for an admin', async () => {
    credentialsServiceMock.getForIntegration.mockResolvedValue({
      key: 'cred::ten-1::mercadopago',
      value: '{"accessToken":"x"}',
    })
    const res = await DELETE(buildReq('DELETE', { integration: 'mercadopago' }), undefined as never)
    expect(res.status).toBe(200)
    expect(credentialsServiceMock.deleteCredentialRow).toHaveBeenCalledTimes(1)
    const body = (await res.json()) as { deleted: string }
    expect(body.deleted).toBe('all')
  })
})
