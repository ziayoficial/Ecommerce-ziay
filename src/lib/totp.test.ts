// Unit tests for src/lib/totp.ts
// TASK: TESTS-CICD-001

import { describe, it, expect } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { generateTOTPSecret, verifyTOTP, generateBackupCodes } from '@/lib/totp'

describe('generateTOTPSecret', () => {
  it('returns an object with secret + uri', () => {
    const result = generateTOTPSecret('user@example.com')
    expect(result).toHaveProperty('secret')
    expect(result).toHaveProperty('plainSecret')
    expect(result).toHaveProperty('uri')
    expect(typeof result.secret).toBe('string')
    expect(typeof result.plainSecret).toBe('string')
    expect(typeof result.uri).toBe('string')
    expect(result.secret.length).toBeGreaterThan(0)
    expect(result.plainSecret.length).toBeGreaterThan(0)
    expect(result.uri.length).toBeGreaterThan(0)
    // secret should be encrypted (contains ':' separator from AES-GCM format)
    expect(result.secret).toContain(':')
    // plainSecret should be base32 (no ':')
    expect(result.plainSecret).not.toContain(':')
  })

  it('returns an otpauth:// URI compatible with authenticator apps', () => {
    const { uri } = generateTOTPSecret('user@example.com')
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    // Issuer should be encoded in the URI.
    expect(uri.toLowerCase()).toContain('ziay')
  })

  it('produces a different secret each call (entropy)', () => {
    const a = generateTOTPSecret('a@example.com').secret
    const b = generateTOTPSecret('b@example.com').secret
    expect(a).not.toBe(b)
  })

  it('encodes the label in the URI', () => {
    const label = 'valentina@saramantha.co'
    const { uri } = generateTOTPSecret(label)
    // otpauth URIs URL-encode the label.
    expect(uri).toContain(encodeURIComponent(label))
  })
})

describe('verifyTOTP', () => {
  it('returns true for a valid current token', () => {
    const { secret, plainSecret } = generateTOTPSecret('user@example.com')
    const totp = new TOTP({
      issuer: 'ZIAY',
      label: 'verify',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(plainSecret),
    })
    const token = totp.generate()
    // verifyTOTP now receives the ENCRYPTED secret and decrypts internally
    expect(verifyTOTP(token, secret)).toBe(true)
  })

  it('returns false for an invalid token', () => {
    const { secret } = generateTOTPSecret('user@example.com')
    expect(verifyTOTP('000000', secret)).toBe(false)
    expect(verifyTOTP('999999', secret)).toBe(false)
  })

  it('returns false for malformed tokens (non-6-digit)', () => {
    const { secret } = generateTOTPSecret('user@example.com')
    expect(verifyTOTP('12345', secret)).toBe(false) // too short
    expect(verifyTOTP('1234567', secret)).toBe(false) // too long
    expect(verifyTOTP('abcdef', secret)).toBe(false) // non-numeric
  })

  it('returns false when token or secret is empty', () => {
    expect(verifyTOTP('', 'JBSWY3DPEHPK3PXP')).toBe(false)
    expect(verifyTOTP('123456', '')).toBe(false)
  })

  it('returns false for an invalid base32 secret', () => {
    expect(verifyTOTP('123456', 'not-a-valid-base32-secret!')).toBe(false)
  })

  it('tolerates tokens with whitespace (trims them)', () => {
    const { secret, plainSecret } = generateTOTPSecret('user@example.com')
    const totp = new TOTP({
      issuer: 'ZIAY',
      label: 'verify',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(plainSecret),
    })
    const token = totp.generate()
    // Insert whitespace — should still verify after cleanup.
    expect(verifyTOTP(`  ${token}  `, secret)).toBe(true)
  })
})

describe('generateBackupCodes', () => {
  it('returns exactly 10 backup codes', () => {
    const codes = generateBackupCodes()
    expect(codes).toHaveLength(10)
  })

  it('returns unique codes (no duplicates within one batch)', () => {
    const codes = generateBackupCodes()
    expect(new Set(codes).size).toBe(10)
  })

  it('formats each code as XXXX-XXXX (8 digits + dash)', () => {
    const codes = generateBackupCodes()
    for (const c of codes) {
      expect(c).toMatch(/^\d{4}-\d{4}$/)
    }
  })

  it('returns different codes on successive calls', () => {
    const a = generateBackupCodes()
    const b = generateBackupCodes()
    // Extremely unlikely to be identical — assert at least one differs.
    expect(a.join(',') === b.join(',')).toBe(false)
  })
})
