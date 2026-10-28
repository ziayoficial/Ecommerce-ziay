import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { computeHash } from '@/lib/crypto/signing'
import { checkCSRF } from '@/lib/middleware/csrf'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { getLogger } from '@/lib/logger'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/compliance/parental-consent
//
// AUDIT-CYCLE-4-H3 — anonymous parental consent submission (Ley 1098/2006
// Art 17 + Ley 1581/2012 Art 10).
//
// Before this endpoint existed the flow was broken end-to-end: the UCP
// checkout escalates minors to /compliance/parental-consent?customerId=…
// (the tutor has NO NextAuth session), but the public form had no action
// and /api/compliance/consent (a) rejected the `parental_consent_minor`
// purpose and (b) required a session — so NOTHING in the system could
// create the ConsentRecord that `requireParentalConsent` (age-gate) and
// the UCP checkout expect. Minors were stuck in requires_escalation with
// no exit path.
//
// This route is public BY DESIGN (tutor arrives from a chat link without
// credentials). Hardening layers:
//   1. PUBLIC_PATTERNS entry in src/middleware.ts (JWT gate skipped) —
//      plus the same-origin CSRF check run INSIDE this handler (public
//      routes bypass the middleware-level checkCSRF).
//   2. Tight route-level rate limit: 5 submissions / 10 min / IP.
//   3. The customer MUST exist AND be flagged `isMinor=true` — consent
//      records can't be forged for arbitrary adults, and the escalation
//      URL's customerId (a cuid) is the only accepted handle.
//   4. Zod-validated body; `consent: true` must be explicit.
//   5. Proof payload (Ley 1581 verifiable consent): tutor name,
//      relationship, IP, user agent, timestamp — and the tutor's document
//      HASHED (never stored raw — principio de mínimos).
//   6. Idempotent: if an active parental consent already exists, return
//      it with 200 instead of creating a duplicate.
// ─────────────────────────────────────────────────────────────────────────────

const log = getLogger('api/compliance/parental-consent')

const ParentalConsentSchema = z.object({
  customerId: z.string().min(1).max(64),
  tutorName: z.string().min(3).max(120),
  tutorDocumentId: z.string().min(5).max(32),
  relationship: z.enum(['padre', 'madre', 'tutor', 'abuelo']),
  // Explicit opt-in — the checkbox on the form.
  consent: z.literal(true),
})

/**
 * POST /api/compliance/parental-consent
 *
 * Records the tutor's parental consent for a flagged minor customer.
 *
 * @security Public (anonymous — CSRF origin check + rate limit + isMinor
 *           customer validation + hashed tutor document)
 * @returns 201 with consentId on first submission, 200 if one already exists
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  // CSRF — public routes bypass the middleware-level check, so the
  // same-origin Origin/Host check runs here (see lib/middleware/csrf.ts).
  const csrfErr = checkCSRF(req)
  if (csrfErr) return csrfErr

  // Tight anonymous rate limit — the global 60/min middleware limit does
  // NOT apply to public routes.
  const limited = rateLimit(req, {
    max: 5,
    windowMs: 10 * 60_000,
    namespace: 'api:parental-consent',
  })
  if (limited) return limited

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }

  const parsed = ParentalConsentSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'Datos incompletos o inválidos. Completa todos los campos y confirma la autorización.',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }
  const body = parsed.data

  // Only flagged minors qualify. `findFirst` with isMinor: true means an
  // unknown/adult customerId is indistinguishable from a non-existent one
  // (no existence oracle for arbitrary customers).
  const customer = await db.customer.findFirst({
    where: { id: body.customerId, isMinor: true },
    select: { id: true, tenantId: true },
  })
  if (!customer) {
    return NextResponse.json(
      {
        error:
          'No encontramos un menor autorizado con ese identificador. Verifica el enlace que recibiste.',
      },
      { status: 404 },
    )
  }

  // Idempotency — an active consent already on file returns 200.
  const existing = await db.consentRecord.findFirst({
    where: {
      dataSubjectId: customer.id,
      dataSubjectType: 'customer',
      purpose: 'parental_consent_minor',
      granted: true,
      revokedAt: null,
    },
    select: { id: true, grantedAt: true },
  })
  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadyRegistered: true,
      consentId: existing.id,
      grantedAt: existing.grantedAt,
    })
  }

  // Proof payload — Ley 1581 Art 10: consent must be free, prior, informed
  // and VERIFIABLE. The tutor's document is hashed, never stored raw.
  const proofPayload = {
    type: 'parental_consent_minor',
    tutorName: body.tutorName,
    tutorDocumentHash: computeHash(body.tutorDocumentId),
    relationship: body.relationship,
    ip:
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown',
    userAgent: req.headers.get('user-agent') ?? 'unknown',
    consentAt: new Date().toISOString(),
    legalRefs: ['Ley 1098/2006 Art 17', 'Ley 1581/2012 Art 10'],
  }
  const proofJson = JSON.stringify(proofPayload)
  const proofHash = computeHash(proofJson)

  const consent = await db.consentRecord.create({
    data: {
      tenantId: customer.tenantId,
      dataSubjectId: customer.id,
      dataSubjectType: 'customer',
      purpose: 'parental_consent_minor',
      legalBasis: 'consent',
      granted: true,
      grantedAt: new Date(),
      proofHash,
      proofPayload: proofJson,
    },
  })

  log.info(
    { customerId: customer.id, tenantId: customer.tenantId, consentId: consent.id },
    'parental consent recorded (Ley 1098/2006 Art 17)',
  )

  return NextResponse.json(
    { ok: true, alreadyRegistered: false, consentId: consent.id },
    { status: 201 },
  )
})
