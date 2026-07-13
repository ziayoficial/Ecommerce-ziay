import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'

// GET /api/monetization/commission?tenantId=...
// Returns list of commission entries (recognized + pending)
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

    const entries = await db.commissionEntry.findMany({
      where: { tenantId },
      include: { order: { select: { number: true, status: true, total: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const totals = entries.reduce((acc, e) => {
      acc.gmv += e.gmv
      acc.comisionTotal += e.comisionTotal
      acc.reconocida += e.reconocidaMonto
      return acc
    }, { gmv: 0, comisionTotal: 0, reconocida: 0 })

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
      totals: {
        gmv: Math.round(totals.gmv),
        comisionTotal: Math.round(totals.comisionTotal),
        reconocida: Math.round(totals.reconocida),
        pendiente: Math.round(totals.comisionTotal - totals.reconocida),
      },
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

    // Upsert — one entry per order
    const existing = await db.commissionEntry.findFirst({ where: { orderId }})
    const entry = existing
      ? await db.commissionEntry.update({ where: { id: existing.id }, data: { reconocidaPct, reconocidaMonto, etapaReconocimiento, reconocidaAt: new Date() }})
      : await db.commissionEntry.create({ data: { tenantId: tenant.id, orderId, gmv, comisionPct: pct, comisionTotal, reconocidaPct, reconocidaMonto, etapaReconocimiento, reconocidaAt: new Date() }})

    return NextResponse.json({ entry })
  } catch (err) {
    captureError(err as Error, { path: '/api/monetization/commission', method: 'POST' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
