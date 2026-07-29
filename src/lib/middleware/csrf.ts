// ZIAY — CSRF protection middleware
//
// SPRINT-HARDENING-FINAL-001 · §4 — defense-in-depth CSRF check for
// mutation requests (POST / PATCH / PUT / DELETE).
//
// NextAuth already issues its own CSRF token for `/api/auth/*` routes
// (double-submit cookie pattern). This module adds an Origin/Host
// equality check for ALL non-NextAuth mutation routes — it does NOT
// replace NextAuth's token, it layers on top.
//
// Threat model:
//   - A malicious site `<evil.com>` POSTs to `https://app.ziay.co/api/orders`
//     while the victim is logged in. The browser sends the victim's
//     session cookie (SameSite=Lax allows cross-site POSTs on top-level
//     navigations only, but a fetch() from a cross-site page is blocked
//     by default — however we don't rely on that alone).
//   - Our check: if `Origin` header is present AND its host ≠ the
//     `Host` header, reject with 403.
//   - If `Origin` is absent (e.g. curl, server-to-server, native app),
//     we allow the request — NextAuth's SameSite=Lax cookie + the
//     session requirement already block cross-site forgeries that
//     rely on the cookie being sent automatically.
//
// Edge-runtime safe: imports only `next/server`.

import { NextRequest, NextResponse } from 'next/server'

/**
 * Methods that DON'T mutate state — exempt from CSRF checks.
 * Per RFC 9110 §9.1 these are "safe" methods.
 */
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

/**
 * Check a mutation request for CSRF.
 *
 * @returns `null` if the request passes; a 403 NextResponse if it fails.
 *
 * Failure modes:
 *   - `CSRF_ORIGIN_MISMATCH` — Origin header's host ≠ Host header.
 *   - `CSRF_INVALID_ORIGIN`  — Origin header is malformed (not a URL).
 *
 * Spanish error messages match the rest of the API surface.
 */
export function checkCSRF(request: NextRequest): NextResponse | null {
  if (SAFE_METHODS.includes(request.method)) return null

  const origin = request.headers.get('origin')
  const host = request.headers.get('host')

  // Only enforce when BOTH Origin and Host are present. A request with
  // no Origin header is either same-origin (browsers send Origin on
  // CORS preflights + POST forms) or non-browser (curl, server-to-server)
  // — neither is a CSRF vector that Origin-checking can stop.
  if (origin && host) {
    try {
      const originHost = new URL(origin).host
      if (originHost !== host) {
        return NextResponse.json(
          {
            error: 'CSRF: origen no permitido',
            code: 'CSRF_ORIGIN_MISMATCH',
          },
          { status: 403 },
        )
      }
    } catch {
      return NextResponse.json(
        {
          error: 'CSRF: origen inválido',
          code: 'CSRF_INVALID_ORIGIN',
        },
        { status: 403 },
      )
    }
  }

  // For same-origin requests (no Origin header, e.g. curl), allow if
  // they have a valid session cookie. NextAuth's httpOnly cookie is
  // SameSite=Lax, which provides CSRF protection for browser requests.
  // This check is mainly for API clients that send Origin.

  return null
}
