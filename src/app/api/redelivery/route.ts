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
//
// SPRINT8-SERVICES-REST-001 — migrated every RedeliveryRequest + RedeliveryAttempt
// read/write to `novedadesService` (redelivery methods). Response shapes
// unchanged; transactions now live in the service layer.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { novedadesService } from '@/lib/services'

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

  try {
    const { requests, statsMap } = await novedadesService.getRedeliveryRequests(tenantId, status)
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
  } catch (err) {
    captureError(err as Error, { path: '/api/redelivery', method: 'GET', tenantId })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
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

  try {
    const { request, attempt } = await novedadesService.createRedeliveryRequest({
      tenantId,
      guideNumber: String(guideNumber),
      customerPhone: String(customerPhone),
      customerName: String(customerName),
      originalAddress: String(originalAddress),
      newAddress: newAddress ? String(newAddress) : null,
      reason: String(reason),
    })
    return NextResponse.json({ request, attempt }, { status: 201 })
  } catch (err) {
    captureError(err as Error, { path: '/api/redelivery', method: 'POST', tenantId })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
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

  const existing = await novedadesService.getRedeliveryRequestForUpdate(redeliveryId, tenantId)
  if (!existing) {
    return NextResponse.json(
      { error: 'Redelivery request not found in this tenant' },
      { status: 404 },
    )
  }

  const latestAttempt = existing.attempts[0] || null

  try {
    switch (action) {
      case 'confirm_address': {
        const { newAddress } = body
        if (!newAddress) {
          return NextResponse.json({ error: 'newAddress required' }, { status: 400 })
        }
        const updated = await novedadesService.confirmRedeliveryAddress(redeliveryId, String(newAddress))
        return NextResponse.json({ request: updated })
      }

      case 'schedule': {
        const { scheduledAt, agentNote } = body
        const when = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 24 * 60 * 60 * 1000)
        const updated = await novedadesService.scheduleRedeliveryAttempt(
          redeliveryId,
          when,
          latestAttempt?.id ?? null,
          agentNote ? String(agentNote) : undefined,
        )
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
        const updated = await novedadesService.assignRedeliveryHuman(latestAttempt.id, String(agentNote))
        return NextResponse.json({ attempt: updated })
      }

      case 'complete': {
        const { carrierResponse } = body
        const updated = await novedadesService.completeRedelivery(
          redeliveryId,
          latestAttempt?.id ?? null,
          carrierResponse ?? null,
        )
        return NextResponse.json({ request: updated })
      }

      case 'cancel': {
        const { reason: cancelReason } = body
        const updated = await novedadesService.cancelRedelivery(
          redeliveryId,
          latestAttempt?.id ?? null,
          cancelReason ? String(cancelReason) : undefined,
        )
        return NextResponse.json({ request: updated })
      }

      case 'add_attempt': {
        const next = (existing.attemptNumber || 1) + 1
        const { request, attempt } = await novedadesService.addRedeliveryAttempt(redeliveryId, next)
        return NextResponse.json({ request, attempt })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    captureError(err as Error, { path: '/api/redelivery', method: 'PATCH', tenantId, action })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
