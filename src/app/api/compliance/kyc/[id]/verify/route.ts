import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireTenantAccess } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { recordIdentityVerification } from '@/lib/compliance/kyc-gate'
import { verifyTOTP } from '@/lib/totp'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// POST /api/compliance/kyc/[id]/verify
// Completa una verificación KYC (status pending → verified | failed).
// Recibe la evidencia (hash) + opcionalmente el riskScore del provider.
//
// En prod, este endpoint lo llama el webhook del KYC provider (Onfido/Jumio)
// o el flujo de 2FA TOTP del propio ZIAY.
//
// V1 (AUDIT-FINAL-SEC-001): previamente cualquier usuario autenticado podía
// marcar cualquier IdentityVerification como `verified` con un evidenceHash
// arbitrario. Ahora exigimos:
//   1. Sesión autenticada + check de tenant (requireTenantAccess).
//   2. Rol admin/finance (solo ellos pueden verificar).
//   3. Para method='2fa_totp': código TOTP del usuario verificado.
//   4. Para method='kyc_provider' (y otros métodos de proveedor): se exige
//      `providerSignature` y se rechaza con 501 hasta integrar un proveedor
//      KYC real (Onfido/Jumio) que valide la firma contra su clave pública.
//
// Body:
//   { status: 'verified' | 'failed', evidenceHash, riskScore?, provider?,
//     totpCode?, providerSignature? }
const VerifySchema = z.object({
  status: z.enum(['verified', 'failed']),
  evidenceHash: z.string().min(8),
  riskScore: z.number().min(0).max(1).optional(),
  provider: z.string().optional(),
  totpCode: z.string().optional(),
  providerSignature: z.string().optional(),
})

export const POST = withErrorHandling(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {

  const { id } = await params

  // 1) Auth + tenant scoping — requireTenantAccess internally calls
  //    requireAuth and checks session.user.tenantId against the verification's
  //    tenantId. We need the session upfront for the role check below, so we
  //    call requireAuth first and then re-check tenant via requireTenantAccess
  //    once we know the verification's tenantId.
  const { session, error: authErr } = await requireAuth()
  if (authErr) return authErr

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

    const existing = await db.identityVerification.findUnique({
      where: { id },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Verificación no encontrada' },
        { status: 404 },
      )
    }

    // 2) Tenant guard — platform admins (no tenantId on session) bypass.
    const tenantCheck = await requireTenantAccess(existing.tenantId)
    if (tenantCheck.error) return tenantCheck.error

    // 3) Role check — only admin/finance can mark a verification as
    //    verified/failed. This closes the self-verify bypass (a regular
    //    user could previously verify their own KYC).
    const role = session?.user?.role
    if (role !== 'admin' && role !== 'finance') {
      return NextResponse.json(
        { error: 'Forbidden: solo admin o finance pueden verificar' },
        { status: 403 },
      )
    }

    if (existing.status === 'verified') {
      return NextResponse.json(
        { error: 'La verificación ya está completada' },
        { status: 409 },
      )
    }

    // 4) Method-specific evidence verification.
    //
    // 2fa_totp: the user being verified must supply a valid TOTP code from
    // their authenticator app. We look up their TwoFactorConfig by
    // `traffickerId = verification.userId` and verify the code against the
    // stored (encrypted) secret.
    if (existing.method === '2fa_totp') {
      if (!body.totpCode) {
        return NextResponse.json(
          { error: 'Código TOTP requerido para verificación 2fa_totp' },
          { status: 400 },
        )
      }
      if (!existing.userId) {
        return NextResponse.json(
          { error: 'La verificación no tiene usuario asociado para TOTP' },
          { status: 400 },
        )
      }
      const userConfig = await db.twoFactorConfig.findFirst({
        where: { traffickerId: existing.userId },
      })
      if (!userConfig?.secret) {
        return NextResponse.json(
          { error: '2FA no configurado para el usuario' },
          { status: 400 },
        )
      }
      if (!verifyTOTP(body.totpCode, userConfig.secret)) {
        return NextResponse.json(
          { error: 'Código TOTP inválido' },
          { status: 400 },
        )
      }
    } else if (
      existing.method === 'kyc_provider' ||
      existing.method === 'biometric' ||
      existing.method === 'document'
    ) {
      // KYC provider / biometric / document methods require a signature
      // from the external provider attesting to the verification result.
      // Until a real provider (Onfido / Jumio) is integrated and its
      // public key is wired in, we reject these — accepting an
      // unverifiable `evidenceHash` would re-open the self-verify bypass.
      if (!body.providerSignature) {
        return NextResponse.json(
          { error: 'Firma del proveedor KYC requerida' },
          { status: 400 },
        )
      }
      return NextResponse.json(
        {
          error:
            'Verificación de proveedor KYC no implementada — pendiente integración Onfido/Jumio',
        },
        { status: 501 },
      )
    } else {
      // Unknown method — fail closed.
      return NextResponse.json(
        { error: `Método de verificación no soportado: ${existing.method}` },
        { status: 400 },
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
  

})
