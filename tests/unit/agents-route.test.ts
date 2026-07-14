// Unit tests for src/app/api/agents/[agentName]/route.ts
// TASK: SPRINT-AI-AGENTS-002 §4
//
// Contract tests for the agent route handler. Covers the two critical
// paths documented in FIX-AI-AGENTS-001 §A-3:
//   1. LLM call fails (timeout/provider error) → 200 + confidence=0.1 +
//      fallback reply + DecisionLog persisted with `error` field.
//   2. LLM call succeeds AND output validates against the Zod schema →
//      200 + confidence=0.8 + raw LLM reply forwarded + DecisionLog
//      persisted with usage/cost fields populated.
//
// Mock strategy:
//   - Mock `@/lib/llm/adapter` so we control `chat` per-test (success vs
//     failure, content shape).
//   - Mock `@/lib/db` with vi.fn delegates so we can assert
//     `decisionLog.create` is invoked with the right shape (cost/tokens
//     populated on success; null on failure).
//   - Mock `@/lib/auth-helpers` so `requireTenantAccess` returns a valid
//     session — the route's tenant gate passes without touching next-auth.
//   - Mock `@/lib/middleware/rate-limit` to bypass the in-memory limiter
//     (its state would leak across tests).
//   - Mock `@/lib/chat-emit` to no-op (otherwise the escalateLowConfidence
//     path issues a fetch to localhost:3003 which hangs in CI).
//   - Mock `@sentry/nextjs` + `@/lib/logger` so the `withErrorHandling`
//     wrapper's outer catch (used only for unexpected errors) doesn't
//     break on missing Sentry DSN or pino transports.
//
// We DO NOT mock `@/lib/agents/prompts` (buildAgentPrompt) — the real
// profile prompt builder runs and exercises its `db.tenant.findUnique`
// call against the mocked db. This keeps the test honest about the
// route → prompt → LLM → schema → persistence pipeline.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock: LLM adapter ────────────────────────────────────────────────────
const { chatMock } = vi.hoisted(() => ({
  chatMock: vi.fn(),
}))
vi.mock('@/lib/llm/adapter', () => ({
  chat: chatMock,
  // Re-export the type so the route's `import type` resolves. The mock
  // factory replaces the module — type imports are erased at runtime so
  // they don't need a runtime value, but we include them for safety.
}))

// ── Mock: DB ─────────────────────────────────────────────────────────────
// Only the delegates the route actually touches are mocked. The prompt
// builders for other agents (cart_builder, etc.) call db.product.findMany
// but we only exercise the `profile` agent in this suite.
const { db } = vi.hoisted(() => ({
  db: {
    tenant: { findUnique: vi.fn() },
    decisionLog: { create: vi.fn() },
    conversation: { update: vi.fn() },
    imageIdentification: { create: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({ db }))

// ── Mock: auth-helpers ───────────────────────────────────────────────────
// The real `requireTenantAccess` is async and returns `{ session, error }`.
// The route destructures `error` — so the mock must return an object with
// an `error: null` field, NOT just `null` itself.
const { authMock } = vi.hoisted(() => ({
  authMock: {
    requireTenantAccess: vi.fn(),
    requireAuth: vi.fn(),
  },
}))
vi.mock('@/lib/auth-helpers', () => authMock)

// ── Mock: rate-limit (bypass in-memory state) ────────────────────────────
const { rateLimitMock } = vi.hoisted(() => ({
  rateLimitMock: { rateLimit: vi.fn(() => null) },
}))
vi.mock('@/lib/middleware/rate-limit', () => rateLimitMock)

// ── Mock: chat-emit (avoid real fetch to localhost:3003) ─────────────────
const { emitMock } = vi.hoisted(() => ({
  emitMock: { emitToTenant: vi.fn() },
}))
vi.mock('@/lib/chat-emit', () => emitMock)

// ── Mock: logger (silence pino + avoid transport side-effects) ───────────
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

// ── Mock: Sentry (withErrorHandling imports it) ──────────────────────────
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

// ── Import the route handler AFTER all mocks are in place ────────────────
import { POST } from '@/app/api/agents/[agentName]/route'

// ── Helpers ──────────────────────────────────────────────────────────────
function buildReq(body: Record<string, unknown>, agentName: string): NextRequest {
  return new NextRequest(`http://localhost/api/agents/${agentName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── Test setup ───────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()

  // Default: tenant gate passes — admin user scoped to 'ten-1'.
  authMock.requireTenantAccess.mockResolvedValue({
    session: {
      user: { id: 'user-1', tenantId: 'ten-1', role: 'admin' },
    },
    error: null,
  })
  authMock.requireAuth.mockResolvedValue({
    session: {
      user: { id: 'user-1', tenantId: 'ten-1', role: 'admin' },
    },
    error: null,
  })

  // Default: tenant exists with the fields the profile prompt builder
  // (slug, preguntaPerfil) AND the route (proveedorIa) read.
  db.tenant.findUnique.mockResolvedValue({
    id: 'ten-1',
    slug: 'test-tenant',
    preguntaPerfil: '¿Para ti o para surtir tu negocio?',
    proveedorIa: 'zai',
  })

  // Default: decisionLog.create succeeds (returns the row shape the route
  // would get from Prisma — the route doesn't read the return value, but
  // resolving avoids an unhandled rejection).
  db.decisionLog.create.mockResolvedValue({ id: 'dl-1' })
})

// ─────────────────────────────────────────────────────────────────────────────
// Happy path: LLM responds, output validates against ProfileSchema.
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/agents/[agentName] · success path', () => {
  it('returns confidence=0.8 + raw LLM reply when output validates against the Zod schema', async () => {
    // The LLM returns valid ProfileSchema JSON. parseAgentOutput extracts
    // the JSON block and validates → confidence = 0.8 (§A-3).
    chatMock.mockResolvedValue({
      content: '{"tipo":"mayorista","confianza":0.8,"razon":"Compra 50+ unidades"}',
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      model: 'glm-4.6',
      provider: 'zai',
      raw: {},
    })

    const req = buildReq(
      { tenantId: 'ten-1', message: 'Hola, quiero 50 unidades' },
      'profile',
    )
    const res = await POST(req, {
      params: Promise.resolve({ agentName: 'profile' }),
    } as never)

    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      reply: string
      agent: string
      confidence: number
    }

    // Confidence 0.8 = JSON validated against ProfileSchema (§A-3).
    expect(data.confidence).toBe(0.8)
    expect(data.agent).toBe('profile')
    // The route forwards the raw LLM reply when validation passes — it
    // does NOT reshape it into an `output` field. Downstream consumers
    // (orchestrator, dashboard) re-parse the JSON themselves.
    expect(data.reply).toContain('"tipo":"mayorista"')

    // The route persisted a DecisionLog with usage + cost populated.
    expect(db.decisionLog.create).toHaveBeenCalledTimes(1)
    const createArgs = db.decisionLog.create.mock.calls[0][0] as {
      data: {
        agentName: string
        confidence: number
        totalTokens: number | null
        promptTokens: number | null
        completionTokens: number | null
        costUsd: number | null
        model: string | null
        provider: string | null
      }
    }
    expect(createArgs.data.agentName).toBe('profile')
    expect(createArgs.data.confidence).toBe(0.8)
    expect(createArgs.data.totalTokens).toBe(150)
    expect(createArgs.data.promptTokens).toBe(100)
    expect(createArgs.data.completionTokens).toBe(50)
    expect(createArgs.data.model).toBe('glm-4.6')
    expect(createArgs.data.provider).toBe('zai')
    // calculateCost('zai', {100, 50}) = 100/1000 * 0.002 + 50/1000 * 0.006
    //                                = 0.0002 + 0.0003 = 0.0005
    expect(createArgs.data.costUsd).toBe(0.0005)

    // No escalation emitted — confidence 0.8 >= 0.6 threshold (§A-3).
    expect(emitMock.emitToTenant).not.toHaveBeenCalled()
  })

  it('returns confidence=0.3 + fallback reply when LLM output fails schema validation', async () => {
    // The LLM returns valid JSON but `tipo` is not in the enum — Zod
    // rejects → confidence drops to 0.3 and the route serves the fallback.
    chatMock.mockResolvedValue({
      content: '{"tipo":"unknown","confianza":0.8,"razon":"bad enum"}',
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      model: 'glm-4.6',
      provider: 'zai',
      raw: {},
    })

    const req = buildReq({ tenantId: 'ten-1' }, 'profile')
    const res = await POST(req, {
      params: Promise.resolve({ agentName: 'profile' }),
    } as never)

    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      reply: string
      agent: string
      confidence: number
    }
    expect(data.confidence).toBe(0.3)
    // AGENT_FALLBACKS.profile = '¿Para ti o para surtir tu negocio?'
    expect(data.reply).toBe('¿Para ti o para surtir tu negocio?')

    // The escalation threshold is < 0.6 — confidence 0.3 escalates.
    expect(emitMock.emitToTenant).toHaveBeenCalledTimes(1)
    expect(emitMock.emitToTenant).toHaveBeenCalledWith(
      'ten-1',
      'agent:low_confidence',
      expect.objectContaining({
        agentName: 'profile',
        confidence: 0.3,
      }),
    )

    // DecisionLog still persisted with usage (the LLM DID respond, just
    // not validly — §A-6 says we always log usage when available).
    expect(db.decisionLog.create).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Failure path: LLM call rejects (timeout, network error, etc.).
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/agents/[agentName] · LLM failure path', () => {
  it('returns confidence=0.1 + fallback reply + error message when chat() rejects', async () => {
    chatMock.mockRejectedValue(new Error('LLM timeout (15s)'))

    const req = buildReq({ tenantId: 'ten-1', message: 'Hola' }, 'profile')
    const res = await POST(req, {
      params: Promise.resolve({ agentName: 'profile' }),
    } as never)

    // §A-3: failure returns 200 (NOT 500) — the agent still serves a
    // deterministic fallback so the conversation continues. The wrapper's
    // outer catch (500 + Sentry) is reserved for unexpected errors; LLM
    // timeouts are an expected failure mode of the agent pipeline.
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      reply: string
      agent: string
      confidence: number
      error?: string
    }

    expect(data.confidence).toBe(0.1)
    expect(data.agent).toBe('profile')
    expect(data.reply).toBe('¿Para ti o para surtir tu negocio?')
    expect(data.error).toBe('LLM timeout (15s)')

    // DecisionLog persisted even on failure — `humanReviewed: false` so
    // the governance UI can surface it for review (§A-3).
    expect(db.decisionLog.create).toHaveBeenCalledTimes(1)
    const createArgs = db.decisionLog.create.mock.calls[0][0] as {
      data: {
        confidence: number
        totalTokens: number | null
        costUsd: number | null
        model: string | null
        provider: string | null
      }
    }
    expect(createArgs.data.confidence).toBe(0.1)
    // llmResult was never assigned (chat rejected) → usage fields are null.
    expect(createArgs.data.totalTokens).toBeNull()
    expect(createArgs.data.costUsd).toBeNull()
    expect(createArgs.data.model).toBeNull()
    expect(createArgs.data.provider).toBeNull()

    // 0.1 < 0.6 → escalation emitted.
    expect(emitMock.emitToTenant).toHaveBeenCalledTimes(1)
    expect(emitMock.emitToTenant).toHaveBeenCalledWith(
      'ten-1',
      'agent:low_confidence',
      expect.objectContaining({
        agentName: 'profile',
        confidence: 0.1,
        error: 'LLM timeout (15s)',
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases: unknown agent, missing tenantId.
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/agents/[agentName] · input validation', () => {
  it('returns 400 for an unknown agent name', async () => {
    const req = buildReq({ tenantId: 'ten-1' }, 'does_not_exist')
    const res = await POST(req, {
      params: Promise.resolve({ agentName: 'does_not_exist' }),
    } as never)

    expect(res.status).toBe(400)
    // The LLM was never called for an invalid agent name.
    expect(chatMock).not.toHaveBeenCalled()
  })

  it('returns 400 when tenantId is missing from the body', async () => {
    const req = buildReq({ message: 'Hola' }, 'profile')
    const res = await POST(req, {
      params: Promise.resolve({ agentName: 'profile' }),
    } as never)

    expect(res.status).toBe(400)
    expect(chatMock).not.toHaveBeenCalled()
  })
})
