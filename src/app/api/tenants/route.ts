import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withCache } from '@/lib/cache'
import { captureError } from '@/lib/capture-error'

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
export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  try {
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
    return NextResponse.json({ tenants: payload })
  } catch (err) {
    captureError(err as Error, { path: '/api/tenants', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
