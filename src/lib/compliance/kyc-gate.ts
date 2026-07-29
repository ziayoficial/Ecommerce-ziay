/**
 * Ley 2573 de 2026 — gate de verificación de identidad.
 *
 * Bloquea compras a crédito / cuotas / alto valor sin verificación de
 * identidad trazable. Documento §12.1: sin evidencia, la empresa asume el
 * 100% de la pérdida ("carga dinámica de la prueba").
 *
 * SPRINT-AGENTIC-PROTOCOLS-001 — primitiva usada por:
 *   - UCP checkout state machine (puede forzar `requires_escalation` si
 *     el trigger es crédito/cuotas y no hay KYC válido).
 *   - AP2 Payment Mandate creation (verifica al titular antes de firmar).
 *   - Endpoint HTTP `/api/compliance/kyc` (initiate + status).
 *
 * Política (editable por tenant en el futuro):
 *   - credit_purchase    → SIEMPRE requiere KYC
 *   - installment_plan   → SIEMPRE requiere KYC
 *   - high_value_order   → requiere KYC si monto > HIGH_VALUE_THRESHOLD (COP)
 *
 * Vigencia de la verificación: 90 días (configurable).
 */
import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'

export type KycTriggerType =
  | 'credit_purchase'
  | 'installment_plan'
  | 'high_value_order'

export interface KycGateResult {
  verified: boolean
  verificationId?: string
  reason?: string
}

/** Umbral COP para `high_value_order`. Por encima → requiere KYC. */
export const HIGH_VALUE_THRESHOLD = 2_000_000

/** Vigencia del KYC en ms (90 días). */
export const KYC_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Comprueba si el usuario tiene una verificación de identidad vigente.
 * Si la requiere y no la tiene, crea un `IdentityVerification` pending y
 * devuelve `verified: false` (con el `verificationId` para que el caller
 * pueda iniciar el flujo KYC).
 *
 * Idempotente: si ya existe un `pending` para el mismo `(userId, triggerRef)`
 * no crea uno nuevo — devuelve el existente.
 */
export async function requireIdentityVerification(
  tenantId: string,
  userId: string,
  triggerType: KycTriggerType,
  triggerRef: string,
  orderAmount?: number,
): Promise<KycGateResult> {
  const requiresKyc =
    triggerType === 'credit_purchase' ||
    triggerType === 'installment_plan' ||
    (triggerType === 'high_value_order' &&
      (orderAmount ?? 0) > HIGH_VALUE_THRESHOLD)

  if (!requiresKyc) return { verified: true }

  try {
    // 1) ¿Hay una verificación vigente (no expirada)?
    const existing = await db.identityVerification.findFirst({
      where: {
        tenantId,
        userId,
        status: 'verified',
        expiresAt: { gt: new Date() },
      },
      orderBy: { verifiedAt: 'desc' },
    })
    if (existing) {
      return { verified: true, verificationId: existing.id }
    }

    // 2) ¿Hay un `pending` reciente para el mismo trigger? (idempotencia)
    const pending = await db.identityVerification.findFirst({
      where: {
        tenantId,
        userId,
        status: 'pending',
        triggerType,
        triggerRef,
      },
      orderBy: { createdAt: 'desc' },
    })
    if (pending) {
      return {
        verified: false,
        verificationId: pending.id,
        reason:
          'Verificación de identidad pendiente bajo Ley 2573 de 2026',
      }
    }

    // 3) Crear nueva solicitud de verificación pending.
    const created = await db.identityVerification.create({
      data: {
        tenantId,
        userId,
        method: '2fa_totp', // default; en producción subir a KYC provider
        status: 'pending',
        triggerType,
        triggerRef,
      },
    })

    return {
      verified: false,
      verificationId: created.id,
      reason:
        'Verificación de identidad requerida bajo Ley 2573 de 2026',
    }
  } catch (err) {
    captureError(err as Error, {
      lib: 'kyc-gate',
      method: 'requireIdentityVerification',
      tenantId,
      userId,
    })
    // En caso de fallo de DB, fallar cerrado: no permitir la transacción.
    return {
      verified: false,
      reason:
        'No se pudo validar la verificación de identidad (error interno)',
    }
  }
}

/**
 * Marca una verificación como `verified` o `failed`. Solo el endpoint
 * `/api/compliance/kyc/[id]/verify` debería llamarla tras recibir la
 * evidencia del proveedor KYC o del 2FA TOTP.
 */
export async function recordIdentityVerification(
  verificationId: string,
  status: 'verified' | 'failed',
  evidenceHash: string,
  riskScore?: number,
) {
  const now = new Date()
  return db.identityVerification.update({
    where: { id: verificationId },
    data: {
      status,
      verifiedAt: status === 'verified' ? now : null,
      expiresAt: status === 'verified'
        ? new Date(now.getTime() + KYC_TTL_MS)
        : null,
      evidenceHash,
      riskScore,
    },
  })
}

/**
 * Devuelve la verificación vigente (no expirada) para un usuario, o null.
 * Útil para respuestas de API que necesitan incluir el estado KYC sin
 * disparar la creación de un `pending`.
 */
export async function getActiveVerification(
  tenantId: string,
  userId: string,
) {
  return db.identityVerification.findFirst({
    where: {
      tenantId,
      userId,
      status: 'verified',
      expiresAt: { gt: new Date() },
    },
    orderBy: { verifiedAt: 'desc' },
  })
}
