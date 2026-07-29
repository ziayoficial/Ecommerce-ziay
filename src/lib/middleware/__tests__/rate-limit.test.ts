// Unit tests for src/lib/middleware/rate-limit.ts
// TASK: TESTS-CICD-001

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { rateLimit, resetRateLimit } from '@/lib/middleware/rate-limit'

const NAMESPACE = 'test-rl'
const IP = '203.0.113.10'

function makeReq(headers: Record<string, string> = {}): NextRequest {
  const req = new NextRequest('http://localhost/api/test', { headers })
  // The rate-limit helper honours x-forwarded-for / x-real-ip; pin the IP via XFF.
  if (!headers['x-forwarded-for']) {
    req.headers.set('x-forwarded-for', IP)
  }
  return req
}

beforeEach(() => {
  resetRateLimit(NAMESPACE, IP)
  resetRateLimit('other-ns', IP)
})

describe('rateLimit', () => {
  it('allows up to max requests and returns null each time', () => {
    const max = 5
    for (let i = 0; i < max; i++) {
      const res = rateLimit(makeReq(), { max, windowMs: 10_000, namespace: NAMESPACE })
      expect(res).toBeNull()
    }
  })

  it('returns a 429 NextResponse once max is exceeded', () => {
    const max = 3
    for (let i = 0; i < max; i++) {
      expect(rateLimit(makeReq(), { max, windowMs: 10_000, namespace: NAMESPACE })).toBeNull()
    }
    const blocked = rateLimit(makeReq(), { max, windowMs: 10_000, namespace: NAMESPACE })
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)
    expect(blocked!.headers.get('Retry-After')).toBeTruthy()
    expect(blocked!.headers.get('X-RateLimit-Limit')).toBe(String(max))
    expect(blocked!.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('resets after the window elapses', async () => {
    const max = 2
    const windowMs = 200
    for (let i = 0; i < max; i++) {
      rateLimit(makeReq(), { max, windowMs, namespace: NAMESPACE })
    }
    const blocked = rateLimit(makeReq(), { max, windowMs, namespace: NAMESPACE })
    expect(blocked?.status ?? null).toBe(429)

    // Wait > windowMs so the sliding window drops the old timestamps.
    await new Promise((r) => setTimeout(r, windowMs + 50))

    // Should be allowed again.
    const after = rateLimit(makeReq(), { max, windowMs, namespace: NAMESPACE })
    expect(after).toBeNull()
  })

  it('returns null when under the limit (single request)', () => {
    const res = rateLimit(makeReq(), { max: 10, windowMs: 10_000, namespace: NAMESPACE })
    expect(res).toBeNull()
  })

  it('scopes limits by namespace — different namespaces do not interfere', () => {
    const OTHER = 'other-ns'
    // Exhaust the 'test-rl' namespace.
    rateLimit(makeReq(), { max: 1, windowMs: 10_000, namespace: NAMESPACE })
    const blocked = rateLimit(makeReq(), { max: 1, windowMs: 10_000, namespace: NAMESPACE })
    expect(blocked?.status).toBe(429)

    // A different namespace should still be allowed.
    const other = rateLimit(makeReq(), { max: 1, windowMs: 10_000, namespace: OTHER })
    expect(other).toBeNull()
  })

  it('returns a 429 with a custom message when over the limit', async () => {
    const max = 1
    rateLimit(makeReq(), { max, windowMs: 10_000, namespace: NAMESPACE })
    const blocked = rateLimit(makeReq(), {
      max,
      windowMs: 10_000,
      namespace: NAMESPACE,
      message: 'Webhook rate limited',
    })
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)
    // The body should contain the custom message.
    const json = await blocked!.json()
    expect(json.error).toBe('Webhook rate limited')
    expect(json.retry_after).toBeGreaterThan(0)
  })

  it('isolates IPs — one IP hitting the limit does not block another', () => {
    const max = 1
    rateLimit(makeReq(), { max, windowMs: 10_000, namespace: NAMESPACE })
    const blockedForIp1 = rateLimit(makeReq(), { max, windowMs: 10_000, namespace: NAMESPACE })
    expect(blockedForIp1?.status).toBe(429)

    const otherIp = '198.51.100.42'
    resetRateLimit(NAMESPACE, otherIp)
    const req2 = new NextRequest('http://localhost/api/test')
    req2.headers.set('x-forwarded-for', otherIp)
    const res = rateLimit(req2, { max, windowMs: 10_000, namespace: NAMESPACE })
    expect(res).toBeNull()
  })
})
