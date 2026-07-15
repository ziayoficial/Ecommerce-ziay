// Unit tests for src/lib/middleware/cache-headers.ts
// SPRINT-TESTS-MIDDLEWARE-001 · §3b — CDN cache-headers middleware.
//
// Coverage:
//   - public-short: 60s CDN s-maxage + 5s stale-while-revalidate.
//   - public-long: 1h (3600s) CDN s-maxage.
//   - public-immutable: 1-year (31536000s) max-age + `immutable`.
//   - private: `private` directive, no `s-maxage` (browser-only).
//   - no-cache: `no-cache, no-store, must-revalidate` trifecta.
//   - Returns the same response object (mutation in place for chaining).

import { describe, it, expect } from 'vitest'
import { NextResponse } from 'next/server'
import { setCacheHeaders } from '@/lib/middleware/cache-headers'

describe('Cache headers middleware', () => {
  it('sets public-short cache (60s CDN, 5s stale-while-revalidate)', () => {
    const res = new NextResponse()
    setCacheHeaders(res, 'public-short')
    const cc = res.headers.get('Cache-Control')
    expect(cc).toContain('public')
    expect(cc).toContain('s-maxage=60')
    expect(cc).toContain('stale-while-revalidate=5')
  })

  it('sets public-long cache (1h CDN)', () => {
    const res = new NextResponse()
    setCacheHeaders(res, 'public-long')
    const cc = res.headers.get('Cache-Control')
    expect(cc).toContain('public')
    expect(cc).toContain('s-maxage=3600')
    expect(cc).toContain('stale-while-revalidate=300')
  })

  it('sets public-immutable cache (1 year)', () => {
    const res = new NextResponse()
    setCacheHeaders(res, 'public-immutable')
    const cc = res.headers.get('Cache-Control')
    expect(cc).toContain('public')
    expect(cc).toContain('max-age=31536000')
    expect(cc).toContain('immutable')
  })

  it('sets private cache (browser only, no CDN)', () => {
    const res = new NextResponse()
    setCacheHeaders(res, 'private')
    const cc = res.headers.get('Cache-Control')
    expect(cc).toContain('private')
    expect(cc).toContain('max-age=60')
    expect(cc).not.toContain('s-maxage')
    expect(cc).not.toContain('public')
  })

  it('sets no-cache (no-cache + no-store + must-revalidate)', () => {
    const res = new NextResponse()
    setCacheHeaders(res, 'no-cache')
    const cc = res.headers.get('Cache-Control')
    expect(cc).toContain('no-cache')
    expect(cc).toContain('no-store')
    expect(cc).toContain('must-revalidate')
  })

  it('returns the same response object (mutation in place)', () => {
    const res = new NextResponse()
    const returned = setCacheHeaders(res, 'public-short')
    expect(returned).toBe(res)
  })

  it('overwrites a previously-set Cache-Control header', () => {
    const res = new NextResponse(null, {
      headers: { 'Cache-Control': 'private, max-age=999' },
    })
    setCacheHeaders(res, 'public-short')
    const cc = res.headers.get('Cache-Control')
    expect(cc).toBe('public, s-maxage=60, stale-while-revalidate=5')
    expect(cc).not.toContain('max-age=999')
  })

  it('does not affect other response headers', () => {
    const res = new NextResponse(null, {
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'abc-123',
      },
    })
    setCacheHeaders(res, 'public-long')
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('X-Request-Id')).toBe('abc-123')
  })
})
