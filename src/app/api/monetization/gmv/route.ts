import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/monetization/gmv?tenantId=...&period=2026-07
// Returns GMV (sum of orders with origen='agente_whatsapp'), commission recognized,
// pending commission, current tramo, fee base, and projected invoice total.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  // All agent-originated orders for this tenant
  const orders = await db.order.findMany({
    where: { tenantId, origen: 'agente_whatsapp' },
    include: { commissionEntries: true }
  })

  const gmv = orders.reduce((s, o) => s + o.total, 0)
  const gmvPaid = orders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0)

  // Tramo (Saramantha §17.3)
  const tramo = gmv < 10000000 ? { label: '0-10M', pct: 4.5 }
    : gmv < 40000000 ? { label: '10-40M', pct: 3 }
    : { label: '40M+', pct: 1.75 }

  const comisionCalculada = gmv * tramo.pct / 100

  // Recognized commission (already in commissionEntries)
  const reconocida = orders.reduce((s, o) => s + o.commissionEntries.reduce((ss, ce) => ss + ce.reconocidaMonto, 0), 0)
  const pendiente = comisionCalculada - reconocida

  // Invoice for current period
  const periodo = new Date().toISOString().slice(0, 7)
  const invoice = await db.invoice.findFirst({ where: { tenantId, periodo }, orderBy: { createdAt: 'desc' }})

  return NextResponse.json({
    tenant: { slug: tenant.slug, nombreNegocio: tenant.nombreNegocio, planMonetizacion: tenant.planMonetizacion },
    periodo,
    gmv: Math.round(gmv),
    gmvPaid: Math.round(gmvPaid),
    ordenes: orders.length,
    tramo: tramo.label,
    comisionPct: tramo.pct,
    comisionCalculada: Math.round(comisionCalculada),
    comisionReconocida: Math.round(reconocida),
    comisionPendiente: Math.round(pendiente),
    feeBaseMensual: tenant.feeBaseMensual,
    totalEstimado: Math.round(tenant.feeBaseMensual + comisionCalculada),
    invoice: invoice ? { id: invoice.id, estado: invoice.estado, total: invoice.total, emitidaAt: invoice.emitidaAt } : null,
    // Embudo (Saramantha §15.1) — orders by status
    embudo: {
      pendiente_confirmacion: orders.filter(o => o.status === 'pending_confirmation').length,
      datos_completados: orders.filter(o => o.status === 'datos_completados').length,
      despachado: orders.filter(o => o.status === 'despachado').length,
      intento_cancelacion: orders.filter(o => o.status === 'intent_cancelacion').length,
    },
  })
}
