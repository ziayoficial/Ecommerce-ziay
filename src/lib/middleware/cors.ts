// ZIAY — CORS middleware
//
// SPRINT-HARDENING-FINAL-001 · §2 — Cross-Origin Resource Sharing.
//
// Allows cross-origin requests ONLY from origins in the allow-list:
//   1. env `CORS_ALLOWED_ORIGINS` (comma-separated, prod)
//   2. fallback: localhost:3000 / 3001 + 127.0.0.1:3000 (dev)
//
// `Access-Control-Allow-Credentials: true` is set so the NextAuth
// session cookie is sent on cross-origin XHRs. Combined with a strict
// allow-list (NOT `*`), this preserves the cookie while blocking
// arbitrary origins.
//
// Preflight (`OPTIONS`) requests are answered with 204 + the CORS
// headers — the browser caches the preflight for 24h
// (`Access-Control-Max-Age`) so a typical SPA flow does 1 preflight
// per session, not 1 per request.
//
// Edge-runtime safe: imports only `next/server`. No Prisma, no bcrypt,
// no Node-only modules.

import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
]

/**
 * Resolve the allow-list of origins. Honors `CORS_ALLOWED_ORIGINS` env
 * var (comma-separated); falls back to localhost defaults in dev.
 */
export function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS
  if (envOrigins) {
    return envOrigins
      .split(',')
      .map(o => o.trim())
      .filter(o => o.length > 0)
  }
  return DEFAULT_ALLOWED_ORIGINS
}

/**
 * Apply CORS headers to a response IF the request's Origin is in the
 * allow-list. Responses to disallowed origins get no CORS headers —
 * the browser's default Same-Origin policy applies.
 */
export function setCorsHeaders(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const origin = request.headers.get('origin')
  const allowedOrigins = getAllowedOrigins()

  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    )
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Request-Id',
    )
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Max-Age', '86400') // 24h preflight cache
    // Vary: Origin so a CDN doesn't cache a response with one origin's
    // ACAO header and serve it to another origin (which would fail the
    // browser's CORS check).
    const existingVary = response.headers.get('vary')
    response.headers.set(
      'vary',
      existingVary ? `${existingVary}, Origin` : 'Origin',
    )
  }

  return response
}

/**
 * Handle a CORS preflight (`OPTIONS`) request.
 *
 * Returns a 204 response with CORS headers IF the request is OPTIONS,
 * otherwise returns `null` (caller continues normal middleware flow).
 *
 * Must run BEFORE the auth check — preflight requests don't carry
 * credentials, so the NextAuth JWT lookup would 401 them and break
 * the browser's CORS dance.
 */
export function handlePreflight(request: NextRequest): NextResponse | null {
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 })
    return setCorsHeaders(request, response)
  }
  return null
}
