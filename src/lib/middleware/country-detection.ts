// ─────────────────────────────────────────────────────────────────────────────
// Country detection middleware — Comercio Agéntico study §18 (LATAM expansion).
//
// Resolves the effective country code for an incoming request using a
// priority-ordered cascade:
//
//   1. Explicit `?country=CO` query param (caller override — highest priority)
//   2. `x-country` header (set by edge / CDN / upstream proxy)
//   3. GeoIP lookup from the client IP (currently a stub — a future sprint
//      can wire MaxMind GeoLite2 or Cloudflare's `cf-ipcountry` header)
//   4. Tenant's `countryCode` field (DB-backed fallback — the tenant's home
//      market, configured in /api/tenants settings)
//   5. 'CO' (ZIAY's home market — ultimate default)
//
// The resolved code is attached to the request via the `x-zIay-country`
// header so downstream API routes can read it without re-running the
// cascade. Helpers `getCountryFromRequest` + `getCountryCodeForTenant`
// expose the resolved value to handlers.
//
// SPRINT-MULTICOUNTRY-001
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'

const log = getLogger('country-detection')

/** Countries supported by the multi-country rollout (study §18). */
export const SUPPORTED_COUNTRIES = ['CO', 'MX', 'BR', 'US', 'PE', 'CL', 'AR'] as const
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number]

/** Normalize + validate an input string as a country code. Returns null if invalid. */
export function normalizeCountryCode(input: string | null | undefined): SupportedCountry | null {
  if (!input) return null
  const upper = input.trim().toUpperCase()
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(upper)
    ? (upper as SupportedCountry)
    : null
}

/**
 * Extract the client IP from a NextRequest. Honors X-Forwarded-For and
 * X-Real-IP headers (typical behind Caddy / Vercel / Cloudflare).
 */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xReal = req.headers.get('x-real-ip')
  if (xReal) return xReal.trim()
  // @ts-expect-error — `ip` exists at runtime in some deployment targets
  if (typeof req.ip === 'string' && req.ip) return req.ip
  return 'unknown'
}

/**
 * GeoIP lookup — currently a stub that reads the `cf-ipcountry` header
 * (set by Cloudflare) when present. A future sprint can wire MaxMind
 * GeoLite2 (offline DB) or a managed GeoIP API; the function signature
 * stays the same.
 */
function geoipLookup(ip: string, req: NextRequest): string | null {
  // Cloudflare sets `cf-ipcountry` as a 2-letter ISO code.
  const cfCountry = req.headers.get('cf-ipcountry')
  if (cfCountry) return cfCountry.toUpperCase()
  // Vercel sets `x-vercel-ip-country`.
  const vercelCountry = req.headers.get('x-vercel-ip-country')
  if (vercelCountry) return vercelCountry.toUpperCase()
  // No GeoIP DB wired yet — log the IP so the operator can manually
  // inspect traffic patterns while the GeoIP integration is pending.
  if (ip !== 'unknown') {
    log.debug({ ip }, 'GeoIP lookup miss — no resolver configured')
  }
  return null
}

/**
 * Look up a tenant's `countryCode` from the DB. Used as the final fallback
 * before the hard-coded 'CO' default. Cached per-request via the closure.
 */
export async function getCountryCodeForTenant(tenantId: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null
  try {
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { countryCode: true },
    })
    return tenant?.countryCode ?? null
  } catch (err) {
    log.warn(
      { tenantId, err: err instanceof Error ? err.message : String(err) },
      'tenant countryCode lookup failed — falling back',
    )
    return null
  }
}

/**
 * Run the country detection cascade for a request.
 *
 * Order:
 *   1. `?country=XX` query param
 *   2. `x-country` header
 *   3. GeoIP from client IP (cf-ipcountry / x-vercel-ip-country headers)
 *   4. Tenant's `countryCode` (when `tenantId` is provided)
 *   5. 'CO' (home market default)
 *
 * Returns the resolved 2-letter ISO code (always uppercase, always one of
 * SUPPORTED_COUNTRIES).
 */
export async function detectCountry(
  req: NextRequest,
  tenantId?: string | null,
): Promise<SupportedCountry> {
  // 1. Explicit query param
  const queryCountry = normalizeCountryCode(req.nextUrl.searchParams.get('country'))
  if (queryCountry) return queryCountry

  // 2. x-country header
  const headerCountry = normalizeCountryCode(req.headers.get('x-country'))
  if (headerCountry) return headerCountry

  // 3. GeoIP
  const ip = getClientIp(req)
  const geoipCountry = normalizeCountryCode(geoipLookup(ip, req))
  if (geoipCountry) return geoipCountry

  // 4. Tenant fallback
  const tenantCountry = normalizeCountryCode(await getCountryCodeForTenant(tenantId))
  if (tenantCountry) return tenantCountry

  // 5. Home market default
  return 'CO'
}

/**
 * Convenience: read the country code that `countryDetectionMiddleware`
 * stamped on the request. Falls back to 'CO' when the header is absent
 * (e.g. when the middleware didn't run for the route).
 */
export function getCountryFromRequest(req: NextRequest): SupportedCountry {
  return normalizeCountryCode(req.headers.get('x-ziay-country')) ?? 'CO'
}

/**
 * Next.js middleware wrapper that runs the country detection cascade and
 * attaches the result as the `x-ziay-country` header on the outgoing
 * response + the forwarded request. Routes that want country-aware
 * behaviour should be wired through this middleware in `middleware.ts`.
 *
 * The middleware reads `tenantId` from the query string (best-effort) so
 * the tenant fallback can fire. Authenticated routes that resolve the
 * tenant from the session should call `detectCountry()` directly with the
 * resolved tenantId.
 */
export async function countryDetectionMiddleware(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenantId') ?? null
  const country = await detectCountry(req, tenantId)
  const res = NextResponse.next()
  res.headers.set('x-ziay-country', country)
  // Also set on the request headers so downstream handlers in the same
  // invocation can read it without re-running the cascade.
  req.headers.set('x-ziay-country', country)
  return res
}
