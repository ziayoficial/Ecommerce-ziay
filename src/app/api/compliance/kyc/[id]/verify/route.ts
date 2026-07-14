import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { db } from '@/lib/db'
import { recordIdentityVerification } from '@/lib/compliance/kyc-gate'

// POST /api/compliance/kyc/[id]/verify
// Completa una verificación KYC (status pending → verified | failed).
// Recibe la evidencia (hash) + opcionalmente el riskScore del provider.
//
// En prod, este endpoint lo llama el webhook del KYC provider (Onfido/Jumio)
// o el flujo de 2FA TOTP del propio ZIAY.
//
// Body:
//   { status: 'verified' | 'failed', evidenceHash, riskScore?, provider? }
const VerifySchema = z.object({
  status: z.enum(['verified', 'failed']),
  evidenceHash: z.string().min(8),
  riskScore: z.number().min(0).max(1).optional(),
  provider: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { error } = await requireAuth()
  if (error) return error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = VerifySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  try {
    const existing = await db.identityVerification.findUnique({
      where: { id },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Verificación no encontrada' },
        { status: 404 },
      )
    }

    // Tenant guard.
    const { session, error: tErr } = await requireAuth()
    if (tErr) return tErr
    const userTenantId = session?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== existing.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    if (existing.status === 'verified') {
      return NextResponse.json(
        { error: 'La verificación ya está completada' },
        { status: 409 },
      )
    }

    const updated = await recordIdentityVerification(
      id,
      body.status,
      body.evidenceHash,
      body.riskScore,
    )

    // Si se provee un provider, lo persistimos (no está en el helper para
    // mantener la interfaz mínima).
    if (body.provider) {
      await db.identityVerification.update({
        where: { id },
        data: { provider: body.provider },
      })
    }

    return NextResponse.json({
      verificationId: updated.id,
      status: updated.status,
      verifiedAt: updated.verifiedAt,
      expiresAt: updated.expiresAt,
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/compliance/kyc/[id]/verify',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo completar la verificación' },
      { status: 500 },
    )
  }
}
