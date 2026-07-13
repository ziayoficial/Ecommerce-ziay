// ZIAY — Invoice auto-generation endpoint
// POST /api/monetization/generate-invoice
// Body: { tenantId, periodo? } — periodo defaults to current month "YYYY-MM"
//
// Creates or updates the monthly Invoice for a tenant:
// 1. Calculates GMV from all orders in the period
// 2. Determines the commission tramo (4.5% / 3.0% / 1.75%)
// 3. Creates/updates Invoice with totals
// 4. Returns the invoice
//
// SPRINT8-SERVICES-REST-001 — migrated the inline GMV computation + tramo
// resolution + invoice upsert + audit-log write to
// `monetizationService.generateInvoice`. Response shape unchanged; the
// service returns `{ invoice, details }` verbatim.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { monetizationService } from '@/lib/services'

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const body = await req.json()
    const { tenantId, periodo } = body as { tenantId?: string; periodo?: string }

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    const { invoice, details } = await monetizationService.generateInvoice(tenantId, periodo)

    return NextResponse.json({ invoice, details })
  } catch (err) {
    captureError(err as Error, { path: '/api/monetization/generate-invoice', method: 'POST' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
