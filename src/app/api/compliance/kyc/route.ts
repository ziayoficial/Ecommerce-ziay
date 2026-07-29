import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTenantId } from '@/lib/auth-helpers'
import {
  requireIdentityVerification,
  getActiveVerification,
  type KycTriggerType,
} from '@/lib/compliance/kyc-gate'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// POST /api/compliance/kyc
// Inicia una verificación de identidad (Ley 2573 de 2026).
// Crea un `IdentityVerification` pending si no hay una vigente.
//
// Body:
//   { tenantId, userId, triggerType, triggerRef, orderAmount? }
//
// Response:
//   - Si ya hay KYC vigente → 200 { verified: true, verificationId }
//   - Si se requiere y se crea pending → 202 { verified: false, verificationId, reason }
const InitiateSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  triggerType: z.enum([
    'credit_purchase',
    'installment_plan',
    'high_value_order',
  ]) as z.ZodType<KycTriggerType>,
  triggerRef: z.string().min(1),
  orderAmount: z.number().nonnegative().optional(),
})

/**
 * POST /api/compliance/kyc
 *
 * Create a KYC verification request for a customer.
 *
 * @security Requires authentication + tenant access
 * @returns Created KYC request
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
  const parsed = InitiateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { error } = await resolveTenantId(body.tenantId)
  if (error) return error

    const result = await requireIdentityVerification(
      body.tenantId,
      body.userId,
      body.triggerType,
      body.triggerRef,
      body.orderAmount,
    )

    if (result.verified) {
      return NextResponse.json({
        verified: true,
        verificationId: result.verificationId ?? null,
      })
    }
    return NextResponse.json(
      {
        verified: false,
        verificationId: result.verificationId ?? null,
        reason: result.reason,
      },
      { status: 202 },
    )
  

})

// GET /api/compliance/kyc?tenantId=X&userId=Y
// Devuelve el estado KYC vigente para el usuario (o null si no tiene).
/**
 * GET /api/compliance/kyc
 *
 * List KYC verification records (Ley 2573 Colombia — required for credit/installments).
 *
 * @security Requires authentication + tenant access
 * @returns KYC record list
 */
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined
  const userId = req.nextUrl.searchParams.get('userId') || undefined

  if (!tenantId || !userId) {
    return NextResponse.json(
      { error: 'tenantId y userId son requeridos' },
      { status: 400 },
    )
  }

  const { error } = await resolveTenantId(tenantId)
  if (error) return error

    const active = await getActiveVerification(tenantId, userId)
    if (!active) {
      return NextResponse.json({ verified: false, verification: null })
    }
    return NextResponse.json({
      verified: true,
      verification: {
        id: active.id,
        method: active.method,
        provider: active.provider,
        verifiedAt: active.verifiedAt,
        expiresAt: active.expiresAt,
        triggerType: active.triggerType,
        triggerRef: active.triggerRef,
      },
    })
  

})
