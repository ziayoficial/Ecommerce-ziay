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
//
// FIX-SECURITY-AUTH-001 (#20) — requireTenantAccess(tenantId). Any authed
// user used to be able to pollute another tenant's Invoice table.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { monetizationService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// TD-2: Zod schema for invoice generation POST.
const GenerateInvoiceSchema = z.object({
  tenantId: z.string().min(1),
  periodo: z.string().optional(),
}).passthrough()

/**
 * POST /api/monetization/generate-invoice
 *
 * Generate an invoice PDF for trafficker/marketplace commissions in a date range.
 *
 * @security Requires authentication + tenant access (admin/finance role)
 * @returns Invoice id + download URL
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

    const raw = await req.json()
    const parseResult = GenerateInvoiceSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const { tenantId, periodo } = parseResult.data

    // FIX-SECURITY-AUTH-001 (#20) — tenant gate before the invoice upsert.
    const { error } = await requireTenantAccess(tenantId)
    if (error) return error

    const { invoice, details } = await monetizationService.generateInvoice(tenantId, periodo)

    return NextResponse.json({ invoice, details })
  

})
