import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTenantId, requireAuth, requireTenantAccess } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { computeHash } from '@/lib/crypto/signing'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// POST /api/compliance/consent
// Registra un consentimiento (Ley 1581 de 2012).
// Body:
//   { tenantId, dataSubjectId, dataSubjectType, purpose, legalBasis, proofPayload? }
//
// V8 (AUDIT-FINAL-SEC-001): previamente cualquier usuario del tenant podía
// crear consentimientos para cualquier dataSubjectId. Ahora verificamos
// que el dataSubject (cuando es `customer`) pertenece al tenant del caller.
const CreateConsentSchema = z.object({
  tenantId: z.string().min(1),
  dataSubjectId: z.string().min(1),
  dataSubjectType: z.enum(['customer', 'user', 'lead']),
  purpose: z.enum([
    'marketing',
    'analytics',
    'ai_processing',
    'data_sharing',
  ]),
  legalBasis: z.enum([
    'consent',
    'contract',
    'legitimate_interest',
    'legal_obligation',
  ]),
  proofPayload: z.record(z.string(), z.unknown()).optional(),
})

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
  const parsed = CreateConsentSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { error } = await resolveTenantId(body.tenantId)
  if (error) return error

    // V8: si el dataSubject es un customer, verificar que pertenece al
    // tenant del caller. Para `user` / `lead` no hay un check directo de
    // tenant (los users pueden ser platform users, los leads no tienen
    // tenantId en este modelo) — el guard de `resolveTenantId` arriba ya
    // cubre el scope del caller.
    if (body.dataSubjectType === 'customer') {
      const customer = await db.customer.findFirst({
        where: { id: body.dataSubjectId, tenantId: body.tenantId },
        select: { id: true, tenantId: true },
      })
      if (!customer) {
        return NextResponse.json(
          { error: 'El dataSubject (customer) no pertenece al tenant' },
          { status: 403 },
        )
      }
      // Defense-in-depth: requireTenantAccess con el tenantId del customer
      // (source of truth) en lugar del body.
      const { error: tErr } = await requireTenantAccess(customer.tenantId)
      if (tErr) return tErr
    }

    const proofJson = body.proofPayload
      ? JSON.stringify(body.proofPayload)
      : null
    const proofHash = proofJson ? computeHash(proofJson) : null

    const consent = await db.consentRecord.create({
      data: {
        tenantId: body.tenantId,
        dataSubjectId: body.dataSubjectId,
        dataSubjectType: body.dataSubjectType,
        purpose: body.purpose,
        legalBasis: body.legalBasis,
        granted: true,
        grantedAt: new Date(),
        proofHash,
        proofPayload: proofJson,
      },
    })

    return NextResponse.json(
      {
        consentId: consent.id,
        tenantId: consent.tenantId,
        dataSubjectId: consent.dataSubjectId,
        purpose: consent.purpose,
        legalBasis: consent.legalBasis,
        granted: consent.granted,
        grantedAt: consent.grantedAt,
      },
      { status: 201 },
    )
  

})

// GET /api/compliance/consent?tenantId=X&dataSubjectId=Y
// Lista los consentimientos de un data subject.
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined
  const dataSubjectId = req.nextUrl.searchParams.get('dataSubjectId') || undefined

  if (!tenantId || !dataSubjectId) {
    return NextResponse.json(
      { error: 'tenantId y dataSubjectId son requeridos' },
      { status: 400 },
    )
  }

  const { error } = await resolveTenantId(tenantId)
  if (error) return error

    const records = await db.consentRecord.findMany({
      where: { tenantId, dataSubjectId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({
      consents: records.map(r => ({
        id: r.id,
        purpose: r.purpose,
        legalBasis: r.legalBasis,
        granted: r.granted,
        grantedAt: r.grantedAt,
        revokedAt: r.revokedAt,
        revokeReason: r.revokeReason,
      })),
    })
  

})

// DELETE /api/compliance/consent?id=Z&reason=...
// Revoca un consentimiento (granted=false, revokedAt=now).
//
// V8 (AUDIT-FINAL-SEC-001): si el dataSubject es un customer, verificamos
// que pertenece al tenant del caller (defense-in-depth además del guard
// de tenant sobre el consent record).
export const DELETE = withErrorHandling(async (req: NextRequest) => {

  const id = req.nextUrl.searchParams.get('id')
  const reason = req.nextUrl.searchParams.get('reason') || 'Revocado por el titular'

  if (!id) {
    return NextResponse.json(
      { error: 'id es requerido' },
      { status: 400 },
    )
  }

  const { error } = await requireAuth()
  if (error) return error

    const existing = await db.consentRecord.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Consentimiento no encontrado' },
        { status: 404 },
      )
    }
    // Tenant guard — requireTenantAccess con el tenantId del consent
    // record (source of truth). Platform admins (sin tenantId) bypass.
    const { error: tErr } = await requireTenantAccess(existing.tenantId)
    if (tErr) return tErr

    // V8: si el dataSubject es un customer, verificar que pertenece al
    // tenant del consent record. Esto previene revocar consentimientos
    // creados incorrectamente con un dataSubjectId de otro tenant.
    if (existing.dataSubjectType === 'customer') {
      const customer = await db.customer.findFirst({
        where: { id: existing.dataSubjectId, tenantId: existing.tenantId },
        select: { id: true },
      })
      if (!customer) {
        return NextResponse.json(
          { error: 'El dataSubject (customer) no pertenece al tenant del consentimiento' },
          { status: 403 },
        )
      }
    }

    const updated = await db.consentRecord.update({
      where: { id },
      data: {
        granted: false,
        revokedAt: new Date(),
        revokeReason: reason,
      },
    })

    return NextResponse.json({
      consentId: updated.id,
      granted: updated.granted,
      revokedAt: updated.revokedAt,
      reason: updated.revokeReason,
    })
  

})
