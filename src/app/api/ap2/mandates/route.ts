import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess, resolveTenantId } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import {
  createW3CVC,
  getOrCreateTenantKeypair,
  signVC,
  type W3CVerifiableCredential,
} from '@/lib/crypto/signing'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/ap2/mandates')

// POST /api/ap2/mandates  → crea Intent Mandate (firmado por el tenant).
//
// Body:
//   { tenantId, userId, maxAmount, currency, categoryLimits?, expiresAt?, purpose }
//
// Devuelve:
//   { mandateId, vc, did, status }
//
// Documento §10.2: "lo que el usuario autorizó — comprar zapatillas talla 10,
// menos de $150". El Intent es el primero de la cadena Intent → Cart → Payment.

const CategoryLimitsSchema = z.record(z.string(), z.number())

const CreateIntentSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  purpose: z.string().min(1),
  maxAmount: z.number().positive(),
  currency: z.string().min(1).default('COP'),
  categoryLimits: CategoryLimitsSchema.optional(),
  expiresAt: z.string().datetime().optional(),
})

/**
 * POST /api/ap2/mandates
 *
 * Crea un Intent Mandate firmado (W3C Verifiable Credential) — primer eslabón de la cadena Intent → Cart → Payment.
 *
 * @security Requires authentication + tenant access (requireTenantAccess)
 * @returns mandateId + signed VC + did + status
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

  const parsed = CreateIntentSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { error } = await requireTenantAccess(body.tenantId)
  if (error) return error

    const { privateKey, did } = await getOrCreateTenantKeypair(body.tenantId)

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
    const subject: Record<string, unknown> = {
      userId: body.userId,
      purpose: body.purpose,
      maxAmount: body.maxAmount,
      currency: body.currency,
      categoryLimits: body.categoryLimits ?? {},
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    }
    const unsigned = createW3CVC(did, ['AP2IntentMandate'], subject)
    const signed = signVC(unsigned, privateKey)
    const vcJson = JSON.stringify(signed)
    const signature = signed.proof?.proofValue ?? ''

    const mandate = await db.aP2Mandate.create({
      data: {
        tenantId: body.tenantId,
        type: 'intent',
        userId: body.userId,
        vcPayload: vcJson,
        vcSignature: signature,
        signatoryDid: did,
        status: 'active',
        maxAmount: body.maxAmount,
        currency: body.currency,
        categoryLimits: body.categoryLimits
          ? JSON.stringify(body.categoryLimits)
          : null,
        expiresAt,
      },
    })

    log.info({ mandateId: mandate.id, tenantId: body.tenantId }, 'Intent mandate creado')

    return NextResponse.json(
      {
        mandateId: mandate.id,
        type: 'intent',
        did,
        status: mandate.status,
        vc: signed,
      },
      { status: 201 },
    )
  

})

// GET /api/ap2/mandates?tenantId=X&userId=Y&type=intent&status=active
// Lista los mandatos del tenant, opcionalmente filtrados.
/**
 * GET /api/ap2/mandates
 *
 * Lista los mandatos del tenant, opcionalmente filtrados por userId/type/status.
 *
 * @security Requires authentication + tenant access (resolveTenantId)
 * @returns Array of mandate metadata
 */
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  if (!tenantIdParam) {
    return NextResponse.json(
      { error: 'tenantId requerido' },
      { status: 400 },
    )
  }
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error

    const userId = req.nextUrl.searchParams.get('userId') || undefined
    const type = req.nextUrl.searchParams.get('type') || undefined
    const status = req.nextUrl.searchParams.get('status') || undefined

    const mandates = await db.aP2Mandate.findMany({
      where: {
        tenantId: tenantId as string,
        ...(userId ? { userId } : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({
      mandates: mandates.map(m => ({
        id: m.id,
        type: m.type,
        status: m.status,
        userId: m.userId,
        parentMandateId: m.parentMandateId,
        signatoryDid: m.signatoryDid,
        maxAmount: m.maxAmount,
        currency: m.currency,
        categoryLimits: m.categoryLimits,
        expiresAt: m.expiresAt,
        orderId: m.orderId,
        paymentRef: m.paymentRef,
        createdAt: m.createdAt,
        revokedAt: m.revokedAt,
        revokedReason: m.revokedReason,
      })),
    })
  

})

// Helper export para que otras rutas puedan reusar el tipo.
export type { W3CVerifiableCredential }
