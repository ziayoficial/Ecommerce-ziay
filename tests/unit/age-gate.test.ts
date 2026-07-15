// Unit tests for src/lib/compliance/age-gate.ts
// TASK: SPRINT-TESTS-001
//
// Covers:
//   - calculateAge (pure — birthday-this-year check)
//   - isMinor (pure — null birthDate → false)
//   - AGE_OF_MAJORITY constant (=18 per Ley 1098 de 2006 Art 17)
//   - checkAgeGate (DB-backed — looks up Customer, persists the isMinor flag
//     on first detection, fails CLOSED on DB errors)
//   - requireParentalConsent (DB-backed — looks for an active
//     parental_consent_minor ConsentRecord)
//
// The age gate is a COPPA + Ley 1098 control — regressions here are a legal
// exposure (processing a minor's PII without parental consent).

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    consentRecord: {
      findFirst: vi.fn(),
    },
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

// Stub logger.
const { loggerMock } = vi.hoisted(() => {
  const m = {
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

import {
  calculateAge,
  isMinor,
  checkAgeGate,
  requireParentalConsent,
  AGE_OF_MAJORITY,
} from '@/lib/compliance/age-gate'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// AGE_OF_MAJORITY constant
// ─────────────────────────────────────────────────────────────────────────────
describe('AGE_OF_MAJORITY', () => {
  it('equals 18 (Ley 1098 de 2006 Art 17)', () => {
    expect(AGE_OF_MAJORITY).toBe(18)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// calculateAge
// ─────────────────────────────────────────────────────────────────────────────
describe('calculateAge', () => {
  it('calculates age correctly for a 25-year-old', () => {
    const birth = new Date('2000-01-01')
    const age = calculateAge(birth)
    // Birthdate is 2000-01-01, today is at least 2025 → age >= 25.
    expect(age).toBeGreaterThanOrEqual(25)
  })

  it('calculates age correctly for a 15-year-old', () => {
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 15)
    const age = calculateAge(birth)
    // Birthday is "today minus 15 years" — age should be 14 or 15 depending
    // on whether the birthday has passed this year. Both are < 18.
    expect(age).toBeLessThanOrEqual(15)
    expect(age).toBeGreaterThanOrEqual(14)
  })

  it('returns 0 for a birth date today', () => {
    const birth = new Date()
    const age = calculateAge(birth)
    expect(age).toBe(0)
  })

  it('handles the birthday-eve case (birthday is tomorrow → still N-1)', () => {
    // Birthdate: tomorrow, 20 years ago.
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setFullYear(tomorrow.getFullYear() - 20)
    const age = calculateAge(tomorrow)
    // Birthday hasn't passed yet this year → age is 19 (not 20).
    expect(age).toBe(19)
  })

  it('handles the birthday-today case (turning 18 today → age=18)', () => {
    // Birthdate: exactly 18 years ago today.
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 18)
    const age = calculateAge(birth)
    expect(age).toBe(18)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isMinor
// ─────────────────────────────────────────────────────────────────────────────
describe('isMinor', () => {
  it('returns true for a 15-year-old (clearly a minor)', () => {
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 15)
    expect(isMinor(birth)).toBe(true)
  })

  it('returns false for a 25-year-old (clearly an adult)', () => {
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 25)
    expect(isMinor(birth)).toBe(false)
  })

  it('returns false for an 18-year-old (boundary: 18 is NOT a minor)', () => {
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 18)
    expect(isMinor(birth)).toBe(false)
  })

  it('returns true for a 17-year-old (boundary: 17 IS a minor)', () => {
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 17)
    // Note: if today is the birthday, age becomes 18. Adjust to ensure 17.
    // We subtract 17 years AND add 1 day to ensure birthday hasn't passed.
    birth.setDate(birth.getDate() + 1)
    expect(isMinor(birth)).toBe(true)
  })

  it('returns false for null birthDate (unknown age — assume adult)', () => {
    expect(isMinor(null)).toBe(false)
  })

  it('returns false for undefined birthDate (defensive)', () => {
    expect(isMinor(undefined as unknown as null)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// checkAgeGate
// ─────────────────────────────────────────────────────────────────────────────
describe('checkAgeGate', () => {
  it('returns { allowed: true } for an adult customer (birthDate 25 years ago)', async () => {
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 25)
    db.customer.findUnique.mockResolvedValue({
      birthDate: birth,
      isMinor: false,
    })

    const result = await checkAgeGate('cus-1')

    expect(result).toEqual({ allowed: true })
    expect(db.customer.findUnique).toHaveBeenCalledWith({
      where: { id: 'cus-1' },
      select: { birthDate: true, isMinor: true },
    })
    // No flag persist needed — customer is already an adult.
    expect(db.customer.update).not.toHaveBeenCalled()
  })

  it('returns { allowed: false, isMinor: true } for an explicitly-flagged minor', async () => {
    db.customer.findUnique.mockResolvedValue({
      birthDate: null,
      isMinor: true,
    })

    const result = await checkAgeGate('cus-2')

    expect(result.allowed).toBe(false)
    expect(result.isMinor).toBe(true)
    expect(result.reason).toContain('Ley 1098/2006 Art 17')
    // Hard-block path: no flag persistence needed (already flagged).
    expect(db.customer.update).not.toHaveBeenCalled()
  })

  it('blocks + persists the isMinor flag when birthDate resolves to < 18', async () => {
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 15)
    db.customer.findUnique.mockResolvedValue({
      birthDate: birth,
      isMinor: false, // not yet flagged — gate should derive + persist
    })
    db.customer.update.mockResolvedValue({ id: 'cus-3' })

    const result = await checkAgeGate('cus-3')

    expect(result.allowed).toBe(false)
    expect(result.isMinor).toBe(true)
    expect(result.reason).toContain('menor de edad')

    // The flag was persisted so subsequent reads are O(1) — and so a
    // birthday-eve bypass cannot reset it.
    expect(db.customer.update).toHaveBeenCalledWith({
      where: { id: 'cus-3' },
      data: { isMinor: true },
    })
  })

  it('still blocks (in-memory) when the isMinor persist fails', async () => {
    const birth = new Date()
    birth.setFullYear(birth.getFullYear() - 15)
    db.customer.findUnique.mockResolvedValue({
      birthDate: birth,
      isMinor: false,
    })
    db.customer.update.mockRejectedValue(new Error('db down'))

    const result = await checkAgeGate('cus-4')

    // Fail-safe: the in-memory check already determined the customer is a minor.
    // The persist failure is captured but NOT surfaced — the gate still blocks.
    expect(result.allowed).toBe(false)
    expect(result.isMinor).toBe(true)
  })

  it('returns { allowed: false, reason } when the customer does not exist', async () => {
    db.customer.findUnique.mockResolvedValue(null)

    const result = await checkAgeGate('cus-ghost')

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('Cliente no encontrado')
    expect(result.isMinor).toBeUndefined()
  })

  it('returns { allowed: true } for an unknown-age customer (null birthDate + null isMinor)', async () => {
    db.customer.findUnique.mockResolvedValue({
      birthDate: null,
      isMinor: null,
    })

    const result = await checkAgeGate('cus-unknown')
    expect(result).toEqual({ allowed: true })
  })

  it('fails CLOSED on DB errors (returns allowed=false with a Spanish reason)', async () => {
    db.customer.findUnique.mockRejectedValue(new Error('db down'))

    const result = await checkAgeGate('cus-err')

    // Fail CLOSED — better to lose a sale than process a minor's PII without consent.
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('No se pudo validar')
    expect(result.isMinor).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// requireParentalConsent
// ─────────────────────────────────────────────────────────────────────────────
describe('requireParentalConsent', () => {
  it('returns { verified: true } when an active parental_consent_minor ConsentRecord exists', async () => {
    db.consentRecord.findFirst.mockResolvedValue({
      id: 'cr-1',
      grantedAt: new Date('2025-01-01'),
    })

    const result = await requireParentalConsent('cus-1')

    expect(result).toEqual({ verified: true })
    expect(db.consentRecord.findFirst).toHaveBeenCalledWith({
      where: {
        dataSubjectId: 'cus-1',
        dataSubjectType: 'customer',
        purpose: 'parental_consent_minor',
        granted: true,
        revokedAt: null,
      },
      select: { id: true, grantedAt: true },
    })
  })

  it('returns { verified: false, reason } when no active consent exists', async () => {
    db.consentRecord.findFirst.mockResolvedValue(null)

    const result = await requireParentalConsent('cus-2')

    expect(result.verified).toBe(false)
    expect(result.reason).toContain('consentimiento de padre/madre/tutor')
    expect(result.reason).toContain('Ley 1098/2006 Art 17')
  })

  it('fails CLOSED on DB errors (returns verified=false)', async () => {
    db.consentRecord.findFirst.mockRejectedValue(new Error('db'))

    const result = await requireParentalConsent('cus-3')

    expect(result.verified).toBe(false)
    expect(result.reason).toContain('No se pudo validar')
  })
})
