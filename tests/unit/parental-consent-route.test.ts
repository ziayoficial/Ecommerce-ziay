// Unit tests for src/app/api/compliance/parental-consent/route.ts
// TASK: AUDIT-CYCLE-4-H3
//
// AUDIT-CYCLE-4-H3 closed a High compliance finding: the parental-consent
// flow (Ley 1098/2006 Art 17) was broken end-to-end — the public form had
// no action, /api/compliance/consent rejected the `parental_consent_minor`
// purpose and required a session the anonymous tutor doesn't have. NOTHING
// could create the ConsentRecord that the age-gate expects.
//
// This suite exercises the real route handler (only I/O edges mocked):
//   - Zod validation rejects incomplete/explicit-consent-missing bodies
//   - Only customers flagged isMinor=true qualify (no existence oracle)
//   - Happy path persists purpose='parental_consent_minor' with the tutor
//     document HASHED (never raw) in the proof payload
//   - Idempotent re-submission returns 200 without a duplicate record
//   - The route-level CSRF + rate-limit guards short-circuit before any
//     DB access

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mock: DB ─────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => ({
  db: {
    customer: { findFirst: vi.fn() },
    consentRecord: { findFirst: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({ db }))

// ── Mock: CSRF (route-level guard — public routes bypass middleware) ────
const { csrfMock } = vi.hoisted(() => ({
  csrfMock: { checkCSRF: vi.fn() },
}))
vi.mock('@/lib/middleware/csrf', () => csrfMock)

// ── Mock: rate-limit (bypass in-memory state by default) ─────────────────
const { rateLimitMock } = vi.hoisted(() => ({
  // Typed as `NextResponse | null` so tests can mockReturnValue a 429.
  rateLimitMock: { rateLimit: vi.fn((): NextResponse | null => null) },
}))
vi.mock('@/lib/middleware/rate-limit', () => rateLimitMock)

// ── Mock: logger ─────────────────────────────────────────────────────────
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

// ── Mock: Sentry (withErrorHandling imports it) ─────────────────────────
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

// ── Import the route handler AFTER all mocks are in place ────────────────
// NOTE: '@/lib/crypto/signing' (computeHash) is NOT mocked — the real
// SHA-256 runs so the test asserts the actual proof hash/payload shape.
import { POST } from '@/app/api/compliance/parental-consent/route'

// ── Helpers ──────────────────────────────────────────────────────────────
const RAW_DOC = '1020304050'

function buildReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/compliance/parental-consent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'vitest-suite',
    },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  customerId: 'cust-minor-1',
  tutorName: 'María Fernanda Gómez',
  tutorDocumentId: RAW_DOC,
  relationship: 'madre',
  consent: true,
}

// ── Test setup ───────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()

  // Default: guards pass.
  csrfMock.checkCSRF.mockReturnValue(null)
  rateLimitMock.rateLimit.mockReturnValue(null)

  // Default: the customer is a flagged minor on tenant 'ten-1'.
  db.customer.findFirst.mockResolvedValue({
    id: 'cust-minor-1',
    tenantId: 'ten-1',
  })

  // Default: no prior active consent.
  db.consentRecord.findFirst.mockResolvedValue(null)

  db.consentRecord.create.mockResolvedValue({
    id: 'consent-1',
    grantedAt: new Date(),
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/compliance/parental-consent · validation', () => {
  it('400s when the body is missing required fields', async () => {
    const res = await POST(buildReq({ customerId: 'cust-minor-1' }), undefined as never)
    expect(res.status).toBe(400)
    expect(db.consentRecord.create).not.toHaveBeenCalled()
  })

  it('400s when consent is not explicitly true (checkbox unticked)', async () => {
    const res = await POST(buildReq({ ...VALID_BODY, consent: false }), undefined as never)
    expect(res.status).toBe(400)
    expect(db.consentRecord.create).not.toHaveBeenCalled()
  })

  it('400s on invalid JSON body', async () => {
    const req = new NextRequest(
      'http://localhost/api/compliance/parental-consent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json{',
      },
    )
    const res = await POST(req, undefined as never)
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Customer gate — only flagged minors qualify
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/compliance/parental-consent · customer gate', () => {
  it('404s when the customer is not found (isMinor filter applied)', async () => {
    db.customer.findFirst.mockResolvedValue(null)
    const res = await POST(buildReq(VALID_BODY), undefined as never)
    expect(res.status).toBe(404)
    // The query must filter by isMinor: true — no existence oracle for
    // arbitrary (adult) customers.
    expect(db.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cust-minor-1', isMinor: true }),
      }),
    )
    expect(db.consentRecord.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Happy path — ConsentRecord shape expected by the age-gate
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/compliance/parental-consent · happy path', () => {
  it('201s and persists purpose=parental_consent_minor with the tutor document HASHED', async () => {
    const res = await POST(buildReq(VALID_BODY), undefined as never)
    expect(res.status).toBe(201)

    expect(db.consentRecord.create).toHaveBeenCalledTimes(1)
    const arg = db.consentRecord.create.mock.calls[0][0] as {
      data: Record<string, unknown>
    }

    // Shape expected by requireParentalConsent (age-gate) + UCP checkout.
    expect(arg.data.purpose).toBe('parental_consent_minor')
    expect(arg.data.dataSubjectId).toBe('cust-minor-1')
    expect(arg.data.dataSubjectType).toBe('customer')
    expect(arg.data.legalBasis).toBe('consent')
    expect(arg.data.granted).toBe(true)
    expect(arg.data.tenantId).toBe('ten-1')
    expect(typeof arg.data.proofHash).toBe('string')
    expect(arg.data.proofHash).toBeTruthy()

    // Ley 1581 PII minimization: the raw document must NEVER appear in
    // the stored proof payload — only its hash.
    const proofJson = arg.data.proofPayload as string
    expect(proofJson).not.toContain(RAW_DOC)
    const proof = JSON.parse(proofJson) as {
      tutorDocumentHash: string
      tutorName: string
      relationship: string
      ip: string
      userAgent: string
      consentAt: string
    }
    expect(proof.tutorDocumentHash).toBeTruthy()
    expect(proof.tutorDocumentHash).not.toBe(RAW_DOC)
    expect(proof.tutorName).toBe('María Fernanda Gómez')
    expect(proof.relationship).toBe('madre')
    expect(proof.userAgent).toBe('vitest-suite')
    expect(typeof proof.consentAt).toBe('string')
  })

  it('200s without creating a duplicate when an active consent already exists (idempotent)', async () => {
    db.consentRecord.findFirst.mockResolvedValue({
      id: 'consent-existing',
      grantedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const res = await POST(buildReq(VALID_BODY), undefined as never)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { alreadyRegistered: boolean; consentId: string }
    expect(body.alreadyRegistered).toBe(true)
    expect(body.consentId).toBe('consent-existing')
    expect(db.consentRecord.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Route-level guards (public route → CSRF + rate limit run INSIDE)
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/compliance/parental-consent · guards', () => {
  it('403s on CSRF origin mismatch before any DB access', async () => {
    csrfMock.checkCSRF.mockReturnValue(
      NextResponse.json({ error: 'CSRF' }, { status: 403 }),
    )
    const res = await POST(buildReq(VALID_BODY), undefined as never)
    expect(res.status).toBe(403)
    expect(db.customer.findFirst).not.toHaveBeenCalled()
  })

  it('429s when the anonymous rate limit is exceeded before any DB access', async () => {
    rateLimitMock.rateLimit.mockReturnValue(
      NextResponse.json({ error: 'Too Many Requests' }, { status: 429 }),
    )
    const res = await POST(buildReq(VALID_BODY), undefined as never)
    expect(res.status).toBe(429)
    expect(db.customer.findFirst).not.toHaveBeenCalled()
  })
})
