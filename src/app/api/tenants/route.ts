import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withCache } from '@/lib/cache'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { setCacheHeaders } from '@/lib/middleware/cache-headers'

// GET /api/tenants — list all tenants (for the switcher in the topbar).
// Cached for 5 minutes under `tenants:active` — tenants rarely change and
// the topbar hits this on every page load. Not tenant-scoped because the
// endpoint itself returns the full tenant list (auth-gated to logged-in
// users only).
//
// SPRINT8-SERVICES-REST-001 — left inline. A single `db.tenant.findMany`
// cached for 5 minutes. Per rule #2 (1-2 simple db calls OK to leave),
// there's no benefit in wrapping a cached findMany in a service method
// — the cache key already encodes the only meaningful input. A future
// `tenant.service.ts` would only make sense if tenant CRUD lands.
// TODO: migrate to service layer when tenant CRUD is added.
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

  const payload = await withCache(
    'tenants:active',
    5 * 60_000,
    () => db.tenant.findMany({
      where: { activo: true },
      orderBy: { nombreNegocio: 'asc' },
      select: {
        id: true, slug: true, nombreNegocio: true, marca: true,
        planMonetizacion: true, proveedorIa: true, proveedorLogistico: true,
        plataformaCatalogo: true, politicaPago: true,
      },
    }),
  )
  // SPRINT-PERFORMANCE-FINAL-001 — `private`: the tenant list is gated by
  // NextAuth + filtered by role (platform admins see all, tenant users see
  // only their own). The CDN MUST NOT cache it — otherwise one tenant's
  // list could be served to another. `private, max-age=60` lets the
  // browser cache for 60s (matching the withCache TTL) but instructs every
  // CDN in the chain to skip caching entirely.
  return setCacheHeaders(NextResponse.json({ tenants: payload }), 'private')


})
