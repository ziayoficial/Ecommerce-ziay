import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTenantId } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// POST /api/compliance/dsr
// Data Subject Request (Ley 1581 de 2012 — habeas data).
// Body:
//   { tenantId, requestType: 'access' | 'erasure' | 'portability', dataSubjectId, dataSubjectType? }
//
// - access:       devuelve todos los datos personales del sujeto
// - erasure:      anonimiza el customer (right to deletion)
// - portability:  devuelve los datos en formato machine-readable (JSON)

const DsrSchema = z.object({
  tenantId: z.string().min(1),
  requestType: z.enum(['access', 'erasure', 'portability']),
  dataSubjectId: z.string().min(1),
  dataSubjectType: z.enum(['customer', 'user', 'lead']).default('customer'),
})

/**
 * POST /api/compliance/dsr
 *
 * Data Subject Request — access / deletion / portability (Ley 1581 Art. 8).
 *
 * @security Requires authentication + tenant access
 * @returns DSR tracking id + status
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
  const parsed = DsrSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { error } = await resolveTenantId(body.tenantId)
  if (error) return error

    if (body.requestType === 'access' || body.requestType === 'portability') {
      const bundle = await collectPersonalData(
        body.tenantId,
        body.dataSubjectId,
        body.dataSubjectType,
      )
      return NextResponse.json({
        requestType: body.requestType,
        dataSubjectId: body.dataSubjectId,
        dataSubjectType: body.dataSubjectType,
        format: body.requestType === 'portability' ? 'json-portable' : 'json-full',
        bundle,
        generatedAt: new Date().toISOString(),
      })
    }

    if (body.requestType === 'erasure') {
      // Anonimizar el customer (right to deletion bajo Ley 1581).
      // Para conservar la integridad referencial de Orders/Shipments, no
      // borramos la fila — reemplazamos los PII con placeholders.
      const result = await anonymizeCustomer(body.tenantId, body.dataSubjectId)
      if (!result.ok) {
        return NextResponse.json(
          { error: result.reason },
          { status: result.status },
        )
      }
      // Registrar revocación masiva de consentimientos.
      await db.consentRecord.updateMany({
        where: {
          tenantId: body.tenantId,
          dataSubjectId: body.dataSubjectId,
          granted: true,
        },
        data: {
          granted: false,
          revokedAt: new Date(),
          revokeReason: 'DSR erasure request',
        },
      })

      return NextResponse.json({
        requestType: 'erasure',
        dataSubjectId: body.dataSubjectId,
        anonymized: true,
        consentsRevoked: true,
        at: new Date().toISOString(),
      })
    }

    return NextResponse.json(
      { error: 'Tipo de solicitud no soportado' },
      { status: 400 },
    )
  

})

// ── helpers ──────────────────────────────────────────────────────────────

async function collectPersonalData(
  tenantId: string,
  dataSubjectId: string,
  dataSubjectType: string,
) {
  const bundle: Record<string, unknown> = { dataSubjectType }

  if (dataSubjectType === 'customer') {
    const customer = await db.customer.findFirst({
      where: { id: dataSubjectId, tenantId },
      include: {
        orders: {
          include: { items: true, events: true, shipments: true },
          orderBy: { createdAt: 'desc' },
        },
        conversations: { include: { messages: true } },
      },
    })
    bundle.customer = customer
  }

  if (dataSubjectType === 'user') {
    const user = await db.user.findFirst({
      where: { id: dataSubjectId, tenantId },
    })
    bundle.user = user
  }

  // Consents siempre (independiente del tipo).
  const consents = await db.consentRecord.findMany({
    where: { tenantId, dataSubjectId },
  })
  bundle.consents = consents

  // Verificaciones de identidad (Ley 2573).
  const verifications = await db.identityVerification.findMany({
    where: {
      tenantId,
      OR: [{ userId: dataSubjectId }, { customerId: dataSubjectId }],
    },
  })
  bundle.identityVerifications = verifications

  return bundle
}

async function anonymizeCustomer(
  tenantId: string,
  customerId: string,
): Promise<{ ok: boolean; reason?: string; status?: number }> {
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true },
  })
  if (!customer) {
    return {
      ok: false,
      reason: 'Customer no encontrado',
      status: 404,
    }
  }

  await db.customer.update({
    where: { id: customerId },
    data: {
      name: '[anonimizado]',
      phone: null,
      psid: null,
      igId: null,
      email: null,
      address: null,
      notes: null,
      tags: null,
      perfilDetectado: null,
    },
  })

  // Borrar mensajes (PII textual) y anonimizar conversaciones.
  await db.message.deleteMany({
    where: { conversation: { customerId } },
  })

  return { ok: true }
}
