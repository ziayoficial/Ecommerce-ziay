// ZIAY — Tenants service layer.
//
// Wraps tenant reads. Currently a single cached `findMany` for the
// topbar tenant switcher, but the seam is here for when tenant CRUD
// lands (creation wizard, plan upgrades, deactivation).
//
// SPRINT-BACKEND-FINAL-001 — service layer. Extracted from
// `/api/tenants/route.ts`.

import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'
import { withCache } from '@/lib/cache'

export const tenantsService = {
  /**
   * List active tenants ordered by `nombreNegocio`. Cached for 5 minutes
   * under `tenants:active` — tenants rarely change and the topbar hits
   * this on every page load. The cache key encodes the only meaningful
   * input (no tenant-scoping here — the route itself returns the full
   * tenant list, auth-gated to logged-in users).
   *
   * Returns the tenant projection used by the topbar switcher:
   * `id, slug, nombreNegocio, marca, planMonetizacion, proveedorIa,
   *  proveedorLogistico, plataformaCatalogo, politicaPago`.
   */
  async listActiveTenants() {
    try {
      return await withCache(
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
    } catch (err) {
      captureError(err as Error, {
        service: 'tenants',
        method: 'listActiveTenants',
      })
      throw new Error('Failed to fetch tenants')
    }
  },
}

export type TenantsService = typeof tenantsService
