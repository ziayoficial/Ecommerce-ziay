// ZIAY — HMAC signature verification middleware
// Used to verify incoming webhooks from Meta (WhatsApp Business API),
// Shopify, WooCommerce, and other platforms that sign payloads with HMAC-SHA256.
//
// Security: uses `timingSafeEqual` to prevent timing attacks when comparing
// signatures. Never use `===` for signature comparison.
//
// BUILD-AGENTS-LIB-001

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify a Meta (WhatsApp/Messenger) X-Hub-Signature-256 header.
 *
 * Meta sends: `sha256=<hex-digest>` where digest = HMAC-SHA256(rawBody, appSecret).
 *
 * @param rawBody  - The raw request body as a string or Buffer (NOT parsed JSON).
 * @param signature - The value of the `X-Hub-Signature-256` header.
 * @param appSecret - The App Secret configured in the Meta developer console.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  signature: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signature || !appSecret) return false

  // Meta format: "sha256=<hex>"
  const prefix = 'sha256='
  if (!signature.startsWith(prefix)) return false

  const expected = signature.slice(prefix.length)
  const digest = createHmac('sha256', appSecret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex')

  return safeEqualHex(expected, digest)
}

/**
 * Verify a generic HMAC-SHA256 signature (Shopify, WooCommerce, custom).
 *
 * @param rawBody   - The raw request body.
 * @param signature - The hex-encoded HMAC digest from the webhook header.
 * @param secret    - The shared secret used to sign the payload.
 * @returns `true` if valid.
 */
export function verifyHmacSha256(
  rawBody: string | Buffer,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false
  const digest = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex')
  return safeEqualHex(signature, digest)
}

/**
 * Verify a base64-encoded HMAC-SHA256 signature (used by some platforms).
 *
 * @param rawBody   - The raw request body.
 * @param signature - The base64-encoded HMAC digest.
 * @param secret    - The shared secret.
 * @returns `true` if valid.
 */
export function verifyHmacSha256Base64(
  rawBody: string | Buffer,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false
  const digest = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('base64')
  return safeEqualString(signature, digest)
}

/**
 * Timing-safe comparison of two hex strings. Both are first normalized to
 * lowercase and then compared byte-by-byte using `timingSafeEqual`. If lengths
 * differ, we still run a dummy comparison to avoid leaking length info.
 */
function safeEqualHex(a: string, b: string): boolean {
  const aNorm = a.toLowerCase()
  const bNorm = b.toLowerCase()
  if (aNorm.length !== bNorm.length) {
    // dummy compare to keep timing constant
    timingSafeEqual(Buffer.from(aNorm), Buffer.from(aNorm))
    return false
  }
  try {
    return timingSafeEqual(Buffer.from(aNorm), Buffer.from(bNorm))
  } catch {
    return false
  }
}

/**
 * Timing-safe comparison of two arbitrary strings.
 */
function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) {
    timingSafeEqual(Buffer.from(a), Buffer.from(a))
    return false
  }
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}
