// Novedades API — CRM for logistics incidents.
//
// GET  ?tenantId=X&status=Y&type=Z&carrier=W&q=...&cursor=ID&limit=N
//      → { stats, cases[], nextCursor, hasMore }
//
//      Cursor-based pagination (SPRINT6-SCALE-001). `cursor` is the `id` of
//      the last case on the previous page. Default page size 20, max 100.
//      The `stats` block is NOT paginated — it's a global group-by over
//      every matching case for the tenant.
//
// POST (no action) — create a new case
//      → auto-generates caseNumber NV-YYYY-XXXXX
//      → validates that orderId (if provided) belongs to the tenant
//
// PATCH (body.action):
//   assign        → set assignedTo
//   resolve       → set status=resolved, resolution, resolvedAt
//   add_evidence  → append NovedadEvidence
//   add_message   → append NovedadMessage
//   escalate      → set status=escalated, priority=high
//   close         → set status=closed
//
// Auth: requireTenantAccess(tenantId) on every entry.
//
// SPRINT7-POSTGRES-SERVICES-001 — GET + POST migrated from
// `db.novedadCase.findMany` / `db.$transaction` to the service layer
// (`novedadesService.getCases` / `novedadesService.createCase`). PATCH is
// intentionally left untouched (its action-dispatch transactions don't have
// a 1:1 service method yet). Response shapes are unchanged.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { novedadesService } from '@/lib/services'

const log = getLogger('api:novedades')

const VALID_TYPES = [
  'paquete_perdido',
  'producto_danado',
  'direccion_incorrecta',
  'retraso',
  'otro',
] as const

const CreateCaseSchema = z.object({
  phone: z.string().min(1),
  customerName: z.string().min(1),
  guideNumber: z.string().nullable().optional(),
  carrierName: z.string().nullable().optional(),
  type: z.enum(VALID_TYPES),
  priority: z.string().optional(),
  description: z.string().min(1),
  orderId: z.string().nullable().optional(),
})

const AssignSchema = z.object({
  action: z.literal('assign'),
  caseId: z.string().min(1),
  assignedTo: z.string().min(1),
})

const ResolveSchema = z.object({
  action: z.literal('resolve'),
  caseId: z.string().min(1),
  resolution: z.string().min(1),
})

const AddEvidenceSchema = z.object({
  action: z.literal('add_evidence'),
  caseId: z.string().min(1),
  url: z.string().min(1),
  type: z.enum(['image', 'document', 'video']).optional(),
  uploadedBy: z.string().optional(),
})

const AddMessageSchema = z.object({
  action: z.literal('add_message'),
  caseId: z.string().min(1),
  body: z.string().min(1),
  authorRole: z.enum(['agent', 'carrier', 'customer', 'system']).optional(),
})

const EscalateSchema = z.object({
  action: z.literal('escalate'),
  caseId: z.string().min(1),
})

const CloseSchema = z.object({
  action: z.literal('close'),
  caseId: z.string().min(1),
})

const CaseActionSchema = z.discriminatedUnion('action', [
  AssignSchema,
  ResolveSchema,
  AddEvidenceSchema,
  AddMessageSchema,
  EscalateSchema,
  CloseSchema,
])

// ───────────────────────────────────────────────────────────────────────────
// GET
// ───────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tenantId = sp.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const status = sp.get('status') || undefined
  const type = sp.get('type') || undefined
  const carrier = sp.get('carrier') || undefined
  const q = sp.get('q') || undefined
  const cursor = sp.get('cursor') || undefined
  // Default page size 20, hard ceiling 100 to prevent unbounded queries.
  const parsedLimit = parseInt(sp.get('limit') || '20', 10)
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 100)
    : 20

  // The service takes `limit + 1` so we can detect a next page; it also
  // returns the global stats group-by (not paginated).
  const { cases: rows, stats: grouped } = await novedadesService.getCases(tenantId, {
    status,
    type,
    carrier,
    q,
    cursor,
    limit,
  })

  const hasNext = rows.length > limit
  const cases = hasNext ? rows.slice(0, limit) : rows
  const nextCursor = hasNext ? cases[cases.length - 1].id : null

  const statsMap: Record<string, number> = { open: 0, assigned: 0, resolved: 0, escalated: 0, closed: 0 }
  for (const g of grouped) statsMap[g.status] = g._count
  return NextResponse.json({
    stats: {
      total: Object.values(statsMap).reduce((a, b) => a + b, 0),
      open: statsMap.open || 0,
      assigned: statsMap.assigned || 0,
      resolved: statsMap.resolved || 0,
      escalated: statsMap.escalated || 0,
      closed: statsMap.closed || 0,
    },
    cases: cases.map(c => ({
      id: c.id,
      caseNumber: c.caseNumber,
      orderId: c.orderId,
      phone: c.phone,
      customerName: c.customerName,
      guideNumber: c.guideNumber,
      carrierName: c.carrierName,
      type: c.type,
      status: c.status,
      priority: c.priority,
      description: c.description,
      resolution: c.resolution,
      assignedTo: c.assignedTo,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      resolvedAt: c.resolvedAt,
      evidenceCount: c._count.evidence,
      messageCount: c._count.messages,
      thumbnail: c.evidence[0]?.url || null,
    })),
    nextCursor,
    hasMore: hasNext,
  })
}

// ───────────────────────────────────────────────────────────────────────────
// POST — create case
// ───────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tenantId = sp.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error, session } = await requireTenantAccess(tenantId)
  if (error) return error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = CreateCaseSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const { phone, customerName, guideNumber, carrierName, type, priority, description, orderId } = body

  // Validate that orderId (if provided) belongs to this tenant.
  // (Still a direct `db.order.findUnique` — out of the orderService scope of
  // this task; the validation only reads the tenantId, never returns data.)
  if (orderId) {
    const order = await db.order.findUnique({ where: { id: orderId }, select: { tenantId: true } })
    if (!order || order.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'Order not found or not in this tenant' },
        { status: 404 },
      )
    }
  }

  // `session.user.{name,email}` are typed via the Session augmentation in
  // `src/types/next-auth.d.ts` — direct access, no cast needed.
  const authorName = session?.user?.name || session?.user?.email || 'system'

  // The service generates the caseNumber + stamps the initial system
  // message atomically in a single $transaction.
  const newCase = await novedadesService.createCase({
    tenantId,
    orderId: orderId || null,
    phone: String(phone),
    customerName: String(customerName),
    guideNumber: guideNumber ? String(guideNumber) : null,
    carrierName: carrierName ? String(carrierName) : null,
    type,
    priority: priority || 'normal',
    description: String(description),
    authorName,
  })

  log.info(
    { tenantId, caseId: newCase.id, caseNumber: newCase.caseNumber, type, priority, orderId: orderId || null },
    'case created',
  )
  return NextResponse.json({ case: newCase }, { status: 201 })
}

// ───────────────────────────────────────────────────────────────────────────
// PATCH — action dispatch
// ───────────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tenantId = sp.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error, session } = await requireTenantAccess(tenantId)
  if (error) return error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = CaseActionSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const { action, caseId } = body

  // Ensure the case belongs to the tenant before doing anything.
  const existing = await db.novedadCase.findUnique({ where: { id: caseId } })
  if (!existing || existing.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Case not found in this tenant' }, { status: 404 })
  }

  // `session.user.{name,email}` are typed via the Session augmentation in
  // `src/types/next-auth.d.ts` — direct access, no cast needed.
  const authorName = session?.user?.name || session?.user?.email || 'system'

  switch (action) {
    case 'assign': {
      const { assignedTo } = body
      // Atomic: case update + audit message.
      const updated = await db.$transaction(async (tx) => {
        const c = await tx.novedadCase.update({
          where: { id: caseId },
          data: {
            assignedTo: String(assignedTo),
            status: existing.status === 'open' ? 'assigned' : existing.status,
          },
        })
        await tx.novedadMessage.create({
          data: {
            caseId,
            authorName,
            authorRole: 'agent',
            body: `Caso asignado a ${assignedTo}.`,
          },
        })
        return c
      })
      return NextResponse.json({ case: updated })
    }

    case 'resolve': {
      const { resolution } = body
      const updated = await db.$transaction(async (tx) => {
        const c = await tx.novedadCase.update({
          where: { id: caseId },
          data: {
            status: 'resolved',
            resolution: String(resolution),
            resolvedAt: new Date(),
          },
        })
        await tx.novedadMessage.create({
          data: {
            caseId,
            authorName,
            authorRole: 'agent',
            body: `Caso resuelto: ${resolution}`,
          },
        })
        return c
      })
      log.info({ tenantId, caseId, caseNumber: existing.caseNumber }, 'case resolved')
      return NextResponse.json({ case: updated })
    }

    case 'add_evidence': {
      const { url, type, uploadedBy } = body
      const evType = type ?? 'image'
      const evidence = await db.novedadEvidence.create({
        data: {
          caseId,
          url: String(url),
          type: evType,
          uploadedBy: uploadedBy || authorName,
        },
      })
      return NextResponse.json({ evidence })
    }

    case 'add_message': {
      const { body: msgBody, authorRole } = body
      const message = await db.novedadMessage.create({
        data: {
          caseId,
          authorName,
          authorRole: authorRole ?? 'agent',
          body: String(msgBody),
        },
      })
      return NextResponse.json({ message })
    }

    case 'escalate': {
      const updated = await db.$transaction(async (tx) => {
        const c = await tx.novedadCase.update({
          where: { id: caseId },
          data: { status: 'escalated', priority: 'high' },
        })
        await tx.novedadMessage.create({
          data: {
            caseId,
            authorName,
            authorRole: 'agent',
            body: `Caso escalado a prioridad alta.`,
          },
        })
        return c
      })
      log.warn({ tenantId, caseId, caseNumber: existing.caseNumber }, 'case escalated')
      return NextResponse.json({ case: updated })
    }

    case 'close': {
      const updated = await db.$transaction(async (tx) => {
        const c = await tx.novedadCase.update({
          where: { id: caseId },
          data: { status: 'closed' },
        })
        await tx.novedadMessage.create({
          data: {
            caseId,
            authorName,
            authorRole: 'agent',
            body: `Caso cerrado.`,
          },
        })
        return c
      })
      return NextResponse.json({ case: updated })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}
