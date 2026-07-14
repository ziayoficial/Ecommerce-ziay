import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, requireTenantAccess } from '@/lib/auth-helpers'
import { monetizationService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// TD-2: Zod schema for commission POST.
const CommissionPostSchema = z.object({
  orderId: z.string().min(1),
  etapaReconocimiento: z.enum(['datos_completados', 'despachado']),
}).passthrough()

// GET /api/monetization/commission?tenantId=...
// Returns list of commission entries (recognized + pending)
//
// V6 (AUDIT-FINAL-SEC-001): previamente se aceptaba `?tenantId=` del query
// sin verificar que el caller perteneciera a ese tenant. Ahora usamos
// requireTenantAccess(tenantId) — cualquier intento cross-tenant retorna 403.
//
// SPRINT7-POSTGRES-SERVICES-001 — GET migrated from `db.commissionEntry.findMany`
// + inline totals reduce to `monetizationService.getCommissions`. The POST
// handler (commission recognition upsert) is left inline — its two-moment
// recognition logic doesn't have a 1:1 service method yet. Response shape
// is unchanged.
/**
 * GET /api/monetization/commission
 *
 * List commission entries per trafficker / marketplace / order.
 *
 * @security Requires authentication + tenant access
 * @returns Commission entry list
 */
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

    const { entries, totals } = await monetizationService.getCommissions(tenantId)

    return NextResponse.json({
      entries: entries.map(e => ({
        id: e.id,
        orderId: e.orderId,
        orderNumber: e.order.number,
        orderStatus: e.order.status,
        gmv: e.gmv,
        comisionPct: e.comisionPct,
        comisionTotal: e.comisionTotal,
        reconocidaPct: e.reconocidaPct,
        reconocidaMonto: e.reconocidaMonto,
        etapaReconocimiento: e.etapaReconocimiento,
        reconocidaAt: e.reconocidaAt,
        createdAt: e.createdAt,
      })),
      totals,
    })
  

})

// POST /api/monetization/commission
// Body: { orderId, etapaReconocimiento: 'datos_completados' | 'despachado' }
// Creates or updates a commission entry, applying the two-moment recognition (Saramantha §17.7)
//
// V6 (AUDIT-FINAL-SEC-001): verificamos que el caller pertenezca al tenant
// del order (requireTenantAccess). Previamente cualquier usuario authed
// podía crear/actualizar commission entries para cualquier order.
/**
 * POST /api/monetization/commission
 *
 * Create / upsert a commission entry (uses upsert to avoid the POST race condition).
 *
 * @security Requires authentication + tenant access (admin/finance role)
 * @returns Created/updated commission entry
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

  // Auth primero — necesitamos la sesión para errores 401 tempranos.
  const { error: authErr } = await requireAuth()
  if (authErr) return authErr

    const raw = await req.json()
    const parseResult = CommissionPostSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const { orderId, etapaReconocimiento } = parseResult.data

    const order = await db.order.findUnique({ where: { id: orderId }, include: { tenant: true }})
    if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

    // Tenant guard — el caller debe pertenecer al tenant del order.
    const { error: tenantErr } = await requireTenantAccess(order.tenantId)
    if (tenantErr) return tenantErr

    const tenant = order.tenant
    const gmv = order.total
    // Determine tramo from current GMV of tenant
    const allOrders = await db.order.findMany({ where: { tenantId: tenant.id, origen: 'agente_whatsapp' }})
    const totalGmv = allOrders.reduce((s, o) => s + o.total, 0)
    const pct = totalGmv < 10000000 ? 4.5 : totalGmv < 40000000 ? 3 : 1.75
    const comisionTotal = gmv * pct / 100
    // §17.7: 50% at "Datos completados", 100% at "Despachado"
    const reconocidaPct = etapaReconocimiento === 'despachado' ? 100 : etapaReconocimiento === 'datos_completados' ? 50 : 0
    const reconocidaMonto = comisionTotal * reconocidaPct / 100

    // Upsert — one entry per order. `orderId @unique` (added in FIX-1-DB-001)
    // lets us replace the racy `findFirst + update/create` with a true `upsert`,
    // closing the window where 2 concurrent requests could both pass findFirst
    // and both create duplicate entries.
    //
    // Preserve original behavior: on UPDATE we only touch the recognition fields
    // (reconocidaPct/Monto/etapa/At) — gmv/comisionPct/comisionTotal stay as the
    // values captured at first create. On CREATE we persist the full snapshot.
    const entry = await db.commissionEntry.upsert({
      where: { orderId },
      update: {
        reconocidaPct,
        reconocidaMonto,
        etapaReconocimiento,
        reconocidaAt: new Date(),
      },
      create: {
        tenantId: tenant.id,
        orderId,
        gmv,
        comisionPct: pct,
        comisionTotal,
        reconocidaPct,
        reconocidaMonto,
        etapaReconocimiento,
        reconocidaAt: new Date(),
      },
    })

    return NextResponse.json({ entry })
  

})
