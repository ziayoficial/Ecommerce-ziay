// Unit tests for src/lib/format.ts
// TASK: TESTS-CICD-001

import { describe, it, expect } from 'vitest'
import { formatCurrency, shortDate, shortTime } from '@/lib/format'

describe('formatCurrency', () => {
  it('formats COP as Colombian pesos (no decimals, es-CO locale)', () => {
    const out = formatCurrency(1500000, 'COP')
    // es-CO formats COP as "$ 1.500.000" (with non-breaking spaces / dots as thousands sep).
    expect(out).toMatch(/1\.500\.000/)
    expect(out).toContain('$')
  })

  it('formats small COP amounts without decimals', () => {
    const out = formatCurrency(49900, 'COP')
    expect(out).toMatch(/49\.900/)
  })

  it('formats 0 COP correctly', () => {
    const out = formatCurrency(0, 'COP')
    expect(out).toContain('0')
  })

  it('falls back to en-US formatting for non-COP currencies (USD)', () => {
    const out = formatCurrency(99.99, 'USD')
    // en-US formats USD as "$99.99"
    expect(out).toBe('$99.99')
  })

  it('supports compact mode for large COP amounts (M suffix)', () => {
    expect(formatCurrency(1_500_000, 'COP', { compact: true })).toBe('$1.5M')
    expect(formatCurrency(2_000_000, 'COP', { compact: true })).toBe('$2.0M')
  })

  it('supports compact mode for thousands (k suffix)', () => {
    expect(formatCurrency(5000, 'COP', { compact: true })).toBe('$5k')
    expect(formatCurrency(999000, 'COP', { compact: true })).toBe('$999k')
  })

  it('does not use compact formatting when compact is not requested', () => {
    const out = formatCurrency(1_500_000, 'COP')
    expect(out).not.toContain('M')
    expect(out).toMatch(/1\.500\.000/)
  })

  it('treats COP as the default currency when none is provided', () => {
    const out = formatCurrency(1000)
    expect(out).toMatch(/1\.000/)
  })
})

describe('shortDate', () => {
  it('formats a Date including the day and an abbreviated month (es-CO)', () => {
    const out = shortDate(new Date('2025-03-15T12:00:00Z'))
    // es-CO uses 2-digit day + short month name (e.g. "15 mar" or "15 de mar").
    expect(out).toMatch(/15/)
    expect(out.toLowerCase()).toMatch(/mar|03/)
    expect(out.length).toBeGreaterThan(0)
  })

  it('accepts an ISO string', () => {
    const out = shortDate('2025-01-05T10:00:00Z')
    expect(out).toMatch(/5/)
    expect(typeof out).toBe('string')
    // es-CO short month for January is "ene".
    expect(out.toLowerCase()).toContain('ene')
  })

  it('returns a non-empty short string', () => {
    const out = shortDate(new Date())
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(20)
  })
})

describe('shortTime', () => {
  it('formats a Date as a localized time (es-CO)', () => {
    const out = shortTime(new Date('2025-03-15T13:45:00'))
    // es-CO uses 12-hour clock with AM/PM marker (e.g. "01:45 p. m.").
    expect(out).toMatch(/1:45/)
    expect(out.toLowerCase()).toMatch(/p\.?\s*m/) // p. m. / pm
  })

  it('accepts an ISO string', () => {
    const out = shortTime('2025-03-15T09:05:00')
    expect(out).toMatch(/9:05/)
    expect(out.toLowerCase()).toMatch(/a\.?\s*m/) // a. m. / am
  })

  it('returns a non-empty short time string containing a colon', () => {
    const out = shortTime(new Date())
    expect(out).toContain(':')
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(20)
  })
})
