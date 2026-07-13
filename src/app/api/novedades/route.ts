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

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'

const log = getLogger('api:novedades')

const VALID_TYPES = [
  'paquete_perdido',
  'producto_danado',
  'direccion_incorrecta',
  'retraso',
  'otro',
]
const VALID_STATUSES = ['open', 'assigned', 'resolved', 'escalated', 'closed']

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

  const where: any = { tenantId }
  if (status && status !== 'all') where.status = status
  if (type && type !== 'all') where.type = type
  if (carrier && carrier !== 'all') where.carrierName = carrier
  if (q) {
    where.OR = [
      { caseNumber: { contains: q, mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
      { guideNumber: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ]
  }

  const [rows, stats] = await Promise.all([
    db.novedadCase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // take 1 extra to detect a next page
      // `skip: 1` with cursor: Prisma includes the cursor row by default,
      // we want the row *after* it.
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        evidence: { take: 1, orderBy: { createdAt: 'desc' } },
        _count: { select: { evidence: true, messages: true } },
      },
    }),
    // Stats are NOT paginated — they're a global group-by over every
    // matching case for the tenant, so the badges in the UI stay accurate
    // regardless of which page is loaded.
    db.novedadCase.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    }),
  ])

  const hasNext = rows.length > limit
  const cases = hasNext ? rows.slice(0, limit) : rows
  const nextCursor = hasNext ? cases[cases.length - 1].id : null

  const statsMap: Record<string, number> = { open: 0, assigned: 0, resolved: 0, escalated: 0, closed: 0 }
  for (const g of stats) statsMap[g.status] = g._count
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

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { phone, customerName, guideNumber, carrierName, type, priority, description, orderId } = body
  if (!phone || !customerName || !description || !type) {
    return NextResponse.json(
      { error: 'phone, customerName, description, type are required' },
      { status: 400 },
    )
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 })
  }

  // Validate that orderId (if provided) belongs to this tenant.
  if (orderId) {
    const order = await db.order.findUnique({ where: { id: orderId }, select: { tenantId: true } })
    if (!order || order.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'Order not found or not in this tenant' },
        { status: 404 },
      )
    }
  }

  // Auto-generate caseNumber NV-YYYY-XXXXX (year + base36 of count+random).
  const year = new Date().getFullYear()
  const random = Math.random().toString(36).slice(2, 7).toUpperCase()
  const caseNumber = `NV-${year}-${random}`

  const authorName = (session?.user as any)?.name || (session?.user as any)?.email || 'system'

  // Atomic: create the case + stamp the initial system message together so
  // we never end up with a case that has no opening message (or vice versa).
  const newCase = await db.$transaction(async (tx) => {
    const created = await tx.novedadCase.create({
      data: {
        tenantId,
        caseNumber,
        orderId: orderId || null,
        phone: String(phone),
        customerName: String(customerName),
        guideNumber: guideNumber ? String(guideNumber) : null,
        carrierName: carrierName ? String(carrierName) : null,
        type,
        priority: priority || 'normal',
        description: String(description),
        status: 'open',
      },
    })

    // Stamp an initial system message so the chat thread isn't empty.
    await tx.novedadMessage.create({
      data: {
        caseId: created.id,
        authorName,
        authorRole: 'system',
        body: `Caso ${caseNumber} creado para ${customerName}.`,
      },
    })

    return created
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

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, caseId } = body
  if (!action || !caseId) {
    return NextResponse.json({ error: 'action and caseId are required' }, { status: 400 })
  }

  // Ensure the case belongs to the tenant before doing anything.
  const existing = await db.novedadCase.findUnique({ where: { id: caseId } })
  if (!existing || existing.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Case not found in this tenant' }, { status: 404 })
  }

  const authorName = (session?.user as any)?.name || (session?.user as any)?.email || 'system'

  switch (action) {
    case 'assign': {
      const { assignedTo } = body
      if (!assignedTo) {
        return NextResponse.json({ error: 'assignedTo required' }, { status: 400 })
      }
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
      if (!resolution) {
        return NextResponse.json({ error: 'resolution required' }, { status: 400 })
      }
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
      if (!url) {
        return NextResponse.json({ error: 'url required' }, { status: 400 })
      }
      const evType = ['image', 'document', 'video'].includes(type) ? type : 'image'
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
      if (!msgBody) {
        return NextResponse.json({ error: 'body required' }, { status: 400 })
      }
      const message = await db.novedadMessage.create({
        data: {
          caseId,
          authorName,
          authorRole: ['agent', 'carrier', 'customer', 'system'].includes(authorRole) ? authorRole : 'agent',
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
