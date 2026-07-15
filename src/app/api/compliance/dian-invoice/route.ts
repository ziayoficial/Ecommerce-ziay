// POST /api/compliance/dian-invoice
// Genera una factura electrónica DIAN (Decreto 745 de 2014) para una orden.
//
// SPRINT-DIAN-RETRACTO-001 · P1-1 — closes the gap flagged by
// AUDIT-LEGAL-COMPLIANCE-001: the previous /api/monetization/generate-invoice
// returned a JSON "invoice" that is NOT a DIAN-compliant factura electrónica.
//
// Body:
//   { orderId, tenantId }
//
// Response (201):
//   DianInvoiceData — invoiceNumber, cufe, issueDate, items, totals,
//   dianStatus='pending_submission', dianValidationUrl, qrCodeData.
//
// Auth: admin/finance/operator only (the route triggers billing artefact
// creation — not exposed to agents/customers).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, requireTenantAccess } from '@/lib/auth-helpers'
import { generateDianInvoice } from '@/lib/compliance/dian-invoicing'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const GenerateSchema = z.object({
  orderId: z.string().min(1),
  tenantId: z.string().min(1),
})

/**
 * POST /api/compliance/dian-invoice
 *
 * Generate a DIAN electronic invoice draft for an order.
 *
 * @security Requires authentication + tenant access
 * @returns Created invoice draft
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

  // ── Auth: admin/finance/operator only — billing artefact creation ───
  // `requireRole` checks the session role against the allowed list. We
  // accept `admin` (tenant super-user), `finance` (platform billing),
  // and `operator` (back-office fulfilment) — same roles that can already
  // hit /api/monetization/generate-invoice.
  const { error: roleErr } = await requireRole(['admin', 'finance', 'operator'])
  if (roleErr) return roleErr

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = GenerateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { orderId, tenantId } = parsed.data

  // Tenant guard — defense-in-depth on top of the role check (a `finance`
  // platform user has no tenantId so requireRole lets them through; this
  // verifies they're acting on a tenant they're authorized to bill).
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

    const invoice = await generateDianInvoice(orderId, tenantId)
    return NextResponse.json(invoice, { status: 201 })
  

})
