import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { monetizationService } from '@/lib/services'

// GET /api/monetization/commission?tenantId=...
// Returns list of commission entries (recognized + pending)
//
// SPRINT7-POSTGRES-SERVICES-001 — GET migrated from `db.commissionEntry.findMany`
// + inline totals reduce to `monetizationService.getCommissions`. The POST
// handler (commission recognition upsert) is left inline — its two-moment
// recognition logic doesn't have a 1:1 service method yet. Response shape
// is unchanged.
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

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
  } catch (err) {
    captureError(err as Error, { path: '/api/monetization/commission', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

// POST /api/monetization/commission
// Body: { orderId, etapaReconocimiento: 'datos_completados' | 'despachado' }
// Creates or updates a commission entry, applying the two-moment recognition (Saramantha §17.7)
export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const { orderId, etapaReconocimiento } = await req.json()
    if (!orderId || !etapaReconocimiento) return NextResponse.json({ error: 'orderId and etapaReconocimiento required' }, { status: 400 })

    const order = await db.order.findUnique({ where: { id: orderId }, include: { tenant: true }})
    if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

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
  } catch (err) {
    captureError(err as Error, { path: '/api/monetization/commission', method: 'POST' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
