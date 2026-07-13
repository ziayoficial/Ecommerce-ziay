// ZIAY — Invoice auto-generation endpoint
// POST /api/monetization/generate-invoice
// Body: { tenantId, periodo? } — periodo defaults to current month "YYYY-MM"
//
// Creates or updates the monthly Invoice for a tenant:
// 1. Calculates GMV from all orders in the period
// 2. Determines the commission tramo (4.5% / 3.0% / 1.75%)
// 3. Creates/updates Invoice with totals
// 4. Returns the invoice

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth()
  if (error) return error

  try {
    const body = await req.json()
    const { tenantId, periodo } = body as { tenantId?: string; periodo?: string }

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    // Default to current month if not specified
    const now = new Date()
    const period = periodo || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    // Parse period to date range
    const [year, month] = period.split('-').map(Number)
    const startOfMonth = new Date(year, month - 1, 1)
    const endOfMonth = new Date(year, month, 0, 23, 59, 59)

    // 1. Calculate GMV from all orders in the period
    const orders = await db.order.findMany({
      where: {
        tenantId,
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
      select: { total: true, status: true },
    })

    // Only count orders that are not cancelled
    const validOrders = orders.filter(o => o.status !== 'cancelled' && o.status !== 'intent_cancelacion')
    const gmv = validOrders.reduce((sum, o) => sum + o.total, 0)

    // 2. Determine commission tramo
    const tramo = gmv < 10_000_000
      ? { label: '0-10M', pct: 4.5 }
      : gmv < 40_000_000
      ? { label: '10-40M', pct: 3.0 }
      : { label: '40M+', pct: 1.75 }

    const comisionTotal = Math.round(gmv * tramo.pct / 100)
    const feeBase = 0 // No additional fee base for now
    const total = feeBase + comisionTotal

    // 3. Create or update Invoice
    const existing = await db.invoice.findFirst({
      where: { tenantId, periodo: period },
    })

    let invoice
    if (existing) {
      invoice = await db.invoice.update({
        where: { id: existing.id },
        data: {
          gmvTotal: gmv,
          feeBase,
          comisionTotal,
          tramoAplicado: tramo.label,
          total,
        },
      })
    } else {
      invoice = await db.invoice.create({
        data: {
          tenantId,
          periodo: period,
          gmvTotal: gmv,
          feeBase,
          comisionTotal,
          tramoAplicado: tramo.label,
          total,
          estado: 'borrador',
        },
      })
    }

    // 4. Audit log
    await db.auditLog.create({
      data: {
        action: 'invoice_generated',
        entity: 'invoice',
        entityId: invoice.id,
        meta: JSON.stringify({
          tenantId,
          periodo: period,
          gmv,
          tramo: tramo.label,
          comisionPct: tramo.pct,
          comisionTotal,
          orderCount: validOrders.length,
        }),
      },
    })

    return NextResponse.json({
      invoice,
      details: {
        periodo: period,
        orderCount: validOrders.length,
        gmv,
        tramo: tramo.label,
        comisionPct: tramo.pct,
        comisionTotal,
        total,
      },
    })
  } catch (err) {
    captureError(err as Error, { path: '/api/monetization/generate-invoice', method: 'POST' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
