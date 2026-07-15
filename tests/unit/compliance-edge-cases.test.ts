// Unit tests for compliance modules — edge cases.
// TASK: SPRINT-E2E-TESTS-001 · §2
//
// Covers edge cases of the 4 compliance modules flagged by
// AUDIT-LEGAL-COMPLIANCE-001 that the existing unit tests don't exercise:
//
//   1. `src/lib/compliance/age-gate.ts`     — null birthDate, birthday-today,
//      birthday-eve (17 not 18), Feb 29 leap year.
//   2. `src/lib/compliance/retracto.ts`     — 5-day window boundaries
//      (just-inside / just-outside / exactly-at-boundary). Ley 1480 Art 47.
//   3. `src/lib/compliance/dian-invoicing.ts` — CUFE determinism, sensitivity,
//      SHA-384 length. Decreto 745 de 2014.
//   4. Consent revocation — DELETE /api/compliance/consent sets
//      `granted=false` + `revokedAt=now` + `revokeReason`. Ley 1581 de 2012.
//   5. `src/lib/llm/budget.ts` — fail-open on DB error (serves users over
//      blocking LLM traffic) + blocks when daily budget exceeded.
//
// Mock strategy mirrors `age-gate.test.ts` + `notification.service.test.ts`:
// `vi.hoisted` + top-level `vi.mock('@/lib/db', ...)` (NOT in-test `vi.mock`
// which Vitest hoists and would silently lose the factory). The spec's
// `vi.mock` inside `it()` blocks doesn't work in Vitest — `vi.mock` is
// transformed to a hoisted top-level call by Vitest's compiler, so factories
// declared inside `it()` either lose scope or fire before the test sets them
// up. We declare all mocks at the file top + override per-test with
// `mockResolvedValue` / `mockResolvedValueOnce` + `beforeEach(vi.clearAllMocks)`.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// Shared mocks — db, logger, Sentry, auth-helpers.
// ─────────────────────────────────────────────────────────────────────────────

const { db } = vi.hoisted(() => {
  const mockDb = {
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    consentRecord: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    setting: { findFirst: vi.fn() },
    decisionLog: { aggregate: vi.fn() },
  }
  return { db: mockDb }
})
vi.mock('@/lib/db', () => ({ db }))

const { authMock } = vi.hoisted(() => ({
  authMock: {
    requireAuth: vi.fn(),
    requireTenantAccess: vi.fn(),
    resolveTenantId: vi.fn(),
  },
}))
vi.mock('@/lib/auth-helpers', () => authMock)

const { loggerMock } = vi.hoisted(() => {
  const m = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => m),
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

// `computeHash` is a pure SHA-256 helper — letting the real implementation
// run keeps the consent-revocation test honest (it uses `proofHash` for
// evidence integrity). No mock needed.

// ─────────────────────────────────────────────────────────────────────────────
// Imports — modules under test. After all `vi.mock` calls so the mocks
// intercept their `@/lib/db` / `@/lib/auth-helpers` / `@/lib/logger` imports.
// ─────────────────────────────────────────────────────────────────────────────

import { calculateAge, isMinor } from '@/lib/compliance/age-gate'
import {
  isWithinRetractoWindow,
  calculateRetractoDeadline,
} from '@/lib/compliance/retracto'
import { calculateCUFE } from '@/lib/compliance/dian-invoicing'
import {
  checkBudgetBeforeCall,
  invalidateBudgetCache,
} from '@/lib/llm/budget'
// `DELETE` route handler — exercises the real consent revocation logic.
import { DELETE as consentDelete } from '@/app/api/compliance/consent/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Budget module has an in-memory cache (5 min daily, 15 min monthly).
  // Clear it so each test sees a fresh DB read.
  invalidateBudgetCache()
})

// ─────────────────────────────────────────────────────────────────────────────
// §1 — Age Gate edge cases (Ley 1098 de 2006 Art 17)
// ─────────────────────────────────────────────────────────────────────────────

describe('Age Gate Edge Cases', () => {
  it('handles null birthDate as adult (unknown age → assume adult but flag)', () => {
    // Policy: NULL birthDate + NULL isMinor → assume adult. Caller is
    // responsible for surfacing a separate "verify your age" UI.
    expect(isMinor(null)).toBe(false)
  })

  it('handles birthday exactly today (age = 0)', () => {
    // Birthdate = today (timeless). calculateAge uses the
    // "birthday-this-year has passed" check — today's date IS the
    // birthday, so age is 0 (just born).
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const age = calculateAge(today)
    expect(age).toBe(0)
  })

  it('handles birthday tomorrow 18 years ago (still 17 — birthday eve)', () => {
    // Birthdate: tomorrow, 18 years ago. Birthday hasn't passed yet this
    // year → age is 17 (not 18). isMinor returns true.
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setFullYear(tomorrow.getFullYear() - 18)
    expect(isMinor(tomorrow)).toBe(true) // Still 17 until tomorrow
  })

  it('handles Feb 29 birthdate (leap year) without crashing', () => {
    // Feb 29 only exists in leap years. The age calc uses Date arithmetic
    // which normalizes Feb 29 → Mar 1 in non-leap years, but calculateAge
    // doesn't care — it compares month + day directly.
    const leapYearBirth = new Date('2000-02-29')
    const age = calculateAge(leapYearBirth)
    // Born in 2000 → age is at least 20 by 2020 (any current year >= 2020).
    expect(age).toBeGreaterThan(20)
  })

  it('calculateAge returns -1 for future birthDates (known limitation — caller must guard)', () => {
    // The implementation does NOT defensively clamp to 0 for future dates.
    // For a birthDate 5 days in the future with the same year:
    //   - year diff = 0
    //   - monthDiff = 0
    //   - today.getDate() < birthDate.getDate() → age-- → age = -1
    // Callers that accept user-supplied birthDates (e.g. KYC forms) must
    // guard `birthDate <= today` BEFORE calling calculateAge. Documenting
    // the actual behavior here so a future "fix" that adds the clamp is
    // an intentional change, not a silent regression.
    const future = new Date()
    future.setDate(future.getDate() + 5)
    const age = calculateAge(future)
    expect(age).toBe(-1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Retracto edge cases (Ley 1480 de 2011 Art 47 — 5-day window)
// ─────────────────────────────────────────────────────────────────────────────

describe('Retracto Edge Cases', () => {
  it('rejects retracto after 5-day window (6 days ago)', () => {
    // 6 days ago → deadline = 6 days ago + 5 days = "yesterday" → past.
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    expect(isWithinRetractoWindow(sixDaysAgo)).toBe(false)
  })

  it('accepts retracto within 5-day window (3 days ago)', () => {
    // 3 days ago → deadline = 3 days ago + 5 days = "in 2 days" → future.
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    expect(isWithinRetractoWindow(threeDaysAgo)).toBe(true)
  })

  it('accepts retracto just inside the 5-day boundary (5 days minus 1 second)', () => {
    // 5 days minus 1 second ago → deadline is 1 second in the future →
    // `new Date() <= deadline` is true. (We use 5d - 1s instead of exactly
    // 5d to avoid the millisecond-level race condition where the function
    // executes after the deadline has elapsed by a few µs.)
    const justInside = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000 - 1000))
    expect(isWithinRetractoWindow(justInside)).toBe(true)
  })

  it('rejects retracto just outside the 5-day boundary (5 days plus 1 second ago)', () => {
    // 5 days + 1 second ago → deadline is 1 second in the past → reject.
    // Math: `Date.now() - 5d - 1000ms` = "5 days + 1 second ago".
    // Deadline = that + 5 days = "1 second ago" → `new Date() > deadline` → false.
    const justOutside = new Date(Date.now() - 1000 - 5 * 24 * 60 * 60 * 1000)
    expect(isWithinRetractoWindow(justOutside)).toBe(false)
  })

  it('calculateRetractoDeadline adds exactly 5 calendar days', () => {
    // Pure-function check: deadline = createdAt + 5 days, to the millisecond.
    const createdAt = new Date('2026-01-10T12:00:00.000Z')
    const deadline = calculateRetractoDeadline(createdAt)
    const expected = new Date('2026-01-15T12:00:00.000Z')
    expect(deadline.getTime()).toBe(expected.getTime())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 — DIAN CUFE calculation edge cases (Decreto 745 de 2014)
// ─────────────────────────────────────────────────────────────────────────────

describe('DIAN CUFE Calculation Edge Cases', () => {
  it('generates consistent CUFE for the same input (determinism)', () => {
    const params = {
      invoiceNumber: 'SETP-0001',
      issueDate: new Date('2026-07-14T10:30:00Z'),
      total: 150000,
      emitterNit: '900123456',
      receiverNit: 'customer@email.com',
      softwareId: 'ZIAY-001',
      technicalNumber: 'TEC-123',
    }
    const cufe1 = calculateCUFE(params)
    const cufe2 = calculateCUFE(params)
    expect(cufe1).toBe(cufe2)
  })

  it('generates different CUFE for different totals (sensitivity)', () => {
    const base = {
      invoiceNumber: 'SETP-0001',
      issueDate: new Date('2026-07-14T10:30:00Z'),
      emitterNit: '900123456',
      receiverNit: 'customer@email.com',
      softwareId: 'ZIAY-001',
      technicalNumber: 'TEC-123',
    }
    const cufe1 = calculateCUFE({ ...base, total: 150000 })
    const cufe2 = calculateCUFE({ ...base, total: 150001 })
    expect(cufe1).not.toBe(cufe2)
  })

  it('produces a 96-char lowercase hex string (SHA-384 = 48 bytes = 96 hex chars)', () => {
    const cufe = calculateCUFE({
      invoiceNumber: 'SETP-0001',
      issueDate: new Date(),
      total: 100000,
      emitterNit: '900123456',
      receiverNit: '900654321',
      softwareId: 'ZIAY-001',
      technicalNumber: 'TEC-123',
    })
    expect(cufe).toHaveLength(96)
    expect(cufe).toMatch(/^[0-9a-f]+$/)
  })

  it('generates different CUFE for different issueDate (date+time is part of the input)', () => {
    const base = {
      invoiceNumber: 'SETP-0001',
      total: 100000,
      emitterNit: '900123456',
      receiverNit: '900654321',
      softwareId: 'ZIAY-001',
      technicalNumber: 'TEC-123',
    }
    const cufe1 = calculateCUFE({ ...base, issueDate: new Date('2026-07-14T10:30:00Z') })
    const cufe2 = calculateCUFE({ ...base, issueDate: new Date('2026-07-14T10:30:01Z') })
    expect(cufe1).not.toBe(cufe2)
  })

  it('includes invoiceNumber in the hash input (different number → different CUFE)', () => {
    const base = {
      issueDate: new Date('2026-07-14T10:30:00Z'),
      total: 100000,
      emitterNit: '900123456',
      receiverNit: '900654321',
      softwareId: 'ZIAY-001',
      technicalNumber: 'TEC-123',
    }
    const cufe1 = calculateCUFE({ ...base, invoiceNumber: 'SETP-0001' })
    const cufe2 = calculateCUFE({ ...base, invoiceNumber: 'SETP-0002' })
    expect(cufe1).not.toBe(cufe2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Consent Record revocation edge cases (Ley 1581 de 2012)
//
// Exercises the real DELETE /api/compliance/consent handler so the test
// verifies the actual revocation behavior (granted=false + revokedAt=now +
// revokeReason persisted). The spec's `vi.mock` inside an `it()` block
// doesn't work in Vitest (mocks are hoisted) — we mock at file top + invoke
// the real route handler instead.
// ─────────────────────────────────────────────────────────────────────────────

describe('Consent Record Edge Cases', () => {
  it('revoking consent sets granted=false + revokedAt + revokeReason', async () => {
    // Setup: existing consent for a customer that belongs to the caller's tenant.
    db.consentRecord.findUnique.mockResolvedValue({
      id: 'consent-1',
      tenantId: 'ten-1',
      dataSubjectId: 'cus-1',
      dataSubjectType: 'customer',
      purpose: 'marketing',
      granted: true,
    })
    db.customer.findFirst.mockResolvedValue({ id: 'cus-1', tenantId: 'ten-1' })
    authMock.requireAuth.mockResolvedValue({
      session: { user: { id: 'u-1', tenantId: 'ten-1', role: 'admin' } },
      error: null,
    })
    authMock.requireTenantAccess.mockResolvedValue({ session: {}, error: null })

    // Capture the update payload so we can assert on the revokedAt field
    // (which is `new Date()` at call time — we can't predict the exact value).
    let capturedUpdate: { where: { id: string }; data: Record<string, unknown> } | null = null
    db.consentRecord.update.mockImplementation(({ where, data }) => {
      capturedUpdate = { where, data }
      return Promise.resolve({ id: where.id, ...data })
    })

    // Invoke the real DELETE handler — exercise the production revocation path.
    const req = new NextRequest(
      new URL('http://localhost:3000/api/compliance/consent?id=consent-1&reason=user%20request'),
    )
    const res = await consentDelete(req, undefined as never)
    expect(res.status).toBe(200)

    // The handler called db.consentRecord.update with the revocation payload.
    expect(db.consentRecord.update).toHaveBeenCalledTimes(1)
    expect(capturedUpdate).not.toBeNull()
    expect(capturedUpdate!.where.id).toBe('consent-1')
    expect(capturedUpdate!.data.granted).toBe(false)
    expect(capturedUpdate!.data.revokeReason).toBe('user request')
    expect(capturedUpdate!.data.revokedAt).toBeInstanceOf(Date)

    // The response body reflects the revoked state.
    const body = await res.json()
    expect(body.consentId).toBe('consent-1')
    expect(body.granted).toBe(false)
    // NextResponse.json serializes Date → ISO string.
    expect(typeof body.revokedAt).toBe('string')
    expect(() => new Date(body.revokedAt)).not.toThrow()
    expect(body.reason).toBe('user request')
  })

  it('returns 400 when no id is provided (defensive)', async () => {
    authMock.requireAuth.mockResolvedValue({ session: {}, error: null })
    const req = new NextRequest(
      new URL('http://localhost:3000/api/compliance/consent'),
    )
    const res = await consentDelete(req, undefined as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/id es requerido/i)
  })

  it('returns 404 when the consent record does not exist', async () => {
    authMock.requireAuth.mockResolvedValue({ session: {}, error: null })
    db.consentRecord.findUnique.mockResolvedValue(null)
    const req = new NextRequest(
      new URL('http://localhost:3000/api/compliance/consent?id=consent-ghost'),
    )
    const res = await consentDelete(req, undefined as never)
    expect(res.status).toBe(404)
    // No update call on a 404.
    expect(db.consentRecord.update).not.toHaveBeenCalled()
  })

  it('defaults the reason to "Revocado por el titular" when omitted', async () => {
    db.consentRecord.findUnique.mockResolvedValue({
      id: 'consent-2',
      tenantId: 'ten-1',
      dataSubjectId: 'cus-2',
      dataSubjectType: 'user', // bypass the customer-tenant check
      granted: true,
    })
    authMock.requireAuth.mockResolvedValue({
      session: { user: { id: 'u-1', tenantId: 'ten-1', role: 'admin' } },
      error: null,
    })
    authMock.requireTenantAccess.mockResolvedValue({ session: {}, error: null })

    db.consentRecord.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    )

    // No `reason` query param — the route should fall back to the default.
    const req = new NextRequest(
      new URL('http://localhost:3000/api/compliance/consent?id=consent-2'),
    )
    const res = await consentDelete(req, undefined as never)
    expect(res.status).toBe(200)
    expect(db.consentRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'consent-2' },
        data: expect.objectContaining({
          granted: false,
          revokeReason: 'Revocado por el titular',
          revokedAt: expect.any(Date),
        }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §5 — LLM Budget edge cases (fail-open + exceeded)
// ─────────────────────────────────────────────────────────────────────────────

describe('Budget Edge Cases', () => {
  it('fails open when DB is unavailable (allows the LLM call)', async () => {
    // Simulate DB outage: setting.findFirst + decisionLog.aggregate reject.
    // The budget module's policy is fail-open — better to serve the user
    // than to block all LLM traffic over a transient DB issue. Over-spend
    // is bounded by the cache TTL (5 min daily, 15 min monthly) and
    // detected on the next successful check.
    db.setting.findFirst.mockRejectedValue(new Error('DB unavailable'))
    db.decisionLog.aggregate.mockRejectedValue(new Error('DB unavailable'))

    const result = await checkBudgetBeforeCall('ten-fail-open')

    // Fail-open: allow the call. `remaining: Infinity` signals "could not
    // verify — assuming unlimited".
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(Infinity)
    // No message — fail-open doesn't surface a user-facing warning.
    expect(result.message).toBeUndefined()
  })

  it('blocks when daily budget is exceeded (spent > budget)', async () => {
    // $10 daily budget (from Setting), $15.50 already spent today.
    // `getTenantBudget` calls `setting.findFirst` THEN `decisionLog.aggregate`.
    db.setting.findFirst.mockResolvedValue({ value: '10' })
    db.decisionLog.aggregate.mockResolvedValue({ _sum: { costUsd: 15.50 } })

    const result = await checkBudgetBeforeCall('ten-exceeded')

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    // Message format: `Presupuesto diario de LLM excedido ($15.5000/$10.00). Reinicia mañana.`
    expect(result.message).toMatch(/excedido/i)
    expect(result.message).toContain('15.5000')
    expect(result.message).toContain('10.00')
  })

  it('blocks when monthly budget is exceeded (daily still has room)', async () => {
    // Daily: $10 budget, $5 spent → daily OK.
    // Monthly: $50 budget, $75 spent → monthly blocked.
    // `checkBudgetBeforeCall` checks daily first (passes), then monthly (fails).
    // We use mockResolvedValueOnce so the 2 setting.findFirst calls return
    // different values (daily first, monthly second) and the 2 aggregate
    // calls return different spent totals.
    db.setting.findFirst
      .mockResolvedValueOnce({ value: '10' }) // daily budget
      .mockResolvedValueOnce({ value: '50' }) // monthly budget
    db.decisionLog.aggregate
      .mockResolvedValueOnce({ _sum: { costUsd: 5 } }) // daily spent
      .mockResolvedValueOnce({ _sum: { costUsd: 75 } }) // monthly spent

    const result = await checkBudgetBeforeCall('ten-monthly-exceeded')

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.message).toMatch(/mensual.*excedido|excedido.*mensual/i)
  })

  it('allows when both daily and monthly budgets have room', async () => {
    db.setting.findFirst
      .mockResolvedValueOnce({ value: '10' }) // daily
      .mockResolvedValueOnce({ value: '200' }) // monthly
    db.decisionLog.aggregate
      .mockResolvedValueOnce({ _sum: { costUsd: 3 } }) // daily spent
      .mockResolvedValueOnce({ _sum: { costUsd: 50 } }) // monthly spent

    const result = await checkBudgetBeforeCall('ten-healthy')

    expect(result.allowed).toBe(true)
    // `remaining` is Math.min(daily, monthly) = Math.min(7, 150) = 7.
    expect(result.remaining).toBe(7)
    expect(result.message).toBeUndefined()
  })

  it('falls back to the default budget when Setting is missing', async () => {
    // No Setting row → `findFirst` returns null → module falls back to
    // DEFAULT_DAILY_BUDGET_USD ($10) and DEFAULT_MONTHLY_BUDGET_USD ($200).
    db.setting.findFirst.mockResolvedValue(null)
    db.decisionLog.aggregate.mockResolvedValue({ _sum: { costUsd: 0 } })

    const result = await checkBudgetBeforeCall('ten-defaults')

    expect(result.allowed).toBe(true)
    // Daily remaining = $10 - $0 = $10. Monthly remaining = $200 - $0 = $200.
    // Math.min(10, 200) = 10.
    expect(result.remaining).toBe(10)
  })
})
