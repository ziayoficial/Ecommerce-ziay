import { NextResponse } from 'next/server'

/**
 * CDN cache headers for different response types.
 *
 * SPRINT-PERFORMANCE-FINAL-001 · §2 — optimise caching for the CDN edge.
 *
 * Why a helper instead of inlining `Cache-Control` strings at each call site:
 *   - The CDN (CloudFront / Caddy) reads `s-maxage` for its own cache and
 *     `max-age` for the browser cache. Getting these right per route type
 *     matters: a 1-year immutable header on `/api/health` would mask
 *     outages; a `no-cache` on `/.well-known/ucp` would force a round-trip
 *     on every agent discovery request.
 *   - Centralising the values here means a future tuning pass (e.g.
 *     dropping `stale-while-revalidate` once we ship proper cache
 *     invalidation hooks) is a one-line change per type, not a grep-and-
 *     replace across N route files.
 *
 * Usage:
 *   ```ts
 *   const res = NextResponse.json(data)
 *   return setCacheHeaders(res, 'public-short')
 *   ```
 *
 * The function mutates + returns the same NextResponse so it can be chained
 * inline at the return statement.
 */

export function setCacheHeaders(
  response: NextResponse,
  type: 'public-short' | 'public-long' | 'public-immutable' | 'private' | 'no-cache'
): NextResponse {
  switch (type) {
    case 'public-short':
      // 60s CDN cache, 5s browser stale-while-revalidate
      response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=5')
      break
    case 'public-long':
      // 1h CDN cache, 5min browser
      response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=300')
      break
    case 'public-immutable':
      // 1 year — for versioned assets
      response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
      break
    case 'private':
      // User-specific — browser only, no CDN
      response.headers.set('Cache-Control', 'private, max-age=60')
      break
    case 'no-cache':
      response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      break
  }
  return response
}
