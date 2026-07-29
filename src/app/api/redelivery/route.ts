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
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { novedadesService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const CreateRedeliverySchema = z.object({
  guideNumber: z.string().min(1),
  customerPhone: z.string().min(1),
  customerName: z.string().min(1),
  originalAddress: z.string().min(1),
  newAddress: z.string().nullable().optional(),
  reason: z.string().min(1),
})

const ConfirmAddressSchema = z.object({
  action: z.literal('confirm_address'),
  redeliveryId: z.string().min(1),
  newAddress: z.string().min(1),
})

const ScheduleSchema = z.object({
  action: z.literal('schedule'),
  redeliveryId: z.string().min(1),
  scheduledAt: z.string().nullable().optional(),
  agentNote: z.string().nullable().optional(),
})

const AssignHumanSchema = z.object({
  action: z.literal('assign_human'),
  redeliveryId: z.string().min(1),
  agentNote: z.string().min(1),
})

const CompleteSchema = z.object({
  action: z.literal('complete'),
  redeliveryId: z.string().min(1),
  carrierResponse: z.string().nullable().optional(),
})

const CancelSchema = z.object({
  action: z.literal('cancel'),
  redeliveryId: z.string().min(1),
  reason: z.string().nullable().optional(),
})

const AddAttemptSchema = z.object({
  action: z.literal('add_attempt'),
  redeliveryId: z.string().min(1),
})

const RedeliveryActionSchema = z.discriminatedUnion('action', [
  ConfirmAddressSchema,
  ScheduleSchema,
  AssignHumanSchema,
  CompleteSchema,
  CancelSchema,
  AddAttemptSchema,
])

// ───────────────────────────────────────────────────────────────────────────
// GET
// ───────────────────────────────────────────────────────────────────────────

/**
 * GET /api/redelivery
 *
 * List redelivery requests (failed/returned orders) with their attempt history + status stats.
 *
 * @security Requires authentication + tenant access (requireTenantAccess)
 * @returns { stats, requests[] }
 */
export const GET = withErrorHandling(async (req: NextRequest) => {

  const sp = req.nextUrl.searchParams
  const tenantId = sp.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const status = sp.get('status') || undefined

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
  

})

// ───────────────────────────────────────────────────────────────────────────
// POST — create redelivery request
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /api/redelivery
 *
 * Create a new RedeliveryRequest for a failed/returned shipment. Auto-schedules attempt #1.
 *
 * @security Requires authentication + tenant access (requireTenantAccess)
 * @returns { request, attempt } (HTTP 201)
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

  const sp = req.nextUrl.searchParams
  const tenantId = sp.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = CreateRedeliverySchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const { guideNumber, customerPhone, customerName, originalAddress, newAddress, reason } = parseResult.data

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
  

})

// ───────────────────────────────────────────────────────────────────────────
// PATCH — action dispatch
// ───────────────────────────────────────────────────────────────────────────

/**
 * PATCH /api/redelivery
 *
 * Action dispatch on a RedeliveryRequest — `confirm_address` | `schedule` | `assign_human` | `complete` | `cancel` | `add_attempt`.
 * Body is a discriminated union on the `action` field.
 *
 * @security Requires authentication + tenant access (requireTenantAccess + request.tenantId check)
 * @returns Action-specific result (updated request / attempt)
 */
export const PATCH = withErrorHandling(async (req: NextRequest) => {

  const sp = req.nextUrl.searchParams
  const tenantId = sp.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = RedeliveryActionSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const { action, redeliveryId } = body

  const existing = await novedadesService.getRedeliveryRequestForUpdate(redeliveryId, tenantId)
  if (!existing) {
    return NextResponse.json(
      { error: 'Redelivery request not found in this tenant' },
      { status: 404 },
    )
  }

  const latestAttempt = existing.attempts[0] || null

    switch (action) {
      case 'confirm_address': {
        const { newAddress } = body
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
        if (!latestAttempt) {
          return NextResponse.json(
            { error: 'a latest attempt must exist' },
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
  

})
