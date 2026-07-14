import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
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

const log = getLogger('api/ap2/mandates/[id]')

// GET /api/ap2/mandates/[id]
// Devuelve el mandato + VC + estado de verificación de firma.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
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
  } catch (err) {
    captureError(err as Error, { path: '/api/ap2/mandates/[id]', method: 'GET' })
    return NextResponse.json(
      { error: 'No se pudo obtener el mandato' },
      { status: 500 },
    )
  }
}

// PATCH /api/ap2/mandates/[id]
// Avanza el estado (active → consumed) o actualiza orderId / paymentRef.
// Para revocar, usar el endpoint dedicado `/revoke` (más abajo, en otra ruta).
const PatchSchema = z.object({
  status: z.enum(['active', 'consumed']).optional(),
  orderId: z.string().optional(),
  paymentRef: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  try {
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
  } catch (err) {
    captureError(err as Error, { path: '/api/ap2/mandates/[id]', method: 'PATCH' })
    return NextResponse.json(
      { error: 'No se pudo actualizar el mandato' },
      { status: 500 },
    )
  }
}

// Re-export para que el endpoint /revoke pueda reutilizar helpers.
export const _internal = { computeHash, getOrCreateTenantKeypair, createW3CVC, signVC }
