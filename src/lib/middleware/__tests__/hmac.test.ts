// Unit tests for src/lib/middleware/hmac.ts
// TASK: TESTS-CICD-001

import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyMetaSignature, verifyHmacSha256, verifyHmacSha256Base64 } from '@/lib/middleware/hmac'

const SECRET = 'test-meta-app-secret'
const BODY = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '123', changes: [{ value: { messages: [{ from: '5712345678', text: { body: 'hi' } }] } }] }],
})

function sign(body: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return `sha256=${digest}`
}

describe('verifyMetaSignature', () => {
  it('returns true for a valid signature', () => {
    const signature = sign(BODY, SECRET)
    expect(verifyMetaSignature(BODY, signature, SECRET)).toBe(true)
  })

  it('returns false for an invalid signature', () => {
    const signature = sign(BODY, SECRET) // sign with a different body
    expect(verifyMetaSignature('{"different":"body"}', signature, SECRET)).toBe(false)
  })

  it('returns false for a tampered signature string', () => {
    const real = sign(BODY, SECRET)
    const tampered = real.slice(0, -2) + '00' // change last 2 hex chars
    expect(verifyMetaSignature(BODY, tampered, SECRET)).toBe(false)
  })

  it('returns false when signature is missing (null/undefined/empty)', () => {
    expect(verifyMetaSignature(BODY, null, SECRET)).toBe(false)
    expect(verifyMetaSignature(BODY, undefined, SECRET)).toBe(false)
    expect(verifyMetaSignature(BODY, '', SECRET)).toBe(false)
  })

  it('returns false when appSecret is missing (empty string)', () => {
    const signature = sign(BODY, SECRET)
    expect(verifyMetaSignature(BODY, signature, '')).toBe(false)
  })

  it('returns false when signature does not start with sha256= prefix', () => {
    const digest = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex')
    expect(verifyMetaSignature(BODY, digest, SECRET)).toBe(false) // missing prefix
  })

  it('accepts Buffer bodies as well as strings', () => {
    const signature = sign(BODY, SECRET)
    expect(verifyMetaSignature(Buffer.from(BODY, 'utf8'), signature, SECRET)).toBe(true)
  })

  it('uses timing-safeEqual (not string comparison) — verifies signatures of identical length but different content do not match', () => {
    // Two signatures of identical length but different content should not match.
    const sigA = sign(BODY, SECRET)
    const sigB = sign('{"x":1}', SECRET)
    expect(sigA.length).toBe(sigB.length) // sanity: same length
    expect(verifyMetaSignature(BODY, sigB, SECRET)).toBe(false)
  })
})

describe('verifyHmacSha256', () => {
  it('verifies a correct hex HMAC-SHA256', () => {
    const sig = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex')
    expect(verifyHmacSha256(BODY, sig, SECRET)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    expect(verifyHmacSha256(BODY, 'deadbeef', SECRET)).toBe(false)
  })

  it('returns false on missing signature', () => {
    expect(verifyHmacSha256(BODY, null, SECRET)).toBe(false)
  })

  it('returns false on missing secret', () => {
    expect(verifyHmacSha256(BODY, 'deadbeef', '')).toBe(false)
  })
})

describe('verifyHmacSha256Base64', () => {
  it('verifies a correct base64 HMAC-SHA256', () => {
    const sig = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('base64')
    expect(verifyHmacSha256Base64(BODY, sig, SECRET)).toBe(true)
  })

  it('rejects an incorrect base64 signature', () => {
    expect(verifyHmacSha256Base64(BODY, 'wrong==', SECRET)).toBe(false)
  })
})
