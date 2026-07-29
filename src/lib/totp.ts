// ZIAY — TOTP (Time-based One-Time Password) utilities with AES-256-GCM encryption.
//
// 2FA for wallet withdrawals. Compatible with Google Authenticator, Authy, 1Password.
// CRITICAL: secrets are encrypted at rest with AES-256-GCM before storing in DB.
//
// Algorithm: SHA1 (RFC 6238), 6 digits, 30s period, ±1 window for clock drift.

import { TOTP, Secret } from 'otpauth'
import crypto from 'node:crypto'
import { captureError } from '@/lib/capture-error'

const ISSUER = 'ZIAY'
const PERIOD = 30
const DIGITS = 6

// ── AES-256-GCM encryption for secrets at rest ────────────────────────────
// The encryption key is derived from ENCRYPTION_KEY env var (or fallback for dev).
// In production, ENCRYPTION_KEY MUST be set to a 32-byte hex string
// (generate with: openssl rand -hex 32).
//
// SECURITY · IF-2 · S-10 — fail-closed at boot in production. The previous
// code silently fell back to `'ziay-dev-encryption-key-change-in-prod-32b!'`
// (a public literal shipped in source) whenever `ENCRYPTION_KEY` was missing.
// That meant a prod deploy without the env var would encrypt every TOTP
// secret with a publicly-known key — an attacker with DB read could
// decrypt every TOTP secret and forge 2FA codes. Mirrors the pattern in
// `src/lib/auth.ts:25-30` for `NEXTAUTH_SECRET`.
//
// The misconfiguration is also forwarded to Sentry / structured logs via
// `captureError` (best-effort — Sentry is a no-op when no DSN is set, and
// the local pino log is always emitted). The throw is the authoritative
// signal that crashes the boot so the operator notices immediately.
const __encryptionKey = process.env.ENCRYPTION_KEY
if (!__encryptionKey && process.env.NODE_ENV === 'production') {
  const err = new Error(
    'ENCRYPTION_KEY must be set in production (32-byte hex string). Generate with: openssl rand -hex 32',
  )
  try {
    captureError(err, {
      module: 'lib/totp',
      method: 'module-load',
      reason: 'missing-encryption-key-prod',
      nodeEnv: process.env.NODE_ENV ?? 'undefined',
    })
  } catch {
    // captureError / logger not available (early boot) — the throw below is
    // the authoritative signal.
  }
  throw err
}
if (!__encryptionKey) {
  console.warn(
    '⚠️  ENCRYPTION_KEY not set — using insecure dev fallback for TOTP secret ' +
      'encryption. Set this env var before deploying to production. ' +
      'Generate one with: openssl rand -hex 32',
  )
}
const ENCRYPTION_KEY = __encryptionKey || 'ziay-dev-encryption-key-change-in-prod-32b!'
const ALGORITHM = 'aes-256-gcm'

function encrypt(plaintext: string): string {
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32), 'utf8')
  const iv = crypto.randomBytes(12) // GCM standard IV length
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Format: iv:authTag:encrypted (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(ciphertext: string): string {
  try {
    const parts = ciphertext.split(':')
    if (parts.length !== 3) return ciphertext // Fallback: assume plaintext (migration)
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32), 'utf8')
    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const encrypted = Buffer.from(parts[2], 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    // If decryption fails, return as-is (might be a plaintext from before encryption was added)
    return ciphertext
  }
}

// ── TOTP generation ───────────────────────────────────────────────────────

export interface TotpSecretResult {
  /** AES-256-GCM encrypted secret (store this in DB). */
  secret: string
  /** Plain-text secret (only returned ONCE during setup for QR code). */
  plainSecret: string
  /** otpauth:// URI for QR-code generation. */
  uri: string
}

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
  const plainSecret = secret.base32
  return {
    secret: encrypt(plainSecret), // Store encrypted
    plainSecret,                   // Return plain ONCE for QR
    uri: totp.toString(),
  }
}

// ── TOTP verification ─────────────────────────────────────────────────────

export function verifyTOTP(token: string, encryptedSecret: string): boolean {
  if (!token || !encryptedSecret) return false
  const cleanToken = token.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleanToken)) return false
  try {
    // Decrypt the secret before verifying
    const plainSecret = decrypt(encryptedSecret)
    const totp = new TOTP({
      issuer: ISSUER,
      label: 'verify',
      algorithm: 'SHA1',
      digits: DIGITS,
      period: PERIOD,
      secret: Secret.fromBase32(plainSecret),
    })
    const delta = totp.validate({ token: cleanToken, window: 1 })
    return delta !== null
  } catch {
    return false
  }
}

// ── Backup codes (hashed with bcrypt-like one-way hash) ───────────────────

export function generateBackupCodes(): string[] {
  // SECURITY · IF-2 · S-13 — backup codes are now generated with
  // `crypto.randomInt()` (CSPRNG) instead of `Math.random()`. The previous
  // implementation used `Math.floor(Math.random() * 100_000_000)` which is
  // NOT cryptographically secure — with enough observed codes an attacker
  // could predict future codes (V8's PRNG is xorshift128+, recoverable
  // from ~6 outputs). `randomInt(0, 100_000_000)` returns a uniform,
  // unbiased random integer drawn from the OS CSPRNG.
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

/**
 * Hash backup codes for storage (one-way, using SHA-256 + salt).
 * The plain codes are returned to the user ONCE; only hashes are stored.
 */
export function hashBackupCodes(codes: string[]): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hashed = codes.map(code => {
    const hash = crypto.scryptSync(code, salt, 32).toString('hex')
    return hash
  })
  return JSON.stringify({ salt, hashes: hashed })
}

/**
 * Verify a backup code against stored hashes.
 * Returns true if the code matches any unused hash.
 */
export function verifyBackupCode(code: string, storedJson: string): boolean {
  try {
    const { salt, hashes } = JSON.parse(storedJson)
    const hash = crypto.scryptSync(code, salt, 32).toString('hex')
    return hashes.includes(hash)
  } catch {
    return false
  }
}
