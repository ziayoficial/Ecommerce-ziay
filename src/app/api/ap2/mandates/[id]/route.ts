import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import {
  createW3CVC,
  getOrCreateTenantKeypair,
  signVC,
  computeHash,
  getTenantPublicKey,
  verifyVC,
  type W3CVerifiableCredential,
} from '@/lib/crypto/signing'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/ap2/mandates/[id]')

// GET /api/ap2/mandates/[id]
// Devuelve el mandato + VC + estado de verificación de firma.
/**
 * GET /api/ap2/mandates/[id]
 *
 * Fetch a single AP2 mandate by id (full VC payload).
 *
 * @security Requires authentication + tenant access
 * @returns Mandate object including signed VC
 */
export const GET = withErrorHandling(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {

  const { id } = await params

    const mandate = await db.aP2Mandate.findUnique({
      where: { id },
      include: { parentMandate: true, childMandates: true },
    })
    if (!mandate) {
      return NextResponse.json(
        { error: 'Mandato no encontrado' },
        { status: 404 },
      )
    }

    // Tenant guard (no admin cross-tenant reads on this route).
    const { error } = await requireTenantAccess(mandate.tenantId)
    if (error) return error

    let vc: W3CVerifiableCredential | null = null
    try {
      vc = JSON.parse(mandate.vcPayload) as W3CVerifiableCredential
    } catch {
      vc = null
    }

    let signatureValid = false
    if (vc) {
      const pub = await getTenantPublicKey(mandate.tenantId)
      if (pub) signatureValid = verifyVC(vc, pub)
    }

    return NextResponse.json({
      mandate: {
        id: mandate.id,
        type: mandate.type,
        status: mandate.status,
        userId: mandate.userId,
        parentMandateId: mandate.parentMandateId,
        signatoryDid: mandate.signatoryDid,
        maxAmount: mandate.maxAmount,
        currency: mandate.currency,
        categoryLimits: mandate.categoryLimits,
        expiresAt: mandate.expiresAt,
        orderId: mandate.orderId,
        paymentRef: mandate.paymentRef,
        createdAt: mandate.createdAt,
        updatedAt: mandate.updatedAt,
        revokedAt: mandate.revokedAt,
        revokedReason: mandate.revokedReason,
        childMandates: mandate.childMandates.map(c => ({
          id: c.id,
          type: c.type,
          status: c.status,
        })),
      },
      vc,
      verification: {
        signatureValid,
        signatoryDid: mandate.signatoryDid,
      },
    })
  

})

// PATCH /api/ap2/mandates/[id]
// Avanza el estado (active → consumed) o actualiza orderId / paymentRef.
// Para revocar, usar el endpoint dedicado `/revoke` (más abajo, en otra ruta).
const PatchSchema = z.object({
  status: z.enum(['active', 'consumed']).optional(),
  orderId: z.string().optional(),
  paymentRef: z.string().optional(),
})

/**
 * PATCH /api/ap2/mandates/[id]
 *
 * Update a mandate — advance status (active→consumed), stamp orderId / paymentRef.
 *
 * @security Requires authentication + tenant access (requireTenantAccess)
 * @returns Updated mandate
 */
export const PATCH = withErrorHandling(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {

  const { id } = await params
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = PatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

    const existing = await db.aP2Mandate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Mandato no encontrado' },
        { status: 404 },
      )
    }
    const { error } = await requireTenantAccess(existing.tenantId)
    if (error) return error

    // Solo se puede avanzar de active → consumed. La revocación va por /revoke.
    if (parsed.data.status && existing.status === 'revoked') {
      return NextResponse.json(
        { error: 'No se puede modificar un mandato revocado' },
        { status: 409 },
      )
    }

    const updated = await db.aP2Mandate.update({
      where: { id },
      data: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.orderId ? { orderId: parsed.data.orderId } : {}),
        ...(parsed.data.paymentRef ? { paymentRef: parsed.data.paymentRef } : {}),
      },
    })
    log.info({ mandateId: id, status: updated.status }, 'Mandato actualizado')

    return NextResponse.json({
      mandate: {
        id: updated.id,
        status: updated.status,
        orderId: updated.orderId,
        paymentRef: updated.paymentRef,
      },
    })
  

})

// Re-export para que el endpoint /revoke pueda reutilizar helpers.
export const _internal = { computeHash, getOrCreateTenantKeypair, createW3CVC, signVC }
