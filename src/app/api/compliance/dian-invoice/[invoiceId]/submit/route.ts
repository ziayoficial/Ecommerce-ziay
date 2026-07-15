// POST /api/compliance/dian-invoice/[invoiceId]/submit
// Envía una factura electrónica a DIAN vía provider (Alegra/Bsale/Siigo).
//
// SPRINT-DIAN-RETRACTO-001 · P1-1 — DIAN electronic invoicing integration seam.
// `submitToDian()` is the stub that will be wired to the real provider API
// in a follow-up sprint. Today it logs the intent + returns
// `accepted: false` so the caller can surface "ready for provider
// submission" without crashing.
//
// Path params:
//   invoiceId — the Invoice row id (NOT the CUFE)
//
// Auth: admin only — submission to DIAN is a regulated action that
// triggers the consumer acceptance flow + email delivery.

import { NextRequest, NextResponse } from 'next/server'
import { requireRole, requireTenantAccess } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { submitToDian } from '@/lib/compliance/dian-invoicing'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

/**
 * POST /api/compliance/dian-invoice/[invoiceId]/submit
 *
 * Submit a DIAN invoice to the tax authority (DIAN) for formal acceptance.
 *
 * @security Requires authentication + tenant access
 * @returns DIAN submission response
 */
export const POST = withErrorHandling(async (_req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },) => {

  // ── Auth: admin only — regulated DIAN submission ────────────────────
  const { error: roleErr } = await requireRole(['admin'])
  if (roleErr) return roleErr

  const { invoiceId } = await params

  // Resolve the invoice + tenant-guard it. The Invoice row must exist + be
  // a DIAN customer-facing row (orderId not null, cufe not null) — otherwise
  // there's nothing to submit.
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, tenantId: true, orderId: true, cufe: true, dianStatus: true },
  })
  if (!invoice) {
    return NextResponse.json(
      { error: 'Factura no encontrada' },
      { status: 404 },
    )
  }
  if (!invoice.orderId || !invoice.cufe) {
    return NextResponse.json(
      { error: 'La factura no es una factura electrónica DIAN (sin orderId/cufe)' },
      { status: 400 },
    )
  }

  const { error } = await requireTenantAccess(invoice.tenantId)
  if (error) return error

    const result = await submitToDian(invoiceId)
    return NextResponse.json({
      invoiceId,
      ...result,
      dianStatus: result.accepted ? 'accepted' : 'pending_submission',
    })
  

})
