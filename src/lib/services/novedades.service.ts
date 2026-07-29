// ZIAY — Novedades service layer.
//
// Novedades = logistics claims / cases (lost packages, damaged products,
// wrong addresses, delays). Wraps NovedadCase + NovedadEvidence +
// NovedadMessage access.
//
// SPRINT6-ARCH-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:novedades')

export interface NovedadCaseFilters {
  status?: string
  type?: string
  carrier?: string
  q?: string
  /** Cursor-based pagination — id of the last row on the previous page. */
  cursor?: string
  /** Page size. The service takes `limit + 1` so the caller can detect
   *  `hasMore`. When omitted, falls back to 200 (legacy behaviour). */
  limit?: number
}

export interface CreateCaseInput {
  tenantId: string
  orderId?: string | null
  phone: string
  customerName: string
  guideNumber?: string | null
  carrierName?: string | null
  type: string
  priority?: string
  description: string
  caseNumber?: string
  authorName?: string
}

export const novedadesService = {
  /**
   * List cases for a tenant + status/type breakdown for the stats bar.
   *
   * Cursor-based pagination: pass `filters.cursor` (id of the last row on
   * the previous page) + `filters.limit`. The service returns `limit + 1`
   * rows so the caller can detect `hasMore`. When `limit` is omitted it
   * falls back to a hard cap of 200 (legacy behaviour).
   *
   * The `stats` block is NOT paginated — it's a global group-by over every
   * case for the tenant, so the badges in the UI stay accurate regardless
   * of which page is loaded.
   *
   * Returns `{ cases, stats }`.
   */
  async getCases(tenantId: string, filters?: NovedadCaseFilters) {
    try {
      const where: Record<string, unknown> = { tenantId }
      if (filters?.status && filters.status !== 'all') where.status = filters.status
      if (filters?.type && filters.type !== 'all') where.type = filters.type
      if (filters?.carrier && filters.carrier !== 'all') where.carrierName = filters.carrier
      if (filters?.q) {
        where.OR = [
          { caseNumber: { contains: filters.q } },
          { customerName: { contains: filters.q } },
          { guideNumber: { contains: filters.q } },
          { phone: { contains: filters.q } },
        ]
      }

      const limit = filters?.limit
      const take = limit != null ? limit + 1 : 200

      const [cases, stats] = await Promise.all([
        db.novedadCase.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
          // `skip: 1` with cursor: Prisma includes the cursor row by
          // default — we want the row *after* it.
          ...(filters?.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
          include: {
            evidence: { take: 1, orderBy: { createdAt: 'desc' } },
            _count: { select: { evidence: true, messages: true } },
          },
        }),
        db.novedadCase.groupBy({
          by: ['status'],
          where: { tenantId },
          _count: true,
        }),
      ])
      return { cases, stats }
    } catch (err) {
      captureError(err as Error, { service: 'novedades', method: 'getCases', tenantId })
      throw new Error('Failed to fetch novedades cases')
    }
  },

  /**
   * Single case with full evidence + message thread.
   */
  async getCaseById(id: string, tenantId?: string) {
    try {
      return await db.novedadCase.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
        include: {
          evidence: { orderBy: { createdAt: 'desc' } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      })
    } catch (err) {
      captureError(err as Error, { service: 'novedades', method: 'getCaseById', id })
      throw new Error('Failed to fetch case')
    }
  },

  /**
   * Create a case + the initial system "case opened" message in a single
   * transaction so a case can never exist without its opening message.
   */
  async createCase(input: CreateCaseInput) {
    try {
      const caseNumber =
        input.caseNumber ||
        `NV-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`

      const created = await db.$transaction(async (tx) => {
        const c = await tx.novedadCase.create({
          data: {
            tenantId: input.tenantId,
            caseNumber,
            orderId: input.orderId ?? null,
            phone: String(input.phone),
            customerName: String(input.customerName),
            guideNumber: input.guideNumber ?? null,
            carrierName: input.carrierName ?? null,
            type: input.type,
            priority: input.priority || 'normal',
            description: String(input.description),
            status: 'open',
          },
        })
        await tx.novedadMessage.create({
          data: {
            caseId: c.id,
            authorName: input.authorName || 'system',
            authorRole: 'system',
            body: `Caso ${caseNumber} creado para ${input.customerName}.`,
          },
        })
        return c
      })
      log.info(
        { tenantId: input.tenantId, caseId: created.id, caseNumber, type: input.type },
        'Case created',
      )
      return created
    } catch (err) {
      captureError(err as Error, { service: 'novedades', method: 'createCase', tenantId: input.tenantId })
      throw new Error('Failed to create case')
    }
  },

  /**
   * Update a case's status / resolution / assignment / priority.
   */
  async updateCase(
    id: string,
    tenantId: string,
    patch: {
      status?: string
      priority?: string
      assignedTo?: string
      resolution?: string
      resolvedAt?: Date | null
    },
  ) {
    try {
      const updated = await db.novedadCase.update({
        where: { id },
        data: {
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.priority ? { priority: patch.priority } : {}),
          ...(patch.assignedTo !== undefined ? { assignedTo: patch.assignedTo } : {}),
          ...(patch.resolution !== undefined ? { resolution: patch.resolution } : {}),
          ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
        },
      })
      log.info({ tenantId, caseId: id, patch: Object.keys(patch) }, 'Case updated')
      return updated
    } catch (err) {
      captureError(err as Error, { service: 'novedades', method: 'updateCase', id })
      throw new Error('Failed to update case')
    }
  },

  /**
   * Append evidence (image / document / video URL) to a case.
   */
  async addEvidence(
    caseId: string,
    payload: { url: string; type?: string; uploadedBy?: string },
  ) {
    try {
      const evType = ['image', 'document', 'video'].includes(payload.type || '')
        ? payload.type!
        : 'image'
      const evidence = await db.novedadEvidence.create({
        data: {
          caseId,
          url: String(payload.url),
          type: evType,
          uploadedBy: payload.uploadedBy || null,
        },
      })
      log.info({ caseId, evidenceId: evidence.id, type: evType }, 'Evidence added')
      return evidence
    } catch (err) {
      captureError(err as Error, { service: 'novedades', method: 'addEvidence', caseId })
      throw new Error('Failed to add evidence')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Redelivery — added in SPRINT8-SERVICES-REST-001 to migrate
  // `/api/redelivery`. RedeliveryRequest is the natural extension of the
  // Novedades CRM (failed/returned shipments → re-delivery attempts).
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List RedeliveryRequest rows for a tenant + per-status counts.
   * Caps at 200 requests, includes the full attempts thread per request.
   */
  async getRedeliveryRequests(tenantId: string, status?: string) {
    try {
      const where: Record<string, unknown> = { tenantId }
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
      const statsMap: Record<string, number> = {
        pending: 0,
        scheduled: 0,
        completed: 0,
        cancelled: 0,
      }
      for (const g of stats) statsMap[g.status] = g._count
      return { requests, statsMap }
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'getRedeliveryRequests',
        tenantId,
      })
      throw new Error('Failed to fetch redelivery requests')
    }
  },

  /**
   * Create a RedeliveryRequest + schedule the first attempt atomically —
   * a request can never exist without its opening attempt row.
   */
  async createRedeliveryRequest(input: {
    tenantId: string
    guideNumber: string
    customerPhone: string
    customerName: string
    originalAddress: string
    newAddress?: string | null
    reason: string
  }) {
    try {
      const { request, attempt } = await db.$transaction(async (tx) => {
        const created = await tx.redeliveryRequest.create({
          data: {
            tenantId: input.tenantId,
            guideNumber: String(input.guideNumber),
            customerPhone: String(input.customerPhone),
            customerName: String(input.customerName),
            originalAddress: String(input.originalAddress),
            newAddress: input.newAddress ? String(input.newAddress) : null,
            reason: String(input.reason),
            status: 'pending',
            attemptNumber: 1,
          },
        })
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
      log.info(
        {
          tenantId: input.tenantId,
          redeliveryId: request.id,
          guideNumber: request.guideNumber,
          attemptNumber: 1,
        },
        'redelivery request created',
      )
      return { request, attempt }
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'createRedeliveryRequest',
        tenantId: input.tenantId,
      })
      throw new Error('Failed to create redelivery request')
    }
  },

  /**
   * Lookup a RedeliveryRequest by id, scoped to a tenant. Includes the
   * latest attempt (ordered desc by attemptedAt) so the route can act on
   * it. Returns null when the request doesn't exist OR doesn't belong to
   * the caller's tenant.
   */
  async getRedeliveryRequestForUpdate(id: string, tenantId: string) {
    try {
      const existing = await db.redeliveryRequest.findUnique({
        where: { id },
        include: { attempts: { orderBy: { attemptedAt: 'desc' }, take: 1 } },
      })
      if (!existing || existing.tenantId !== tenantId) return null
      return existing
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'getRedeliveryRequestForUpdate',
        id,
        tenantId,
      })
      throw new Error('Failed to fetch redelivery request')
    }
  },

  /**
   * Confirm a new address on a redelivery request. Single-field update,
   * returns the updated request row.
   */
  async confirmRedeliveryAddress(id: string, newAddress: string) {
    try {
      return await db.redeliveryRequest.update({
        where: { id },
        data: { newAddress: String(newAddress) },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'confirmRedeliveryAddress',
        id,
      })
      throw new Error('Failed to confirm redelivery address')
    }
  },

  /**
   * Schedule a redelivery attempt atomically: flip request status to
   * `scheduled` + stamp scheduledAt + record the scheduling note on the
   * latest attempt. Returns the updated request.
   */
  async scheduleRedeliveryAttempt(
    id: string,
    when: Date,
    latestAttemptId: string | null,
    agentNote?: string,
  ) {
    try {
      const updated = await db.$transaction(async (tx) => {
        const r = await tx.redeliveryRequest.update({
          where: { id },
          data: { status: 'scheduled', scheduledAt: when },
        })
        if (latestAttemptId) {
          await tx.redeliveryAttempt.update({
            where: { id: latestAttemptId },
            data: {
              agentNote: agentNote
                ? String(agentNote)
                : `Programado para ${when.toISOString()}`,
            },
          })
        }
        return r
      })
      log.info(
        { redeliveryId: id, attemptId: latestAttemptId, scheduledAt: when.toISOString() },
        'redelivery attempt scheduled',
      )
      return updated
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'scheduleRedeliveryAttempt',
        id,
      })
      throw new Error('Failed to schedule redelivery attempt')
    }
  },

  /**
   * Stamp an agent note on the latest attempt (human-takeover flow).
   * Returns the updated attempt row.
   */
  async assignRedeliveryHuman(attemptId: string, agentNote: string) {
    try {
      return await db.redeliveryAttempt.update({
        where: { id: attemptId },
        data: { agentNote: String(agentNote) },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'assignRedeliveryHuman',
        attemptId,
      })
      throw new Error('Failed to assign redelivery to human')
    }
  },

  /**
   * Complete a redelivery atomically: mark request `completed` + mark
   * latest attempt `success` + record carrier response. Returns the
   * updated request.
   */
  async completeRedelivery(
    id: string,
    latestAttemptId: string | null,
    carrierResponse?: string | null,
  ) {
    try {
      const updated = await db.$transaction(async (tx) => {
        const r = await tx.redeliveryRequest.update({
          where: { id },
          data: { status: 'completed', completedAt: new Date() },
        })
        if (latestAttemptId) {
          await tx.redeliveryAttempt.update({
            where: { id: latestAttemptId },
            data: {
              status: 'success',
              carrierResponse: carrierResponse ? String(carrierResponse) : null,
            },
          })
        }
        return r
      })
      log.info(
        { redeliveryId: id, attemptId: latestAttemptId },
        'redelivery completed',
      )
      return updated
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'completeRedelivery',
        id,
      })
      throw new Error('Failed to complete redelivery')
    }
  },

  /**
   * Cancel a redelivery atomically: mark request `cancelled` + mark latest
   * attempt `failed` + record cancellation reason. Returns the updated
   * request.
   */
  async cancelRedelivery(
    id: string,
    latestAttemptId: string | null,
    reason?: string,
  ) {
    try {
      const updated = await db.$transaction(async (tx) => {
        const r = await tx.redeliveryRequest.update({
          where: { id },
          data: { status: 'cancelled' },
        })
        if (latestAttemptId) {
          await tx.redeliveryAttempt.update({
            where: { id: latestAttemptId },
            data: {
              status: 'failed',
              agentNote: reason ? String(reason) : 'Cancelled by agent',
            },
          })
        }
        return r
      })
      return updated
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'cancelRedelivery',
        id,
      })
      throw new Error('Failed to cancel redelivery')
    }
  },

  /**
   * Append a new attempt to a redelivery request atomically: create the
   * attempt row + bump the request's `attemptNumber` + flip request status
   * back to `pending`. Returns `{ request, attempt }`.
   */
  async addRedeliveryAttempt(id: string, nextAttemptNumber: number) {
    try {
      const { request, attempt } = await db.$transaction(async (tx) => {
        const a = await tx.redeliveryAttempt.create({
          data: {
            redeliveryId: id,
            attemptNumber: nextAttemptNumber,
            status: 'pending',
            attemptedAt: new Date(),
          },
        })
        const r = await tx.redeliveryRequest.update({
          where: { id },
          data: { attemptNumber: nextAttemptNumber, status: 'pending' },
        })
        return { request: r, attempt: a }
      })
      return { request, attempt }
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'addRedeliveryAttempt',
        id,
      })
      throw new Error('Failed to add redelivery attempt')
    }
  },

  /**
   * Update a case's direct fields — used by the PATCH /api/novedades/[id]
   * endpoint (free-form field updates with a tenant guard). Mirrors the
   * prior inline route logic: optional `resolvedAt` stamp when status flips
   * to `resolved`.
   */
  async updateCaseFields(
    id: string,
    data: Record<string, unknown>,
  ) {
    try {
      const updated = await db.novedadCase.update({
        where: { id },
        data,
      })
      log.info({ caseId: id, fields: Object.keys(data) }, 'Case fields updated')
      return updated
    } catch (err) {
      captureError(err as Error, {
        service: 'novedades',
        method: 'updateCaseFields',
        id,
      })
      throw new Error('Failed to update case fields')
    }
  },

  /**
   * Append a chat message (agent / carrier / customer / system) to a case.
   */
  async addMessage(
    caseId: string,
    payload: { authorName: string; authorRole?: string; body: string },
  ) {
    try {
      const role = ['agent', 'carrier', 'customer', 'system'].includes(payload.authorRole || '')
        ? payload.authorRole!
        : 'agent'
      const message = await db.novedadMessage.create({
        data: {
          caseId,
          authorName: payload.authorName,
          authorRole: role,
          body: String(payload.body),
        },
      })
      return message
    } catch (err) {
      captureError(err as Error, { service: 'novedades', method: 'addMessage', caseId })
      throw new Error('Failed to add message')
    }
  },
}

export type NovedadesService = typeof novedadesService
