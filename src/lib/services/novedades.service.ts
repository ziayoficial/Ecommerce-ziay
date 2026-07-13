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
