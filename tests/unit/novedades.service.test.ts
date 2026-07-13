// Unit tests for src/lib/services/novedades.service.ts
// TASK: FIX-5-TESTS-I18N-001
//
// Covers the 7 task-listed scenarios (mapped to actual method names where they
// differ from the task description):
//   listCases           → getCases
//   getCaseById         → getCaseById
//   createCase          → createCase  (creates Case + system NovedadMessage
//                        inside a $transaction — the audit trail is the
//                        system message itself, not an AuditLog row)
//   addMessage          → addMessage
//   updateStatus        → updateCase  (no AuditLog row; the case update itself
//                        is the audit record)
//   createRedeliveryRequest → createRedeliveryRequest (Case + first Attempt
//                        inside a $transaction; status=pending)
//   processRedelivery   → scheduleRedeliveryAttempt / completeRedelivery /
//                        cancelRedelivery (each updates a RedeliveryAttempt)

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    novedadCase: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    novedadEvidence: {
      create: vi.fn(),
    },
    novedadMessage: {
      create: vi.fn(),
    },
    redeliveryRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    redeliveryAttempt: {
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

const { loggerMock } = vi.hoisted(() => {
  const m: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
    child: () => unknown
  } = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => m,
  }
  return { loggerMock: m }
})
vi.mock('@/lib/logger', () => ({
  getLogger: () => loggerMock,
  logger: loggerMock,
  default: loggerMock,
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

import { novedadesService } from '@/lib/services/novedades.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getCases (task: listCases)
// ─────────────────────────────────────────────────────────────────────────────
describe('novedadesService.getCases', () => {
  it('returns paginated cases with relations + stats group-by', async () => {
    const cases = [
      {
        id: 'c-1',
        caseNumber: 'NV-2025-AAAAA',
        status: 'open',
        evidence: [{ id: 'ev-1' }],
        _count: { evidence: 1, messages: 0 },
      },
    ]
    const stats = [{ status: 'open', _count: 1 }]
    db.novedadCase.findMany.mockResolvedValue(cases)
    db.novedadCase.groupBy.mockResolvedValue(stats)

    const result = await novedadesService.getCases('ten-1', {
      status: 'open',
      limit: 20,
    })

    expect(result).toEqual({ cases, stats })
    expect(db.novedadCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'ten-1', status: 'open' }),
        orderBy: { createdAt: 'desc' },
        take: 21, // limit + 1 so the caller can detect hasMore
        include: {
          evidence: { take: 1, orderBy: { createdAt: 'desc' } },
          _count: { select: { evidence: true, messages: true } },
        },
      }),
    )
    expect(db.novedadCase.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { tenantId: 'ten-1' },
      _count: true,
    })
  })

  it('falls back to take=200 when limit is omitted (legacy behaviour)', async () => {
    db.novedadCase.findMany.mockResolvedValue([])
    db.novedadCase.groupBy.mockResolvedValue([])

    await novedadesService.getCases('ten-1')

    expect(db.novedadCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    )
  })

  it('uses cursor-based pagination when a cursor is provided', async () => {
    db.novedadCase.findMany.mockResolvedValue([])
    db.novedadCase.groupBy.mockResolvedValue([])

    await novedadesService.getCases('ten-1', { cursor: 'c-prev', limit: 10 })

    expect(db.novedadCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 11,
        skip: 1,
        cursor: { id: 'c-prev' },
      }),
    )
  })

  it('builds an OR clause across caseNumber / customerName / guideNumber / phone when q is provided', async () => {
    db.novedadCase.findMany.mockResolvedValue([])
    db.novedadCase.groupBy.mockResolvedValue([])

    await novedadesService.getCases('ten-1', { q: '123' })

    const call = db.novedadCase.findMany.mock.calls[0][0] as {
      where: { OR: unknown[] }
    }
    expect(call.where.OR).toEqual([
      { caseNumber: { contains: '123' } },
      { customerName: { contains: '123' } },
      { guideNumber: { contains: '123' } },
      { phone: { contains: '123' } },
    ])
  })

  it('ignores "all" sentinels for status / type / carrier (no filter applied)', async () => {
    db.novedadCase.findMany.mockResolvedValue([])
    db.novedadCase.groupBy.mockResolvedValue([])

    await novedadesService.getCases('ten-1', {
      status: 'all',
      type: 'all',
      carrier: 'all',
    })

    const call = db.novedadCase.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>
    }
    expect(call.where).not.toHaveProperty('status')
    expect(call.where).not.toHaveProperty('type')
    expect(call.where).not.toHaveProperty('carrierName')
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.novedadCase.findMany.mockRejectedValue(new Error('db'))
    await expect(novedadesService.getCases('ten-1')).rejects.toThrow(
      'Failed to fetch novedades cases',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getCaseById
// ─────────────────────────────────────────────────────────────────────────────
describe('novedadesService.getCaseById', () => {
  it('returns the case with messages + evidence (ordered asc / desc respectively)', async () => {
    const c = {
      id: 'c-1',
      messages: [{ id: 'm-1' }],
      evidence: [{ id: 'e-1' }],
    }
    db.novedadCase.findFirst.mockResolvedValue(c)

    const result = await novedadesService.getCaseById('c-1', 'ten-1')

    expect(result).toEqual(c)
    expect(db.novedadCase.findFirst).toHaveBeenCalledWith({
      where: { id: 'c-1', tenantId: 'ten-1' },
      include: {
        evidence: { orderBy: { createdAt: 'desc' } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })
  })

  it('returns null when the case does not exist', async () => {
    db.novedadCase.findFirst.mockResolvedValue(null)
    const result = await novedadesService.getCaseById('missing')
    expect(result).toBeNull()
  })

  it('omits tenantId filter when none is provided', async () => {
    db.novedadCase.findFirst.mockResolvedValue(null)

    await novedadesService.getCaseById('c-1')

    expect(db.novedadCase.findFirst).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      include: expect.any(Object),
    })
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.novedadCase.findFirst.mockRejectedValue(new Error('db'))
    await expect(novedadesService.getCaseById('c-1')).rejects.toThrow('Failed to fetch case')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createCase — atomic $transaction (Case + system NovedadMessage)
// ─────────────────────────────────────────────────────────────────────────────
describe('novedadesService.createCase', () => {
  it('creates a Case + an opening system message inside a $transaction', async () => {
    const created = { id: 'c-1', caseNumber: 'NV-CUSTOM-1', status: 'open' }
    db.novedadCase.create.mockResolvedValue(created)
    db.novedadMessage.create.mockResolvedValue({ id: 'm-1' })

    const result = await novedadesService.createCase({
      tenantId: 'ten-1',
      phone: '3001112222',
      customerName: 'Alice',
      type: 'paquete_perdido',
      description: 'Package lost',
      caseNumber: 'NV-CUSTOM-1',
      authorName: 'agent-1',
    })

    expect(result).toEqual(created)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.novedadCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        caseNumber: 'NV-CUSTOM-1',
        phone: '3001112222',
        customerName: 'Alice',
        type: 'paquete_perdido',
        description: 'Package lost',
        status: 'open',
        priority: 'normal',
      }),
    })
    // The opening system message is the audit trail.
    expect(db.novedadMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId: 'c-1',
        authorName: 'agent-1',
        authorRole: 'system',
        body: expect.stringContaining('NV-CUSTOM-1'),
      }),
    })
  })

  it('generates a random caseNumber when one is not provided', async () => {
    db.novedadCase.create.mockResolvedValue({ id: 'c-2', caseNumber: 'auto' })
    db.novedadMessage.create.mockResolvedValue({ id: 'm-2' })

    await novedadesService.createCase({
      tenantId: 'ten-1',
      phone: '300',
      customerName: 'Bob',
      type: 'retraso',
      description: 'delayed',
    })

    const call = db.novedadCase.create.mock.calls[0][0] as { data: { caseNumber: string } }
    expect(call.data.caseNumber).toMatch(/^NV-\d{4}-[A-Z0-9]{5}$/)
  })

  it('defaults priority to "normal" when omitted', async () => {
    db.novedadCase.create.mockResolvedValue({ id: 'c-3' })
    db.novedadMessage.create.mockResolvedValue({ id: 'm-3' })

    await novedadesService.createCase({
      tenantId: 'ten-1',
      phone: '300',
      customerName: 'C',
      type: 'otro',
      description: 'd',
    })

    expect(db.novedadCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ priority: 'normal' }),
    })
  })

  it('defaults authorName to "system" when omitted', async () => {
    db.novedadCase.create.mockResolvedValue({ id: 'c-4' })
    db.novedadMessage.create.mockResolvedValue({ id: 'm-4' })

    await novedadesService.createCase({
      tenantId: 'ten-1',
      phone: '300',
      customerName: 'D',
      type: 'otro',
      description: 'd',
    })

    expect(db.novedadMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ authorName: 'system', authorRole: 'system' }),
    })
  })

  it('throws a wrapped Error when the tx rejects', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('tx'))
    await expect(
      novedadesService.createCase({
        tenantId: 'ten-1',
        phone: '300',
        customerName: 'E',
        type: 'otro',
        description: 'd',
      }),
    ).rejects.toThrow('Failed to create case')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// addMessage
// ─────────────────────────────────────────────────────────────────────────────
describe('novedadesService.addMessage', () => {
  it('creates a NovedadMessage with the supplied role + body', async () => {
    const msg = { id: 'm-1', caseId: 'c-1', authorRole: 'agent', body: 'Hello' }
    db.novedadMessage.create.mockResolvedValue(msg)

    const result = await novedadesService.addMessage('c-1', {
      authorName: 'agent-1',
      authorRole: 'agent',
      body: 'Hello',
    })

    expect(result).toEqual(msg)
    expect(db.novedadMessage.create).toHaveBeenCalledWith({
      data: {
        caseId: 'c-1',
        authorName: 'agent-1',
        authorRole: 'agent',
        body: 'Hello',
      },
    })
  })

  it('defaults authorRole to "agent" when the supplied role is invalid', async () => {
    db.novedadMessage.create.mockResolvedValue({ id: 'm-2' })

    await novedadesService.addMessage('c-1', {
      authorName: 'x',
      authorRole: 'invalid-role',
      body: 'hi',
    })

    expect(db.novedadMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ authorRole: 'agent' }),
    })
  })

  it('defaults authorRole to "agent" when role is omitted', async () => {
    db.novedadMessage.create.mockResolvedValue({ id: 'm-3' })

    await novedadesService.addMessage('c-1', {
      authorName: 'x',
      body: 'hi',
    })

    expect(db.novedadMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ authorRole: 'agent' }),
    })
  })

  it('accepts each valid authorRole (agent | carrier | customer | system)', async () => {
    db.novedadMessage.create.mockResolvedValue({ id: 'm-x' })

    for (const role of ['agent', 'carrier', 'customer', 'system']) {
      await novedadesService.addMessage('c-1', {
        authorName: 'x',
        authorRole: role,
        body: 'hi',
      })
    }

    const roles = db.novedadMessage.create.mock.calls.map(
      (c) => (c[0] as { data: { authorRole: string } }).data.authorRole,
    )
    expect(roles).toEqual(['agent', 'carrier', 'customer', 'system'])
  })

  it('throws a wrapped Error when create rejects', async () => {
    db.novedadMessage.create.mockRejectedValue(new Error('db'))
    await expect(
      novedadesService.addMessage('c-1', { authorName: 'x', body: 'hi' }),
    ).rejects.toThrow('Failed to add message')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateCase (task: updateStatus)
// ─────────────────────────────────────────────────────────────────────────────
describe('novedadesService.updateCase', () => {
  it('patches Case.status (and only the supplied fields)', async () => {
    const updated = { id: 'c-1', status: 'resolved' }
    db.novedadCase.update.mockResolvedValue(updated)

    const result = await novedadesService.updateCase('c-1', 'ten-1', {
      status: 'resolved',
    })

    expect(result).toEqual(updated)
    expect(db.novedadCase.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'resolved' },
    })
  })

  it('patches multiple fields (priority + assignedTo + resolution + resolvedAt)', async () => {
    db.novedadCase.update.mockResolvedValue({ id: 'c-1' })
    const resolvedAt = new Date('2025-01-01')

    await novedadesService.updateCase('c-1', 'ten-1', {
      priority: 'high',
      assignedTo: 'agent-2',
      resolution: 'Reenvío exitoso',
      resolvedAt,
    })

    expect(db.novedadCase.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: {
        priority: 'high',
        assignedTo: 'agent-2',
        resolution: 'Reenvío exitoso',
        resolvedAt,
      },
    })
  })

  it('supports setting resolvedAt to null (clears the resolved timestamp)', async () => {
    db.novedadCase.update.mockResolvedValue({ id: 'c-1' })

    await novedadesService.updateCase('c-1', 'ten-1', {
      resolvedAt: null,
    })

    expect(db.novedadCase.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { resolvedAt: null },
    })
  })

  it('omits undefined fields from the patch payload', async () => {
    db.novedadCase.update.mockResolvedValue({ id: 'c-1' })

    // Only status is supplied — other fields are undefined and must NOT
    // appear in the update payload.
    await novedadesService.updateCase('c-1', 'ten-1', {
      status: 'closed',
    })

    expect(db.novedadCase.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'closed' },
    })
  })

  it('throws a wrapped Error when update rejects', async () => {
    db.novedadCase.update.mockRejectedValue(new Error('db'))
    await expect(
      novedadesService.updateCase('c-1', 'ten-1', { status: 'closed' }),
    ).rejects.toThrow('Failed to update case')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createRedeliveryRequest — atomic $transaction
// ─────────────────────────────────────────────────────────────────────────────
describe('novedadesService.createRedeliveryRequest', () => {
  it('creates a RedeliveryRequest(status=pending, attemptNumber=1) + the first RedeliveryAttempt(pending) atomically', async () => {
    const request = { id: 'rd-1', status: 'pending', attemptNumber: 1 }
    const attempt = { id: 'att-1', status: 'pending', attemptNumber: 1 }
    db.redeliveryRequest.create.mockResolvedValue(request)
    db.redeliveryAttempt.create.mockResolvedValue(attempt)

    const result = await novedadesService.createRedeliveryRequest({
      tenantId: 'ten-1',
      guideNumber: 'GUIDE-1',
      customerPhone: '3001112222',
      customerName: 'Alice',
      originalAddress: 'Cra 1 #2-3',
      newAddress: 'Cra 4 #5-6',
      reason: 'direccion_incorrecta',
    })

    expect(result).toEqual({ request, attempt })
    expect(db.$transaction).toHaveBeenCalledTimes(1)

    expect(db.redeliveryRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        guideNumber: 'GUIDE-1',
        customerPhone: '3001112222',
        customerName: 'Alice',
        originalAddress: 'Cra 1 #2-3',
        newAddress: 'Cra 4 #5-6',
        reason: 'direccion_incorrecta',
        status: 'pending',
        attemptNumber: 1,
      }),
    })
    expect(db.redeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        redeliveryId: 'rd-1',
        attemptNumber: 1,
        status: 'pending',
        attemptedAt: expect.any(Date),
      }),
    })
  })

  it('defaults newAddress to null when omitted', async () => {
    db.redeliveryRequest.create.mockResolvedValue({ id: 'rd-2' })
    db.redeliveryAttempt.create.mockResolvedValue({ id: 'att-2' })

    await novedadesService.createRedeliveryRequest({
      tenantId: 'ten-1',
      guideNumber: 'G',
      customerPhone: '300',
      customerName: 'B',
      originalAddress: 'addr',
      reason: 'r',
    })

    expect(db.redeliveryRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ newAddress: null }),
    })
  })

  it('throws a wrapped Error when the tx rejects', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('tx'))
    await expect(
      novedadesService.createRedeliveryRequest({
        tenantId: 'ten-1',
        guideNumber: 'G',
        customerPhone: '300',
        customerName: 'B',
        originalAddress: 'addr',
        reason: 'r',
      }),
    ).rejects.toThrow('Failed to create redelivery request')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// processRedelivery — covers scheduleRedeliveryAttempt / completeRedelivery /
// cancelRedelivery (each updates a RedeliveryAttempt status atomically).
// ─────────────────────────────────────────────────────────────────────────────
describe('novedadesService.processRedelivery (schedule / complete / cancel)', () => {
  it('scheduleRedeliveryAttempt: flips request→scheduled + stamps attempt agentNote', async () => {
    const when = new Date('2025-02-03T10:00:00Z')
    db.redeliveryRequest.update.mockResolvedValue({ id: 'rd-1', status: 'scheduled' })
    db.redeliveryAttempt.update.mockResolvedValue({ id: 'att-1' })

    const result = await novedadesService.scheduleRedeliveryAttempt(
      'rd-1',
      when,
      'att-1',
      'Programado por la mañana',
    )

    expect(result).toEqual({ id: 'rd-1', status: 'scheduled' })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.redeliveryRequest.update).toHaveBeenCalledWith({
      where: { id: 'rd-1' },
      data: { status: 'scheduled', scheduledAt: when },
    })
    expect(db.redeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: { agentNote: 'Programado por la mañana' },
    })
  })

  it('scheduleRedeliveryAttempt: skips the attempt update when latestAttemptId is null', async () => {
    db.redeliveryRequest.update.mockResolvedValue({ id: 'rd-2', status: 'scheduled' })

    await novedadesService.scheduleRedeliveryAttempt('rd-2', new Date(), null)

    expect(db.redeliveryAttempt.update).not.toHaveBeenCalled()
  })

  it('completeRedelivery: flips request→completed + attempt→success + records carrierResponse', async () => {
    db.redeliveryRequest.update.mockResolvedValue({ id: 'rd-1', status: 'completed' })
    db.redeliveryAttempt.update.mockResolvedValue({ id: 'att-1', status: 'success' })

    const result = await novedadesService.completeRedelivery('rd-1', 'att-1', 'Delivered')

    expect(result).toEqual({ id: 'rd-1', status: 'completed' })
    expect(db.redeliveryRequest.update).toHaveBeenCalledWith({
      where: { id: 'rd-1' },
      data: expect.objectContaining({
        status: 'completed',
        completedAt: expect.any(Date),
      }),
    })
    expect(db.redeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: { status: 'success', carrierResponse: 'Delivered' },
    })
  })

  it('completeRedelivery: passes carrierResponse=null when not provided', async () => {
    db.redeliveryRequest.update.mockResolvedValue({ id: 'rd-1', status: 'completed' })

    await novedadesService.completeRedelivery('rd-1', 'att-1')

    expect(db.redeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: { status: 'success', carrierResponse: null },
    })
  })

  it('cancelRedelivery: flips request→cancelled + attempt→failed + records reason as agentNote', async () => {
    db.redeliveryRequest.update.mockResolvedValue({ id: 'rd-1', status: 'cancelled' })
    db.redeliveryAttempt.update.mockResolvedValue({ id: 'att-1', status: 'failed' })

    const result = await novedadesService.cancelRedelivery('rd-1', 'att-1', 'Customer moved')

    expect(result).toEqual({ id: 'rd-1', status: 'cancelled' })
    expect(db.redeliveryRequest.update).toHaveBeenCalledWith({
      where: { id: 'rd-1' },
      data: { status: 'cancelled' },
    })
    expect(db.redeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: { status: 'failed', agentNote: 'Customer moved' },
    })
  })

  it('cancelRedelivery: defaults agentNote to "Cancelled by agent" when no reason provided', async () => {
    db.redeliveryRequest.update.mockResolvedValue({ id: 'rd-1', status: 'cancelled' })

    await novedadesService.cancelRedelivery('rd-1', 'att-1')

    expect(db.redeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: { status: 'failed', agentNote: 'Cancelled by agent' },
    })
  })
})
