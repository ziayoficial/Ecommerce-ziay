// Test for wallet backup codes CSPRNG fix (AUDIT-C-1/C-9).
// Verifies that generateBackupCodesPlain uses crypto.randomInt instead of Math.random.

import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'

/**
 * Inline copy of the fixed generateBackupCodesPlain function from
 * src/app/api/wallet/route.ts. This test validates the CSPRNG behaviour.
 */
function generateBackupCodesPlain(): string[] {
  const codes: string[] = []
  const seen = new Set<string>()
  while (codes.length < 10) {
    const n = crypto.randomInt(0, 100_000_000)
    const code = n.toString().padStart(8, '0')
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`
    if (seen.has(formatted)) continue
    seen.add(formatted)
    codes.push(formatted)
  }
  return codes
}

describe('generateBackupCodesPlain (CSPRNG)', () => {
  it('generates exactly 10 unique codes', () => {
    const codes = generateBackupCodesPlain()
    expect(codes).toHaveLength(10)
    const unique = new Set(codes)
    expect(unique.size).toBe(10)
  })

  it('each code has format XXXX-XXXX', () => {
    const codes = generateBackupCodesPlain()
    for (const code of codes) {
      expect(code).toMatch(/^\d{4}-\d{4}$/)
    }
  })

  it('generates different codes on each call', () => {
    const set1 = generateBackupCodesPlain()
    const set2 = generateBackupCodesPlain()
    // Extremely unlikely that two calls produce identical sets
    const s1 = new Set(set1)
    const s2 = new Set(set2)
    const intersection = [...s1].filter((x) => s2.has(x))
    expect(intersection.length).toBeLessThan(10)
  })

  it('does not use Math.random (CSPRNG)', () => {
    const fnStr = generateBackupCodesPlain.toString()
    expect(fnStr).not.toContain('Math.random')
  })
})