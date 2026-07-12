// CommerceFlow OS — TOTP (Time-based One-Time Password) utilities
//
// Used for 2FA on admin/agent accounts. Built on the `otpauth` package.
// Compatible with Google Authenticator, Microsoft Authenticator, Authy, 1Password.
//
// Issuer: "CommerceFlow OS"
// Algorithm: SHA1 (RFC 6238 default — widest authenticator compatibility)
// Digits: 6
// Period: 30s
//
// BUILD-AGENTS-LIB-001

import { TOTP, Secret } from 'otpauth'

const ISSUER = 'CommerceFlow OS'
const PERIOD = 30
const DIGITS = 6

export interface TotpSecretResult {
  /** Base32-encoded secret (storable in DB, e.g. `User.totpSecret`). */
  secret: string
  /** otpauth:// URI for QR-code generation. */
  uri: string
}

/**
 * Generate a new TOTP secret for a user.
 *
 * @param label - Typically the user email or `tenant:email`. Used in the
 *                authenticator app to identify the account.
 * @returns `{ secret, uri }` — store `secret` encrypted in the DB, render
 *          `uri` as a QR code in the enrollment flow.
 */
export function generateTOTPSecret(label: string): TotpSecretResult {
  const secret = new Secret({ size: 20 })
  const totp = new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
    secret,
  })
  return {
    secret: secret.base32,
    uri: totp.toString(),
  }
}

/**
 * Verify a TOTP token against a stored secret.
 *
 * Uses otpauth's default window of ±1 period (±30s) to allow for clock drift
 * between the user device and the server.
 *
 * @param token  - 6-digit code from the user's authenticator.
 * @param secret - Base32-encoded secret stored in the DB.
 * @returns `true` if the token is valid within the window.
 */
export function verifyTOTP(token: string, secret: string): boolean {
  if (!token || !secret) return false
  const cleanToken = token.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleanToken)) return false
  try {
    const totp = new TOTP({
      issuer: ISSUER,
      label: 'verify',
      algorithm: 'SHA1',
      digits: DIGITS,
      period: PERIOD,
      secret: Secret.fromBase32(secret),
    })
    const delta = totp.validate({ token: cleanToken, window: 1 })
    return delta !== null
  } catch {
    return false
  }
}

/**
 * Generate a set of one-time-use backup codes (10 codes, 8 digits each,
 * formatted as XXXX-XXXX for readability).
 *
 * Store these hashed (e.g. bcrypt) in the DB. Each code can be used exactly
 * once to bypass TOTP in case the user loses their authenticator device.
 *
 * @returns Array of 10 backup code strings.
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = []
  const seen = new Set<string>()
  while (codes.length < 10) {
    // 8-digit code, leading zeros preserved
    const n = Math.floor(Math.random() * 100_000_000)
    const code = n.toString().padStart(8, '0')
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`
    if (seen.has(formatted)) continue
    seen.add(formatted)
    codes.push(formatted)
  }
  return codes
}
