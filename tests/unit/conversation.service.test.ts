// Unit tests for src/lib/services/conversation.service.ts
// TASK: SPRINT-AUDITLOG-TESTS-001
//
// Covers the 4 task-listed methods:
//   - getConversations     → cursor pagination + filters (status/channel/q)
//   - getConversationById  → single conversation with messages + recent orders
//   - sendMessage          → creates Message + updates conversation.lastMessageAt
//                            + delivers via WhatsApp adapter (when applicable)
//                            + records TTR via recordFirstReply (first outbound)
//   - updateStatus         → updates status / priority / assigneeId
//
// Mock pattern mirrors wallet.service.test.ts — vi.hoisted + deep vi.fn mock
// for every db delegate + the WhatsApp adapter + TTR helper the service touches.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    conversation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    message: {
      create: vi.fn(),
      update: vi.fn(),
    },
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Stub logger so tests don't print pino output. captureError calls logger
// internally — silence it.
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

// Mock the WhatsApp Cloud adapter — `getWhatsAppAdapter(tenantId)` resolves
// with an object exposing `sendText(phone, body)` → `{ messageId }` (or null
// when no channel is configured). Tests override `waAdapterMock` per case.
const { getWhatsAppAdapterMock, waAdapterMock } = vi.hoisted(() => {
  const adapter = {
    sendText: vi.fn(),
  }
  return {
    getWhatsAppAdapterMock: vi.fn(),
    waAdapterMock: adapter,
  }
})
vi.mock('@/lib/adapters/whatsapp-cloud', () => ({
  getWhatsAppAdapter: getWhatsAppAdapterMock,
}))

// Mock recordFirstReply — best-effort TTR stamping. Service swallows errors
// from it (`.catch(() => {})`), so we just need it to be a vi.fn.
const { recordFirstReplyMock } = vi.hoisted(() => ({
  recordFirstReplyMock: vi.fn(),
}))
vi.mock('@/lib/metrics/ttr', () => ({
  recordFirstReply: recordFirstReplyMock,
}))

import { conversationService } from '@/lib/services/conversation.service'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no adapter configured (no WA delivery attempted). Tests that
  // need WA delivery override `getWhatsAppAdapterMock.mockResolvedValueOnce(...)`.
  getWhatsAppAdapterMock.mockResolvedValue(null)
  recordFirstReplyMock.mockResolvedValue(undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// getConversations — cursor pagination + filters
// ─────────────────────────────────────────────────────────────────────────────
describe('conversationService.getConversations', () => {
  it('returns conversations ordered by lastMessageAt desc with the latest message hydrated', async () => {
    const convs = [
      {
        id: 'c-1',
        customer: { id: 'cu-1', name: 'Jane' },
        channel: { id: 'ch-1', type: 'whatsapp' },
        assignee: null,
        messages: [{ id: 'm-1', body: 'Hi' }],
      },
    ]
    db.conversation.findMany.mockResolvedValue(convs)

    const result = await conversationService.getConversations('ten-1')

    expect(result).toEqual(convs)
    expect(db.conversation.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      include: {
        customer: true,
        channel: true,
        assignee: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    })
  })

  it('applies status / channel filters when value is not "all"', async () => {
    db.conversation.findMany.mockResolvedValue([])

    await conversationService.getConversations('ten-1', {
      status: 'open',
      channel: 'ch-1',
    })

    expect(db.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'ten-1', status: 'open', channelId: 'ch-1' },
      }),
    )
  })

  it('ignores status / channel filters when value is "all"', async () => {
    db.conversation.findMany.mockResolvedValue([])

    await conversationService.getConversations('ten-1', {
      status: 'all',
      channel: 'all',
    })

    expect(db.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'ten-1' } }),
    )
  })

  it('uses a customer.name contains filter when q is provided', async () => {
    db.conversation.findMany.mockResolvedValue([])

    await conversationService.getConversations('ten-1', { q: 'Jane' })

    expect(db.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'ten-1', customer: { name: { contains: 'Jane' } } },
      }),
    )
  })

  it('uses cursor + skip:1 when cursor is provided', async () => {
    db.conversation.findMany.mockResolvedValue([])

    await conversationService.getConversations('ten-1', { cursor: 'c-99' })

    expect(db.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'c-99' },
        skip: 1,
      }),
    )
  })

  it('requests limit + 1 rows when limit is provided (so caller can detect hasMore)', async () => {
    db.conversation.findMany.mockResolvedValue([])

    await conversationService.getConversations('ten-1', { limit: 15 })

    expect(db.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 16 }),
    )
  })

  it('omits tenantId from the where clause when tenantId is undefined', async () => {
    db.conversation.findMany.mockResolvedValue([])

    await conversationService.getConversations(undefined)

    expect(db.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.conversation.findMany.mockRejectedValue(new Error('db down'))

    await expect(conversationService.getConversations('ten-1')).rejects.toThrow(
      'Failed to fetch conversations',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getConversationById — single conversation + clear unread badge
// ─────────────────────────────────────────────────────────────────────────────
describe('conversationService.getConversationById', () => {
  it('returns the conversation with messages (asc) + recent 5 orders (desc, with items)', async () => {
    const conv = {
      id: 'c-1',
      unreadCount: 0,
      customer: { id: 'cu-1' },
      channel: { id: 'ch-1' },
      assignee: null,
      messages: [{ id: 'm-1' }],
      orders: [{ id: 'o-1', items: [] }],
    }
    db.conversation.findFirst.mockResolvedValue(conv)

    const result = await conversationService.getConversationById('c-1', 'ten-1')

    expect(result).toEqual(conv)
    expect(db.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'c-1', tenantId: 'ten-1' },
      include: {
        customer: true,
        channel: true,
        assignee: true,
        messages: { orderBy: { createdAt: 'asc' } },
        orders: {
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    })
  })

  it('clears the unreadCount badge when the conversation has unreadCount > 0', async () => {
    db.conversation.findFirst.mockResolvedValue({
      id: 'c-1',
      unreadCount: 5,
    })
    db.conversation.update.mockResolvedValue({ id: 'c-1', unreadCount: 0 })

    await conversationService.getConversationById('c-1', 'ten-1')

    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { unreadCount: 0 },
    })
  })

  it('does NOT call conversation.update when unreadCount is 0 (no badge to clear)', async () => {
    db.conversation.findFirst.mockResolvedValue({
      id: 'c-1',
      unreadCount: 0,
    })

    await conversationService.getConversationById('c-1', 'ten-1')

    expect(db.conversation.update).not.toHaveBeenCalled()
  })

  it('returns null when the conversation does not exist', async () => {
    db.conversation.findFirst.mockResolvedValue(null)

    const result = await conversationService.getConversationById('nope')
    expect(result).toBeNull()
  })

  it('still returns the conversation even if the unread-clear update fails (best-effort)', async () => {
    const conv = { id: 'c-1', unreadCount: 3 }
    db.conversation.findFirst.mockResolvedValue(conv)
    db.conversation.update.mockRejectedValue(new Error('write error'))

    const result = await conversationService.getConversationById('c-1', 'ten-1')

    // The clear failure should not propagate — the user still sees the conv.
    expect(result).toEqual(conv)
  })

  it('throws a wrapped Error when the underlying findFirst rejects', async () => {
    db.conversation.findFirst.mockRejectedValue(new Error('db down'))

    await expect(
      conversationService.getConversationById('c-1'),
    ).rejects.toThrow('Failed to fetch conversation')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sendMessage — create Message + update lastMessageAt + (optional) WA delivery
// ─────────────────────────────────────────────────────────────────────────────
describe('conversationService.sendMessage', () => {
  const baseConv = {
    id: 'c-1',
    tenantId: 'ten-1',
    channelId: 'ch-1',
    customerPhone: '573001112233',
    customer: { phone: '573001112233' },
    channel: { type: 'whatsapp' },
  }

  it('persists the outbound Message + updates conversation.lastMessageAt + unreadCount=0', async () => {
    db.conversation.findUnique.mockResolvedValue(baseConv)
    const createdMsg = { id: 'm-1', direction: 'outbound', body: 'Hola!' }
    db.message.create.mockResolvedValue(createdMsg)
    db.conversation.update.mockResolvedValue({ id: 'c-1' })

    const result = await conversationService.sendMessage({
      tenantId: 'ten-1',
      conversationId: 'c-1',
      body: 'Hola!',
    })

    expect(result).toEqual(createdMsg)
    expect(db.message.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        conversationId: 'c-1',
        direction: 'outbound',
        body: 'Hola!',
        type: 'text',
        mediaUrl: null,
        status: 'sent',
        aiSuggested: false,
        aiConfidence: null,
      },
    })
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { lastMessageAt: expect.any(Date), unreadCount: 0 },
    })
  })

  it('records TTR via recordFirstReply (outbound only)', async () => {
    db.conversation.findUnique.mockResolvedValue(baseConv)
    db.message.create.mockResolvedValue({ id: 'm-1' })

    await conversationService.sendMessage({
      tenantId: 'ten-1',
      conversationId: 'c-1',
      body: 'x',
    })

    expect(recordFirstReplyMock).toHaveBeenCalledTimes(1)
    expect(recordFirstReplyMock).toHaveBeenCalledWith('c-1')
  })

  it('does NOT record TTR for inbound messages (direction=inbound)', async () => {
    db.conversation.findUnique.mockResolvedValue(baseConv)
    db.message.create.mockResolvedValue({ id: 'm-1' })

    await conversationService.sendMessage({
      tenantId: 'ten-1',
      conversationId: 'c-1',
      body: 'x',
      direction: 'inbound',
    })

    expect(recordFirstReplyMock).not.toHaveBeenCalled()
  })

  it('delivers via WhatsApp adapter when channel.type=whatsapp + adapter is configured + recipient has phone', async () => {
    db.conversation.findUnique.mockResolvedValue(baseConv)
    db.message.create.mockResolvedValue({ id: 'm-1' })
    waAdapterMock.sendText.mockResolvedValue({ messageId: 'wa-msg-1' })
    getWhatsAppAdapterMock.mockResolvedValueOnce(waAdapterMock)

    await conversationService.sendMessage({
      tenantId: 'ten-1',
      conversationId: 'c-1',
      body: 'Hola!',
    })

    expect(getWhatsAppAdapterMock).toHaveBeenCalledWith('ten-1')
    expect(waAdapterMock.sendText).toHaveBeenCalledWith('573001112233', 'Hola!')
    // The local Message row's waMessageId should be stamped with Meta's echo
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { waMessageId: 'wa-msg-1' },
    })
  })

  it('skips WA delivery when channel.type is NOT whatsapp (e.g. messenger)', async () => {
    db.conversation.findUnique.mockResolvedValue({
      ...baseConv,
      channel: { type: 'messenger' },
    })
    db.message.create.mockResolvedValue({ id: 'm-1' })

    await conversationService.sendMessage({
      tenantId: 'ten-1',
      conversationId: 'c-1',
      body: 'x',
    })

    expect(getWhatsAppAdapterMock).not.toHaveBeenCalled()
    expect(waAdapterMock.sendText).not.toHaveBeenCalled()
  })

  it('skips WA delivery when adapter is null (no WA channel configured for tenant)', async () => {
    db.conversation.findUnique.mockResolvedValue(baseConv)
    db.message.create.mockResolvedValue({ id: 'm-1' })
    getWhatsAppAdapterMock.mockResolvedValueOnce(null)

    await conversationService.sendMessage({
      tenantId: 'ten-1',
      conversationId: 'c-1',
      body: 'x',
    })

    expect(waAdapterMock.sendText).not.toHaveBeenCalled()
    // Message row is still persisted (with no waMessageId stamp)
    expect(db.message.create).toHaveBeenCalled()
  })

  it('marks the local Message as status=failed when WA delivery throws (non-fatal)', async () => {
    db.conversation.findUnique.mockResolvedValue(baseConv)
    db.message.create.mockResolvedValue({ id: 'm-1' })
    // The WA-delivery catch handler calls `db.message.update(...).catch(() => {})`
    // — `db.message.update` MUST return a Promise (vi.fn default returns undefined,
    // which would throw "Cannot read .catch of undefined" and propagate to the
    // outer try/catch, rethrowing as 'Failed to send message'). Mock it to a
    // resolved Promise so the best-effort chain stays inside the WA catch.
    db.message.update.mockResolvedValue({ id: 'm-1', status: 'failed' })
    waAdapterMock.sendText.mockRejectedValue(new Error('meta 500'))
    getWhatsAppAdapterMock.mockResolvedValueOnce(waAdapterMock)

    // The service should NOT rethrow — the local Message row is still the
    // source of truth for the agent's inbox.
    const result = await conversationService.sendMessage({
      tenantId: 'ten-1',
      conversationId: 'c-1',
      body: 'x',
    })

    expect(result).toEqual({ id: 'm-1' })
    // The local message was marked as failed (best-effort — .catch(() => {}))
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { status: 'failed' },
    })
  })

  it('throws when the conversation does not exist (findUnique returns null)', async () => {
    db.conversation.findUnique.mockResolvedValue(null)

    await expect(
      conversationService.sendMessage({
        tenantId: 'ten-1',
        conversationId: 'c-missing',
        body: 'x',
      }),
    ).rejects.toThrow('Failed to send message')
  })

  it('throws a wrapped Error when the message.create rejects', async () => {
    db.conversation.findUnique.mockResolvedValue(baseConv)
    db.message.create.mockRejectedValue(new Error('db down'))

    await expect(
      conversationService.sendMessage({
        tenantId: 'ten-1',
        conversationId: 'c-1',
        body: 'x',
      }),
    ).rejects.toThrow('Failed to send message')
  })

  it('honors aiSuggested + aiConfidence when supplied', async () => {
    db.conversation.findUnique.mockResolvedValue(baseConv)
    db.message.create.mockResolvedValue({ id: 'm-1' })

    await conversationService.sendMessage({
      tenantId: 'ten-1',
      conversationId: 'c-1',
      body: 'AI reply',
      aiSuggested: true,
      aiConfidence: 0.92,
    })

    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aiSuggested: true,
        aiConfidence: 0.92,
      }),
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateStatus — patch status / priority / assigneeId
// ─────────────────────────────────────────────────────────────────────────────
describe('conversationService.updateStatus', () => {
  it('updates status when patch.status is provided', async () => {
    // Sprint 11A clear-on-close: cuando status='closed', el servicio hace un
    // findUnique para detectar si hay pipelineMemory poblada; si la hay,
    // añade `pipelineMemory: null` al update para limpiarla. El mock debe
    // devolver una conversación CON memoria para que el guard dispare y el
    // assert del update incluya `pipelineMemory: null`.
    const updated = { id: 'c-1', status: 'closed' }
    vi.mocked(db.conversation.findUnique).mockResolvedValue({
      id: 'c-1',
      pipelineMemory: '[]', // has memory → will be cleared on close
    } as any)
    db.conversation.update.mockResolvedValue(updated)

    const result = await conversationService.updateStatus('c-1', {
      status: 'closed',
    })

    expect(result).toEqual(updated)
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'closed', pipelineMemory: null },
    })
  })

  it('updates priority when patch.priority is provided', async () => {
    db.conversation.update.mockResolvedValue({ id: 'c-1' })

    await conversationService.updateStatus('c-1', { priority: 'urgent' })

    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { priority: 'urgent' },
    })
  })

  it('updates assigneeId when patch.assigneeId is provided (including null for unassign)', async () => {
    db.conversation.update.mockResolvedValue({ id: 'c-1' })

    await conversationService.updateStatus('c-1', { assigneeId: null })

    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { assigneeId: null },
    })
  })

  it('omits assigneeId from the data when patch.assigneeId is undefined (not supplied)', async () => {
    db.conversation.update.mockResolvedValue({ id: 'c-1' })

    await conversationService.updateStatus('c-1', { status: 'open' })

    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'open' }, // no assigneeId key
    })
  })

  it('updates all three fields together when provided', async () => {
    db.conversation.update.mockResolvedValue({ id: 'c-1' })

    await conversationService.updateStatus('c-1', {
      status: 'pending',
      priority: 'normal',
      assigneeId: 'user-1',
    })

    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'pending', priority: 'normal', assigneeId: 'user-1' },
    })
  })

  it('throws a wrapped Error when the underlying db rejects', async () => {
    db.conversation.update.mockRejectedValue(new Error('db down'))

    await expect(
      conversationService.updateStatus('c-1', { status: 'closed' }),
    ).rejects.toThrow('Failed to update conversation')
  })

  // ── Sprint 15C edge cases (SPRINT-TESTS-COMPLETE-001) ─────────────────
  // The pipelineMemory clearing on close has 3 sub-branches:
  //   1. pipelineMemory IS populated → clear it (covered above)
  //   2. pipelineMemory is null/empty → DON'T include the field in the
  //      update (avoids unnecessary writes — most conversations never
  //      had orchestrator memory populated)
  //   3. findUnique itself rejects → best-effort: skip the clear + still
  //      run the status update (don't block the close on a read error)
  it('does NOT include pipelineMemory in the update when status=closed but pipelineMemory is already null', async () => {
    vi.mocked(db.conversation.findUnique).mockResolvedValue({
      id: 'c-1',
      pipelineMemory: null,
    } as any)
    db.conversation.update.mockResolvedValue({ id: 'c-1', status: 'closed' })

    await conversationService.updateStatus('c-1', { status: 'closed' })

    // The findUnique read happened (we needed to check).
    expect(db.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      select: { pipelineMemory: true },
    })
    // The update payload does NOT include `pipelineMemory` — the field is
    // conditionally spread only when the prior value was truthy.
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'closed' },
    })
  })

  it('does NOT include pipelineMemory in the update when status=closed and the findUnique returns null (conversation missing)', async () => {
    // Edge case: the findUnique for the pipelineMemory check returns null
    // (conversation deleted between the caller's auth check and our read).
    // The service must NOT crash — `existing?.pipelineMemory` short-circuits
    // and the update still runs (which will itself throw P2025, but that's
    // the caller's problem to handle as 'Failed to update conversation').
    vi.mocked(db.conversation.findUnique).mockResolvedValue(null)
    db.conversation.update.mockResolvedValue({ id: 'c-1', status: 'closed' })

    await conversationService.updateStatus('c-1', { status: 'closed' })

    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'closed' },
    })
  })

  it('still runs the status=closed update when the pipelineMemory findUnique rejects (best-effort)', async () => {
    // The findUnique is wrapped in a try/catch — failures are swallowed so
    // the close itself isn't blocked by a transient read error. The update
    // proceeds without `pipelineMemory: null` in the payload.
    vi.mocked(db.conversation.findUnique).mockRejectedValue(new Error('read error'))
    db.conversation.update.mockResolvedValue({ id: 'c-1', status: 'closed' })

    const result = await conversationService.updateStatus('c-1', { status: 'closed' })

    expect(result).toEqual({ id: 'c-1', status: 'closed' })
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'closed' },
    })
  })

  it('does NOT call findUnique when status is not closed (no pipelineMemory check needed)', async () => {
    db.conversation.update.mockResolvedValue({ id: 'c-1', status: 'open' })

    await conversationService.updateStatus('c-1', { status: 'open' })

    expect(db.conversation.findUnique).not.toHaveBeenCalled()
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'open' },
    })
  })
})
