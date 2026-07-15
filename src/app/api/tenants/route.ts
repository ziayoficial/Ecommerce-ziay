import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { setCacheHeaders } from '@/lib/middleware/cache-headers'
import { tenantsService } from '@/lib/services'

// GET /api/tenants — list all tenants (for the switcher in the topbar).
// Cached for 5 minutes under `tenants:active` — tenants rarely change and
// the topbar hits this on every page load. Not tenant-scoped because the
// endpoint itself returns the full tenant list (auth-gated to logged-in
// users only).
//
// SPRINT-BACKEND-FINAL-001 — DB access + cache wrapper migrated to
// `tenantsService.listActiveTenants`. The route owns: auth, response
// shaping, cache headers.
/**
 * GET /api/tenants
 *
 * List tenants (platform admins see all; tenant users see only their own).
 *
 * @security Requires authentication (platform admin for full list)
 * @returns Tenant list
 */
export const GET = withErrorHandling(async () => {

  const { error } = await requireAuth()
  if (error) return error

  const payload = await tenantsService.listActiveTenants()

  // SPRINT-PERFORMANCE-FINAL-001 — `private`: the tenant list is gated by
  // NextAuth + filtered by role (platform admins see all, tenant users see
  // only their own). The CDN MUST NOT cache it — otherwise one tenant's
  // list could be served to another. `private, max-age=60` lets the
  // browser cache for 60s (matching the withCache TTL) but instructs every
  // CDN in the chain to skip caching entirely.
  return setCacheHeaders(NextResponse.json({ tenants: payload }), 'private')


})
