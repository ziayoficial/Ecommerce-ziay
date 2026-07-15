// POST /api/compliance/retracto
// Procesa una solicitud de retracto (Ley 1480 de 2011 Art 47).
//
// SPRINT-DIAN-RETRACTO-001 · P1-2 — closes the gap flagged by
// AUDIT-LEGAL-COMPLIANCE-001: the platform had ZERO retracto flow despite
// being mandatory for online purchases under Colombian consumer law.
//
// Body:
//   { orderId, tenantId, reason? }
//
// Response (200):
//   { accepted: true, refundDeadline, message }   — retracto procesado
//   { accepted: false, message }                  — window expirada / ya cancelada
//
// Auth: any authenticated tenant user (the consumer's request can be
// submitted by an agent on their behalf, or by the consumer via WhatsApp
// — the keyword handler in /api/webhooks/whatsapp routes "RETRACTO" here).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { processRetracto } from '@/lib/compliance/retracto'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const RetractoSchema = z.object({
  orderId: z.string().min(1),
  tenantId: z.string().min(1),
  reason: z.string().max(500).optional(),
})

/**
 * POST /api/compliance/retracto
 *
 * Procesa un retracto de venta (Ley 1480 Estatuto del Consumidor — derecho de retracto 14 días).
 *
 * @security Requires authentication + tenant access
 * @returns Retracto record + refund status
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = RetractoSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { orderId, tenantId, reason } = parsed.data

  // Tenant guard — verifies the caller has access to this tenant before
  // the retracto logic runs. The retracto function itself also double-
  // checks `order.tenantId === tenantId` for defense-in-depth.
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

    const result = await processRetracto(orderId, tenantId, reason)
    // `accepted: false` is a business outcome (window expired / already
    // cancelled), NOT a 4xx/5xx — return 200 so the caller can surface
    // the Spanish message to the consumer.
    return NextResponse.json(result, { status: 200 })
  

})
