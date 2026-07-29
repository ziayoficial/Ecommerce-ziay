import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'

// ───────────────────────────────────────────────────────────────────────────
// Age verification gate — Ley 1098 de 2006 (Código de la Infancia y
// Adolescencia) Art 17.
//
// FIX-LEGAL-P0-001 L-4 — AUDIT-LEGAL-COMPLIANCE-001 P0-4 flagged that the
// platform had ZERO age verification: any phone number could place an order.
// Ley 1098 Art 17 grants minors enhanced PII protection; processing a
// minor's data or accepting a purchase from them without parental consent
// is a violation. Also a COPPA exposure if US expansion happens.
//
// Policy:
//   - `birthDate` is collected opportunistically (KYC, storefront checkout,
//     customer profile enrichment).
//   - `isMinor` is a denormalized flag derived from `birthDate` so reads
//     don't have to recompute the age. Set to `true` by `checkAgeGate()`
//     the first time a minor is detected; never set back to `false` to
//     prevent a birthday-eve bypass.
//   - NULL `birthDate` + NULL `isMinor` → "unknown — assume adult but flag
//     for verification". The storefront checkout exposes a declarative
//     "Confirmo que soy mayor de edad" checkbox (separate UI work).
//   - Explicit `isMinor = true` or `birthDate` resolves to < 18 → the
//     checkout is FORCED into `requires_escalation` until a
//     `parental_consent_minor` ConsentRecord is created for the customer.
// ───────────────────────────────────────────────────────────────────────────

export const AGE_OF_MAJORITY = 18

/**
 * Compute age in whole years from a birth date.
 * Uses the standard "birthday this year has passed" check.
 */
export function calculateAge(birthDate: Date): number {
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--
  }
  return age
}

/**
 * Returns true if the given birthDate corresponds to a minor (under 18).
 * NULL birthDate returns false (unknown age — assume adult). The caller is
 * responsible for surfacing a separate "verify your age" UI when the
 * birthDate is unknown but the customer is flagged for verification.
 */
export function isMinor(birthDate: Date | null): boolean {
  if (!birthDate) return false // unknown age = assume adult (but flag)
  return calculateAge(birthDate) < AGE_OF_MAJORITY
}

export interface AgeGateResult {
  allowed: boolean
  reason?: string
  isMinor?: boolean
}

/**
 * Checks the age gate for a customer.
 *
 * Returns `{ allowed: false, isMinor: true }` if the customer is explicitly
 * flagged as a minor OR if their `birthDate` resolves to < 18. In the latter
 * case the `isMinor` flag is persisted on the Customer row so subsequent
 * reads don't need to recompute the age (and so a birthday-eve bypass
 * cannot reset it).
 *
 * Returns `{ allowed: true }` if the customer is an adult or their age is
 * unknown (NULL `birthDate` + NULL `isMinor`).
 */
export async function checkAgeGate(
  customerId: string,
): Promise<AgeGateResult> {
  try {
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { birthDate: true, isMinor: true },
    })

    if (!customer) {
      return { allowed: false, reason: 'Cliente no encontrado' }
    }

    // Explicitly flagged as minor — hard block.
    if (customer.isMinor === true) {
      return {
        allowed: false,
        reason:
          'Cliente es menor de edad. Se requiere consentimiento de padre/madre/tutor (Ley 1098/2006 Art 17).',
        isMinor: true,
      }
    }

    // Check birthdate — if minor, persist the flag so subsequent reads are O(1).
    if (customer.birthDate && isMinor(customer.birthDate)) {
      try {
        await db.customer.update({
          where: { id: customerId },
          data: { isMinor: true },
        })
      } catch (persistErr) {
        // Don't fail the gate if the persist fails — the in-memory check
        // already determined the customer is a minor. The flag will be
        // re-derived on the next call.
        captureError(persistErr as Error, {
          lib: 'age-gate',
          method: 'checkAgeGate.persist',
          customerId,
        })
      }
      return {
        allowed: false,
        reason:
          'Cliente es menor de edad. Se requiere consentimiento de padre/madre/tutor (Ley 1098/2006 Art 17).',
        isMinor: true,
      }
    }

    return { allowed: true }
  } catch (err) {
    captureError(err as Error, {
      lib: 'age-gate',
      method: 'checkAgeGate',
      customerId,
    })
    // Fail CLOSED: if we can't verify the age gate, block the checkout.
    // Better to lose a sale than process a minor's PII without consent.
    return {
      allowed: false,
      reason:
        'No se pudo validar la verificación de edad (error interno). Por favor reintenta.',
    }
  }
}

export interface ParentalConsentResult {
  verified: boolean
  reason?: string
}

/**
 * Verifies that the customer has an active (granted, not revoked)
 * `parental_consent_minor` ConsentRecord on file.
 *
 * Used by the UCP checkout state machine to decide whether to allow a
 * minor's purchase through (with parental consent) or to force the
 * `requires_escalation` state and route to the parental-consent UI.
 */
export async function requireParentalConsent(
  customerId: string,
): Promise<ParentalConsentResult> {
  try {
    const consent = await db.consentRecord.findFirst({
      where: {
        dataSubjectId: customerId,
        dataSubjectType: 'customer',
        purpose: 'parental_consent_minor',
        granted: true,
        revokedAt: null,
      },
      select: { id: true, grantedAt: true },
    })

    if (!consent) {
      return {
        verified: false,
        reason:
          'Se requiere consentimiento de padre/madre/tutor para procesar compras de menores (Ley 1098/2006 Art 17).',
      }
    }

    return { verified: true }
  } catch (err) {
    captureError(err as Error, {
      lib: 'age-gate',
      method: 'requireParentalConsent',
      customerId,
    })
    // Fail CLOSED.
    return {
      verified: false,
      reason:
        'No se pudo validar el consentimiento parental (error interno).',
    }
  }
}
