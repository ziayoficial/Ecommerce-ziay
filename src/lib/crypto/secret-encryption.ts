// ZIAY — At-rest AES-256-GCM encryption for credential payloads.
//
// Shared by:
//   - `credentialsService`  (R-9: encrypts `Setting.value` for `cred::*` keys)
//   - `totp.ts`             (TOTP secrets — kept private for backward-compat
//                            with the existing `iv:authTag:ciphertext` format)
//
// Why a separate module from totp.ts?
//   - The TOTP module uses a no-prefix `iv:authTag:ciphertext` wire format
//     (already shipped, exercised by `totp.test.ts`). Changing it would break
//     stored TOTP secrets and the tests.
//   - Credential encryption is a NEW feature (R-9). We can introduce a clearer
//     wire format with a version prefix: `enc:v1:<iv>:<authTag>:<ciphertext>`.
//     The prefix lets us distinguish encrypted vs legacy-plaintext values and
//     is forward-compatible (e.g. `enc:v2:` for a future KMS-backed scheme).
//
// Security contract:
//   - In production, `ENCRYPTION_KEY` MUST be set (32-byte UTF-8 string or
//     64-char hex string — both are normalized to a 32-byte key). If it's
//     missing we THROW (fail-closed). Storing API keys in plaintext in prod
//     is exactly the bug R-9 is fixing.
//   - In non-production (NODE_ENV !== 'production'), if `ENCRYPTION_KEY` is
//     missing we log a loud warning and fall back to storing the value as
//     `enc:v0:<plaintext>` (clearly marked as unencrypted so the migration
//     helper can re-encrypt it once a key is configured). This matches the
//     R-9 spec: fail-closed in prod, plaintext-with-prefix in dev so the
//     code path is exercised without breaking local development.
//   - The AES-256-GCM auth tag guarantees ciphertext integrity. Tampering
//     with any byte (IV, tag, or ciphertext) makes `decryptSecret` throw.
//
// SPRINT-SEC-R9-001 — extracted from the totp.ts encrypt/decrypt helpers so
// the credential service can share the same key + algorithm without the TOTP
// module's wire format.

import crypto from 'node:crypto'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'

const log = getLogger('crypto:secret-encryption')

// ─────────────────────────────────────────────────────────────────────────────
// Key derivation
// ─────────────────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm'

/**
 * Normalize the `ENCRYPTION_KEY` env var into a 32-byte Buffer (AES-256 key).
 *
 * Accepted formats:
 *   - 64-char hex string (`openssl rand -hex 32`) — decoded as hex.
 *   - 32+ char UTF-8 passphrase — first 32 bytes used (matches totp.ts
 *     behaviour, which pads/slices a UTF-8 string).
 *
 * Returns `null` when the env var is unset or empty. The caller decides
 * whether to fail-closed (production) or fall back to a dev key.
 */
function deriveKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) return null

  // Hex form (preferred) — exactly 64 hex chars = 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }
  // UTF-8 passphrase — first 32 bytes (padded with spaces to 32 if shorter,
  // matching the legacy totp.ts behaviour so a key configured for TOTP also
  // works here without a redeploy).
  return Buffer.from(raw.padEnd(32).slice(0, 32), 'utf8')
}

/** True when `NODE_ENV === 'production'` (fail-closed gate). */
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

/**
 * Resolve the AES-256 key when one is available.
 *
 *   - `ENCRYPTION_KEY` set (hex or passphrase) → 32-byte Buffer.
 *   - unset / empty → `null` (the caller decides what to do).
 *
 * Callers: `encryptSecret` and `decryptSecret` use this to decide between
 * the v1 (encrypted) and v0 (plaintext dev fallback) wire formats.
 */
function tryResolveKey(): Buffer | null {
  return deriveKey()
}

/**
 * Resolve the AES-256 key, FAILING CLOSED when it's missing in production.
 *
 *   - production + no key  → throw (credentials MUST NOT be stored plaintext).
 *   - non-production + no key → throws too — but callers that want the dev
 *     plaintext fallback should use `tryResolveKey` + the `enc:v0:` path
 *     instead of this function.
 *
 * Used by `decryptSecret` for `enc:v1:` ciphertexts — those can ONLY be
 * decrypted with the key, so we fail closed if it's missing (regardless
 * of NODE_ENV). The throw surfaces misconfigurations like "operator set
 * ENCRYPTION_KEY in prod env A, then deployed to env B without it" instead
 * of silently returning garbage.
 */
function requireKey(): Buffer {
  const key = deriveKey()
  if (key) return key

  const err = new Error(
    'ENCRYPTION_KEY env var is required to decrypt `enc:v1:` credential ' +
      'ciphertexts (R-9). Generate one with `openssl rand -hex 32`. ' +
      (IS_PRODUCTION
        ? 'Running in production — fail-closed.'
        : 'Running in non-production — set ENCRYPTION_KEY or the credential ' +
          'will be unreadable until the migration helper re-encrypts it.'),
  )
  captureError(err, {
    module: 'crypto/secret-encryption',
    method: 'requireKey',
    reason: IS_PRODUCTION
      ? 'missing-encryption-key-prod'
      : 'missing-encryption-key-dev',
    nodeEnv: process.env.NODE_ENV ?? 'undefined',
  })
  throw err
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypted-value prefixes.
 *
 *   - `enc:v1:`  — AES-256-GCM, format: `enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
 *                  IV is 12 random bytes (GCM standard). Auth tag is 16 bytes.
 *                  Produced by `encryptSecret` when `ENCRYPTION_KEY` is set.
 *   - `enc:v0:`  — Dev-only plaintext fallback. Produced by `encryptSecret`
 *                  in non-production when `ENCRYPTION_KEY` is unset. The
 *                  suffix is the raw plaintext (NOT encrypted). The
 *                  migration helper re-encrypts these into `enc:v1:` once
 *                  a key is configured.
 */
export const ENC_PREFIX_V1 = 'enc:v1:'
export const ENC_PREFIX_V0 = 'enc:v0:'

/** True iff `value` was produced by `encryptSecret` (starts with `enc:v1:`). */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  return !!value && value.startsWith(ENC_PREFIX_V1)
}

/** True iff `value` is a legacy plaintext credential (no `enc:*:` prefix). */
export function isLegacyPlaintextSecret(value: string | null | undefined): boolean {
  if (!value) return false
  // `enc:v0:` is "plaintext dev fallback" — we treat it as legacy too: the
  // migration helper re-encrypts these into `enc:v1:` on next write.
  if (value.startsWith(ENC_PREFIX_V0)) return true
  // Anything that doesn't start with `enc:v1:` is considered plaintext.
  return !value.startsWith(ENC_PREFIX_V1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public encrypt / decrypt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string for at-rest storage.
 *
 * Wire format policy (R-9):
 *   - `ENCRYPTION_KEY` set → `enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>`
 *     (AES-256-GCM, 12-byte IV, 16-byte auth tag). A new IV is generated
 *     on every call so encrypting the same plaintext twice yields two
 *     different ciphertexts (semantic security).
 *   - production + no `ENCRYPTION_KEY` → THROW (fail-closed). No plaintext
 *     credential is ever written in production.
 *   - non-production + no `ENCRYPTION_KEY` → log a loud warning and return
 *     `enc:v0:<plaintext>` (clearly marked as unencrypted so the migration
 *     helper can re-encrypt it once a key is configured).
 */
export function encryptSecret(plaintext: string): string {
  const key = tryResolveKey()

  // Fail-closed in production: no key → no plaintext credential is ever
  // written. The throw is captured so it surfaces in Sentry / logs.
  if (!key) {
    if (IS_PRODUCTION) {
      const err = new Error(
        'ENCRYPTION_KEY env var is required in production for at-rest ' +
          'credential encryption (R-9). Generate one with `openssl rand -hex 32`.',
      )
      captureError(err, {
        module: 'crypto/secret-encryption',
        method: 'encryptSecret',
        reason: 'missing-encryption-key-prod',
      })
      throw err
    }

    // Dev-only plaintext fallback — `enc:v0:` is clearly marked as
    // unencrypted so the migration helper can re-encrypt it later.
    log.warn(
      'ENCRYPTION_KEY env var is not set — writing credential as `enc:v0:` ' +
        'plaintext (dev-only fallback). Set ENCRYPTION_KEY to a 32-byte hex ' +
        'string (openssl rand -hex 32) before deploying to production. ' +
        'Run `migrateLegacyCredentials()` after setting the key to re-encrypt ' +
        'these rows into `enc:v1:`.',
    )
    return `${ENC_PREFIX_V0}${plaintext}`
  }

  const iv = crypto.randomBytes(12) // GCM standard IV length
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return `${ENC_PREFIX_V1}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypt a value previously produced by `encryptSecret`.
 *
 * Behaviour:
 *   - `enc:v1:...` → AES-256-GCM decrypt. Throws on tampering / wrong key
 *     (GCM auth tag verification). The thrown error is captured.
 *   - `enc:v0:...` → legacy dev plaintext fallback. Returns the suffix as-is.
 *   - Anything else → legacy plaintext (pre-R-9 stored credential). Returns
 *     the value as-is so the caller can read it (and re-encrypt on next write).
 *
 * This NEVER throws for plaintext inputs — it's a read-time helper and the
 * caller (e.g. `credentialsService`) needs to keep working while the lazy
 * migration re-encrypts legacy rows. It DOES throw for `enc:v1:` ciphertexts
 * that fail GCM verification, because that signals either tampering or a
 * key rotation (which the operator needs to know about).
 */
export function decryptSecret(value: string | null | undefined): string {
  if (!value) return ''

  // `enc:v1:<iv>:<authTag>:<ciphertext>`
  if (value.startsWith(ENC_PREFIX_V1)) {
    const payload = value.slice(ENC_PREFIX_V1.length)
    const parts = payload.split(':')
    if (parts.length !== 3) {
      const err = new Error(
        `Malformed enc:v1: ciphertext (expected 3 colon-separated parts, got ${parts.length})`,
      )
      captureError(err, { module: 'crypto/secret-encryption', method: 'decryptSecret' })
      throw err
    }
    const key = requireKey()
    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const ciphertext = Buffer.from(parts[2], 'hex')
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ])
      return decrypted.toString('utf8')
    } catch (err) {
      // GCM auth-tag mismatch or key mismatch — surface it. Tampering with
      // a credential ciphertext is a security event, not a silent failure.
      captureError(err as Error, {
        module: 'crypto/secret-encryption',
        method: 'decryptSecret',
        reason: 'gcm-auth-failure',
      })
      throw new Error('Failed to decrypt credential ciphertext (GCM auth failed or key mismatch)')
    }
  }

  // `enc:v0:<plaintext>` — legacy dev plaintext fallback. Return as-is.
  if (value.startsWith(ENC_PREFIX_V0)) {
    return value.slice(ENC_PREFIX_V0.length)
  }

  // Legacy plaintext (pre-R-9 credential row written before encryption was
  // enabled). Return as-is so the caller can read it; the lazy migration will
  // re-encrypt it on the next write. No key required for this path.
  return value
}

/**
 * Convenience: encrypt a JSON-serializable payload. The caller passes the
 * already-stringified JSON (so the caller controls the serialization shape —
 * important for deterministic merges in `credentialsService`).
 */
export function encryptJson(jsonString: string): string {
  return encryptSecret(jsonString)
}

/**
 * Convenience: decrypt a stored value and parse it as JSON. Returns `null`
 * on any decrypt or parse error so callers can fall back to an empty object.
 */
export function decryptJson<T = unknown>(value: string | null | undefined): T | null {
  try {
    const plaintext = decryptSecret(value)
    if (!plaintext) return null
    return JSON.parse(plaintext) as T
  } catch {
    return null
  }
}
