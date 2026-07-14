// Novedades detail API — single-case GET + PATCH.
//
// GET    /api/novedades/:id — full case detail with evidence + messages.
// PATCH  /api/novedades/:id — direct field update (with tenant guard).
//
// Auth: the case's tenantId must match the caller's tenantId (or caller must
// be a platform admin/finance with no tenantId).
//
// SPRINT8-SERVICES-REST-001 — migrated GET to `novedadesService.getCaseById`
// and PATCH to `novedadesService.updateCaseFields`. The tenant guard still
// runs in the route (requireAuth + manual tenantId check) so the service
// stays tenant-agnostic. Response shapes unchanged.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { novedadesService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const CaseUpdateSchema = z
  .object({
    status: z.string().optional(),
    priority: z.string().optional(),
    assignedTo: z.string().nullable().optional(),
    resolution: z.string().nullable().optional(),
    guideNumber: z.string().nullable().optional(),
    carrierName: z.string().nullable().optional(),
    description: z.string().optional(),
  })
  .strict()

async function getCaseOrFail(id: string) {
  const { session, error } = await requireAuth()
  if (error) return { session: null, error, caseRow: null }

  const caseRow = await novedadesService.getCaseById(id)
  if (!caseRow) {
    return {
      session,
      error: NextResponse.json({ error: 'Case not found' }, { status: 404 }),
      caseRow: null,
    }
  }
  // Tenant guard — platform admins (no tenantId on session) bypass.
  // `session.user.tenantId` is typed via the Session augmentation in
  // `src/types/next-auth.d.ts` — direct access, no cast needed.
  const userTenantId = session?.user?.tenantId ?? null
  if (userTenantId && userTenantId !== caseRow.tenantId) {
    return {
      session,
      error: NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 }),
      caseRow: null,
    }
  }
  return { session, error: null, caseRow }
}

/**
 * GET /api/novedades/[id]
 *
 * Fetch a single novedad with events + assignee + customer.
 *
 * @security Requires authentication + tenant access
 * @returns Case detail
 */
export const GET = withErrorHandling(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {

  const { id } = await params
  const { error, caseRow } = await getCaseOrFail(id)
  if (error) return error
  if (!caseRow) return NextResponse.json({ error: 'No case' }, { status: 404 })

  return NextResponse.json({
    case: {
      id: caseRow.id,
      tenantId: caseRow.tenantId,
      caseNumber: caseRow.caseNumber,
      orderId: caseRow.orderId,
      phone: caseRow.phone,
      customerName: caseRow.customerName,
      guideNumber: caseRow.guideNumber,
      carrierName: caseRow.carrierName,
      type: caseRow.type,
      status: caseRow.status,
      priority: caseRow.priority,
      description: caseRow.description,
      resolution: caseRow.resolution,
      assignedTo: caseRow.assignedTo,
      createdAt: caseRow.createdAt,
      updatedAt: caseRow.updatedAt,
      resolvedAt: caseRow.resolvedAt,
    },
    evidence: caseRow.evidence,
    messages: caseRow.messages,
  })

})

/**
 * PATCH /api/novedades/[id]
 *
 * Update a novedad (status change, add note, reassign).
 *
 * @security Requires authentication + tenant access
 * @returns Updated case
 */
export const PATCH = withErrorHandling(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {

  const { id } = await params
  const { error, caseRow } = await getCaseOrFail(id)
  if (error) return error
  if (!caseRow) return NextResponse.json({ error: 'No case' }, { status: 404 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = CaseUpdateSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data

  // Map the validated fields to DB column names (the input uses the same
  // names as the columns here, but `body[k] !== undefined` filtering is
  // preserved so partial PATCH bodies don't null out unmentioned fields).
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) data[k] = v
  }
  // If status flips to resolved, stamp resolvedAt.
  if (data.status === 'resolved' && !caseRow.resolvedAt) {
    data.resolvedAt = new Date()
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }

    const updated = await novedadesService.updateCaseFields(caseRow.id, data)
    return NextResponse.json({ case: updated })
  

})
