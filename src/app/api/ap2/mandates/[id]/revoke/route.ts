import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'

const log = getLogger('api/ap2/mandates/[id]/revoke')

// PATCH /api/ap2/mandates/[id]/revoke
// Documento §11: "Mandatos revocables en cualquier momento".
// Cualquier mandato (Intent / Cart / Payment) puede revocarse.
// Revocar un Intent propaga la revocación a sus Cart/Payment hijos.
//
// Body: { reason?: string }
const RevokeSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let raw: unknown = {}
  try {
    raw = await req.json()
  } catch {
    // body opcional
  }
  const parsed = RevokeSchema.safeParse(raw)
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

    if (existing.status === 'revoked') {
      return NextResponse.json(
        { error: 'El mandato ya está revocado' },
        { status: 409 },
      )
    }

    const now = new Date()
    const reason = parsed.data.reason ?? 'Revocado por el titular'

    // Transacción: revoca el mandato + todos sus descendientes en cadena.
    // (Intent → Cart → Payment). Cada hijo cuyo `parentMandateId` apunte a
    // un mandato revocado también se revoca.
    await db.$transaction(async (tx) => {
      await tx.aP2Mandate.update({
        where: { id },
        data: {
          status: 'revoked',
          revokedAt: now,
          revokedReason: reason,
        },
      })

      // BFS ligero sobre la cadena de hijos (profundidad máxima 3).
      let currentIds: string[] = [id]
      for (let depth = 0; depth < 3 && currentIds.length > 0; depth++) {
        const children = await tx.aP2Mandate.findMany({
          where: { parentMandateId: { in: currentIds } },
          select: { id: true },
        })
        if (children.length === 0) break
        const childIds = children.map(c => c.id)
        await tx.aP2Mandate.updateMany({
          where: { id: { in: childIds }, status: { not: 'revoked' } },
          data: {
            status: 'revoked',
            revokedAt: now,
            revokedReason: `Propagado desde ${currentIds[0]}: ${reason}`,
          },
        })
        currentIds = childIds
      }
    })

    log.info({ mandateId: id, reason }, 'Mandato revocado (con cascada)')

    return NextResponse.json({
      mandateId: id,
      status: 'revoked',
      revokedAt: now,
      reason,
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/ap2/mandates/[id]/revoke',
      method: 'PATCH',
    })
    return NextResponse.json(
      { error: 'No se pudo revocar el mandato' },
      { status: 500 },
    )
  }
}
