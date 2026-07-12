// Novedades detail API — single-case GET + PATCH.
//
// GET    /api/novedades/:id — full case detail with evidence + messages.
// PATCH  /api/novedades/:id — direct field update (with tenant guard).
//
// Auth: the case's tenantId must match the caller's tenantId (or caller must
// be a platform admin/finance with no tenantId).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'

async function getCaseOrFail(id: string) {
  const { session, error } = await requireAuth()
  if (error) return { session: null, error, caseRow: null }

  const caseRow = await db.novedadCase.findUnique({
    where: { id },
    include: {
      evidence: { orderBy: { createdAt: 'desc' } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!caseRow) {
    return {
      session,
      error: NextResponse.json({ error: 'Case not found' }, { status: 404 }),
      caseRow: null,
    }
  }
  // Tenant guard — platform admins (no tenantId on session) bypass.
  const userTenantId = (session?.user as any)?.tenantId
  if (userTenantId && userTenantId !== caseRow.tenantId) {
    return {
      session,
      error: NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 }),
      caseRow: null,
    }
  }
  return { session, error: null, caseRow }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { error, caseRow } = await getCaseOrFail(id)
  if (error) return error
  if (!caseRow) return NextResponse.json({ error: 'No case' }, { status: 404 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const allowed: Record<string, string> = {
    status: 'status',
    priority: 'priority',
    assignedTo: 'assignedTo',
    resolution: 'resolution',
    guideNumber: 'guideNumber',
    carrierName: 'carrierName',
    description: 'description',
  }
  const data: Record<string, unknown> = {}
  for (const [k, dbKey] of Object.entries(allowed)) {
    if (body[k] !== undefined) data[dbKey] = body[k]
  }
  // If status flips to resolved, stamp resolvedAt.
  if (data.status === 'resolved' && !caseRow.resolvedAt) {
    data.resolvedAt = new Date()
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }

  const updated = await db.novedadCase.update({
    where: { id: caseRow.id },
    data,
  })
  return NextResponse.json({ case: updated })
}
