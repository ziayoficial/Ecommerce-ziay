// Unit tests for src/lib/middleware/cors.ts
// SPRINT-TESTS-MIDDLEWARE-001 · §1 — CORS middleware.
//
// Coverage:
//   - getAllowedOrigins: env-driven allow-list + dev fallback.
//   - setCorsHeaders: headers applied for allowed origin, skipped for
//     disallowed origin, Vary: Origin appended for CDN safety.
//   - handlePreflight: 204 for OPTIONS, null for non-OPTIONS.
//
// `getAllowedOrigins` reads `process.env.CORS_ALLOWED_ORIGINS` at call
// time (not at module load), so we can stub the env var per-test without
// needing dynamic import / module reset.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import {
  getAllowedOrigins,
  setCorsHeaders,
  handlePreflight,
} from '@/lib/middleware/cors'

describe('CORS middleware — getAllowedOrigins', () => {
  beforeEach(() => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns env-configured origins (comma-separated, trimmed)', () => {
    vi.stubEnv(
      'CORS_ALLOWED_ORIGINS',
      'http://localhost:3000, https://ziay.co ,http://127.0.0.1:3000',
    )
    const origins = getAllowedOrigins()
    expect(origins).toEqual([
      'http://localhost:3000',
      'https://ziay.co',
      'http://127.0.0.1:3000',
    ])
  })

  it('returns default origins when env not set', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '')
    const origins = getAllowedOrigins()
    expect(origins).toContain('http://localhost:3000')
    expect(origins).toContain('http://localhost:3001')
    expect(origins).toContain('http://127.0.0.1:3000')
  })

  it('filters out empty entries from env list', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000,,, ,')
    const origins = getAllowedOrigins()
    expect(origins).toEqual(['http://localhost:3000'])
  })

  it('returns a fresh array each call (no shared mutation)', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const a = getAllowedOrigins()
    const b = getAllowedOrigins()
    expect(a).not.toBe(b) // different references
    expect(a).toEqual(b) // same contents
  })
})

describe('CORS middleware — setCorsHeaders', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sets CORS headers for allowed origin', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { origin: 'http://localhost:3000' },
    })
    const res = new NextResponse(null, { status: 200 })
    setCorsHeaders(req, res)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000',
    )
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    )
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Authorization, X-Request-Id',
    )
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  it('appends Vary: Origin for CDN safety', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { origin: 'http://localhost:3000' },
    })
    const res = new NextResponse(null, { status: 200 })
    setCorsHeaders(req, res)
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('preserves existing Vary header when appending Origin', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { origin: 'http://localhost:3000' },
    })
    const res = new NextResponse(null, {
      status: 200,
      headers: { vary: 'Accept-Encoding' },
    })
    setCorsHeaders(req, res)
    expect(res.headers.get('vary')).toBe('Accept-Encoding, Origin')
  })

  it('does NOT set CORS headers for disallowed origin', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { origin: 'https://evil.com' },
    })
    const res = new NextResponse(null, { status: 200 })
    setCorsHeaders(req, res)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(res.headers.get('vary')).toBeNull()
  })

  it('does NOT set CORS headers when Origin header is absent', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test')
    const res = new NextResponse(null, { status: 200 })
    setCorsHeaders(req, res)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('returns the same response object (mutates in place)', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { origin: 'http://localhost:3000' },
    })
    const res = new NextResponse(null, { status: 200 })
    const returned = setCorsHeaders(req, res)
    expect(returned).toBe(res)
  })
})

describe('CORS middleware — handlePreflight', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 204 with CORS headers for OPTIONS preflight', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000' },
    })
    const res = handlePreflight(req)
    expect(res).not.toBeNull()
    expect(res?.status).toBe(204)
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000',
    )
    expect(res?.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    )
    expect(res?.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  it('returns null for non-OPTIONS requests (GET)', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
    })
    expect(handlePreflight(req)).toBeNull()
  })

  it('returns null for POST requests', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    })
    expect(handlePreflight(req)).toBeNull()
  })

  it('returns 204 even for disallowed origin (browser will reject)', () => {
    // The preflight returns 204 but WITHOUT CORS headers when the origin
    // isn't allow-listed — the browser then blocks the actual request.
    // This is the spec-compliant behaviour: the server ACKs the preflight,
    // the browser enforces the policy.
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.com' },
    })
    const res = handlePreflight(req)
    expect(res).not.toBeNull()
    expect(res?.status).toBe(204)
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
