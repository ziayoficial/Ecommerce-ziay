// Redelivery API — manage re-delivery attempts for failed/returned orders.
//
// GET  ?tenantId=X&status=Y
//      → { stats, requests[] (with attempts) }
//
// POST (no action) — create a new RedeliveryRequest.
//      → auto attemptNumber=1, schedules the first attempt.
//
// PATCH (body.action):
//   confirm_address → set newAddress (after carrier confirms)
//   schedule        → set status=scheduled, scheduledAt, create attempt row
//   assign_human    → set agentNote on latest attempt
//   complete        → set status=completed, completedAt; attempt status=success
//   cancel          → set status=cancelled; attempt status=failed
//   add_attempt     → increment attemptNumber + append a new attempt row
//
// Auth: requireTenantAccess(tenantId) on every entry.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'

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
  const where: any = { tenantId }
  if (status && status !== 'all') where.status = status

  const [requests, stats] = await Promise.all([
    db.redeliveryRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { attempts: { orderBy: { attemptedAt: 'desc' } } },
    }),
    db.redeliveryRequest.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    }),
  ])

  const statsMap: Record<string, number> = { pending: 0, scheduled: 0, completed: 0, cancelled: 0 }
  for (const g of stats) statsMap[g.status] = g._count
  return NextResponse.json({
    stats: {
      total: Object.values(statsMap).reduce((a, b) => a + b, 0),
      pending: statsMap.pending || 0,
      scheduled: statsMap.scheduled || 0,
      completed: statsMap.completed || 0,
      cancelled: statsMap.cancelled || 0,
    },
    requests,
  })
}

// ───────────────────────────────────────────────────────────────────────────
// POST — create redelivery request
// ───────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tenantId = sp.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { guideNumber, customerPhone, customerName, originalAddress, newAddress, reason } = body
  if (!guideNumber || !customerPhone || !customerName || !originalAddress || !reason) {
    return NextResponse.json(
      { error: 'guideNumber, customerPhone, customerName, originalAddress, reason are required' },
      { status: 400 },
    )
  }

  // Atomic: create the request + schedule the first attempt together so we
  // never end up with a request that has zero attempts (or an orphan attempt).
  const { request, attempt } = await db.$transaction(async (tx) => {
    const created = await tx.redeliveryRequest.create({
      data: {
        tenantId,
        guideNumber: String(guideNumber),
        customerPhone: String(customerPhone),
        customerName: String(customerName),
        originalAddress: String(originalAddress),
        newAddress: newAddress ? String(newAddress) : null,
        reason: String(reason),
        status: 'pending',
        attemptNumber: 1,
      },
    })

    // Schedule the first attempt as pending.
    const firstAttempt = await tx.redeliveryAttempt.create({
      data: {
        redeliveryId: created.id,
        attemptNumber: 1,
        status: 'pending',
        attemptedAt: new Date(),
      },
    })

    return { request: created, attempt: firstAttempt }
  })

  return NextResponse.json({ request, attempt }, { status: 201 })
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
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, redeliveryId } = body
  if (!action || !redeliveryId) {
    return NextResponse.json({ error: 'action and redeliveryId are required' }, { status: 400 })
  }

  const existing = await db.redeliveryRequest.findUnique({
    where: { id: redeliveryId },
    include: { attempts: { orderBy: { attemptedAt: 'desc' }, take: 1 } },
  })
  if (!existing || existing.tenantId !== tenantId) {
    return NextResponse.json(
      { error: 'Redelivery request not found in this tenant' },
      { status: 404 },
    )
  }

  const latestAttempt = existing.attempts[0] || null

  switch (action) {
    case 'confirm_address': {
      const { newAddress } = body
      if (!newAddress) {
        return NextResponse.json({ error: 'newAddress required' }, { status: 400 })
      }
      const updated = await db.redeliveryRequest.update({
        where: { id: redeliveryId },
        data: { newAddress: String(newAddress) },
      })
      return NextResponse.json({ request: updated })
    }

    case 'schedule': {
      const { scheduledAt, agentNote } = body
      const when = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 24 * 60 * 60 * 1000)
      // Atomic: update the request + record the scheduling note on the latest attempt.
      const updated = await db.$transaction(async (tx) => {
        const r = await tx.redeliveryRequest.update({
          where: { id: redeliveryId },
          data: { status: 'scheduled', scheduledAt: when },
        })
        // Mark the latest attempt as scheduled via agentNote (no `scheduled` status
        // in the enum — we use a note to record scheduling; the attempt itself
        // stays pending until it's actually attempted).
        if (latestAttempt) {
          await tx.redeliveryAttempt.update({
            where: { id: latestAttempt.id },
            data: { agentNote: agentNote ? String(agentNote) : `Programado para ${when.toISOString()}` },
          })
        }
        return r
      })
      return NextResponse.json({ request: updated })
    }

    case 'assign_human': {
      const { agentNote } = body
      if (!agentNote || !latestAttempt) {
        return NextResponse.json(
          { error: 'agentNote required and a latest attempt must exist' },
          { status: 400 },
        )
      }
      const updated = await db.redeliveryAttempt.update({
        where: { id: latestAttempt.id },
        data: { agentNote: String(agentNote) },
      })
      return NextResponse.json({ attempt: updated })
    }

    case 'complete': {
      const { carrierResponse } = body
      // Atomic: mark request as completed + mark latest attempt as success.
      const updated = await db.$transaction(async (tx) => {
        const r = await tx.redeliveryRequest.update({
          where: { id: redeliveryId },
          data: { status: 'completed', completedAt: new Date() },
        })
        if (latestAttempt) {
          await tx.redeliveryAttempt.update({
            where: { id: latestAttempt.id },
            data: { status: 'success', carrierResponse: carrierResponse ? String(carrierResponse) : null },
          })
        }
        return r
      })
      return NextResponse.json({ request: updated })
    }

    case 'cancel': {
      const { reason: cancelReason } = body
      // Atomic: mark request as cancelled + mark latest attempt as failed.
      const updated = await db.$transaction(async (tx) => {
        const r = await tx.redeliveryRequest.update({
          where: { id: redeliveryId },
          data: { status: 'cancelled' },
        })
        if (latestAttempt) {
          await tx.redeliveryAttempt.update({
            where: { id: latestAttempt.id },
            data: { status: 'failed', agentNote: cancelReason ? String(cancelReason) : 'Cancelled by agent' },
          })
        }
        return r
      })
      return NextResponse.json({ request: updated })
    }

    case 'add_attempt': {
      const next = (existing.attemptNumber || 1) + 1
      // Atomic: create the new attempt + bump the request's attemptNumber.
      const { request, attempt } = await db.$transaction(async (tx) => {
        const a = await tx.redeliveryAttempt.create({
          data: {
            redeliveryId: redeliveryId,
            attemptNumber: next,
            status: 'pending',
            attemptedAt: new Date(),
          },
        })
        const r = await tx.redeliveryRequest.update({
          where: { id: redeliveryId },
          data: { attemptNumber: next, status: 'pending' },
        })
        return { request: r, attempt: a }
      })
      return NextResponse.json({ request, attempt })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}
