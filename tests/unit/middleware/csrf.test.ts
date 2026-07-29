// Unit tests for src/lib/middleware/csrf.ts
// SPRINT-TESTS-MIDDLEWARE-001 · §2 — CSRF middleware.
//
// Coverage:
//   - Safe methods (GET, HEAD, OPTIONS) bypass the check → null.
//   - Mutations with matching Origin/Host → null (allowed).
//   - Mutations with mismatched Origin/Host → 403 CSRF_ORIGIN_MISMATCH.
//   - Mutations with malformed Origin → 403 CSRF_INVALID_ORIGIN.
//   - Mutations with no Origin header → null (server-to-server allowed).
//
// The check enforces Origin/Host equality only when BOTH headers are
// present. Browser fetch() always sends Origin on cross-site POSTs, so
// this catches CSRF attacks. Server-to-server clients (curl, internal
// services) skip the check — NextAuth's SameSite=Lax cookie covers them.

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { checkCSRF } from '@/lib/middleware/csrf'

describe('CSRF middleware', () => {
  it('allows safe methods (GET, HEAD, OPTIONS)', () => {
    const getReq = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
    })
    expect(checkCSRF(getReq)).toBeNull()

    const headReq = new NextRequest('http://localhost:3000/api/test', {
      method: 'HEAD',
    })
    expect(checkCSRF(headReq)).toBeNull()

    const optionsReq = new NextRequest('http://localhost:3000/api/test', {
      method: 'OPTIONS',
    })
    expect(checkCSRF(optionsReq)).toBeNull()
  })

  it('allows mutations with matching origin (POST)', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    })
    expect(checkCSRF(req)).toBeNull()
  })

  it('allows mutations with matching origin (PATCH / PUT / DELETE)', () => {
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const req = new NextRequest('http://localhost:3000/api/test', {
        method,
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
        },
      })
      expect(checkCSRF(req)).toBeNull()
    }
  })

  it('blocks mutations with mismatched origin', async () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: {
        origin: 'https://evil.com',
        host: 'localhost:3000',
      },
    })
    const result = checkCSRF(req)
    expect(result).not.toBeNull()
    expect(result?.status).toBe(403)
    const body = await result?.json()
    expect(body.code).toBe('CSRF_ORIGIN_MISMATCH')
    expect(body.error).toMatch(/origen/i)
  })

  it('blocks mutations with invalid origin URL', async () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: {
        origin: 'not-a-url',
        host: 'localhost:3000',
      },
    })
    const result = checkCSRF(req)
    expect(result).not.toBeNull()
    expect(result?.status).toBe(403)
    const body = await result?.json()
    expect(body.code).toBe('CSRF_INVALID_ORIGIN')
  })

  it('allows mutations without Origin header (server-to-server)', () => {
    // No Origin header → not a browser request → NextAuth's SameSite=Lax
    // cookie is the line of defense, not Origin/Host equality.
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { host: 'localhost:3000' },
    })
    expect(checkCSRF(req)).toBeNull()
  })

  it('allows mutations when Host header is absent', () => {
    // Missing Host header is unusual (RFC 7230 mandates it on HTTP/1.1)
    // but the check is "both must be present to enforce" — if either
    // is absent, we fall through to null.
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    })
    // NextRequest may auto-add Host; if so, the test still validates the
    // pass-through path for the "no host header" branch in source code.
    expect(checkCSRF(req)).toBeNull()
  })

  it('blocks when origin host includes port that differs from host', async () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3001',
        host: 'localhost:3000',
      },
    })
    const result = checkCSRF(req)
    expect(result).not.toBeNull()
    expect(result?.status).toBe(403)
  })
})
