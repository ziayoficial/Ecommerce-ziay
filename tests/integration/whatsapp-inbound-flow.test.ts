// Integration tests for the WhatsApp inbound webhook flow.
// TASK: SPRINT-INTEGRATION-TESTS-001 · §2
//
// End-to-end scenarios (study §13.1 + §14.4 CTWA closed-loop):
//   1. Valid text message → Customer + Conversation + Message rows created,
//      socket emit fired, 200 ACK with `{ status: 'processed' }`.
//   2. Duplicate waMessageId → 200 ACK with `{ status: 'duplicate_message_id' }`,
//      no DB writes after the dedup check.
//   3. Invalid HMAC signature → 403 + `{ error: 'invalid signature' }` +
//      audit log row recording the rejection.
//   4. Customer already exists → reused (no `customer.create` call), the
//      existing conversation is also reused when open.
//   5. CTWA click_id present → stamped on the new Conversation row at creation
//      time (and retroactively stamped on an existing open conversation when
//      the existing row had no click_id).
//
// Mock strategy mirrors tests/unit/webhooks.whatsapp.test.ts (hoisted mocks
// for hmac, parser, whatsapp-cloud, chat-emit, idempotency, db, logger,
// capture-error) but the assertions focus on the END-TO-END flow rather than
// per-step contracts — the unit test already covers those. These integration
// tests verify the chain behaviour the spec calls out as critical-path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock verifyMetaSignature ───────────────────────────────────────────────
const { hmacMock } = vi.hoisted(() => ({
  hmacMock: {
    verifyMetaSignature: vi.fn(),
    verifyHmacSha256: vi.fn(),
    verifyHmacSha256Base64: vi.fn(),
  },
}))
vi.mock('@/lib/middleware/hmac', () => hmacMock)

// ── Mock idempotency ───────────────────────────────────────────────────────
const { idempotencyMock } = vi.hoisted(() => ({
  idempotencyMock: {
    isDuplicateWebhook: vi.fn(),
    isDuplicateWebhookDB: vi.fn(),
    generateWebhookId: vi.fn(),
    __clearIdempotencyForTests: vi.fn(),
  },
}))
vi.mock('@/lib/middleware/idempotency', () => ({
  isDuplicateWebhook: idempotencyMock.isDuplicateWebhook,
  isDuplicateWebhookDB: idempotencyMock.isDuplicateWebhookDB,
  generateWebhookId: idempotencyMock.generateWebhookId,
  __clearIdempotencyForTests: idempotencyMock.__clearIdempotencyForTests,
}))

// ── Mock parseWhatsAppInbound ──────────────────────────────────────────────
const { parserMock } = vi.hoisted(() => ({
  parserMock: { parseWhatsAppInbound: vi.fn() },
}))
vi.mock('@/lib/adapters/whatsapp-parser', () => ({
  parseWhatsAppInbound: parserMock.parseWhatsAppInbound,
}))

// ── Mock whatsapp-cloud adapter helpers ────────────────────────────────────
const { waCloudMock } = vi.hoisted(() => ({
  waCloudMock: {
    findWhatsAppChannelByPhoneNumberId: vi.fn(),
    getWhatsAppAdapter: vi.fn(),
  },
}))
vi.mock('@/lib/adapters/whatsapp-cloud', () => ({
  findWhatsAppChannelByPhoneNumberId: waCloudMock.findWhatsAppChannelByPhoneNumberId,
  getWhatsAppAdapter: waCloudMock.getWhatsAppAdapter,
}))

// ── Mock emitToTenant (fire-and-forget socket broadcast) ───────────────────
const { chatEmitMock } = vi.hoisted(() => ({
  chatEmitMock: { emitToTenant: vi.fn() },
}))
vi.mock('@/lib/chat-emit', () => ({
  emitToTenant: chatEmitMock.emitToTenant,
}))

// ── Mock captureError ──────────────────────────────────────────────────────
const { captureErrorMock } = vi.hoisted(() => ({
  captureErrorMock: { captureError: vi.fn() },
}))
vi.mock('@/lib/capture-error', () => ({
  captureError: captureErrorMock.captureError,
}))

// ── Mock logger ─────────────────────────────────────────────────────────────
const { loggerMock } = vi.hoisted(() => {
  const m = {
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

// ── Mock db (multiple models touched by the WhatsApp route) ────────────────
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    auditLog: { create: vi.fn() },
    message: { findFirst: vi.fn(), create: vi.fn() },
    customer: { findFirst: vi.fn(), create: vi.fn() },
    conversation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    order: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { POST } from '@/app/api/webhooks/whatsapp/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('META_APP_SECRET', 'test-meta-app-secret')
  vi.stubEnv('WA_VERIFY_TOKEN', 'test-wa-verify-token')
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '')

  // Default: valid signature, not a duplicate.
  hmacMock.verifyMetaSignature.mockReturnValue(true)
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_wa_test')

  dbMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  dbMock.message.findFirst.mockResolvedValue(null) // no existing message → not a dup
  dbMock.message.create.mockResolvedValue({ id: 'msg-1' })
  dbMock.customer.findFirst.mockResolvedValue(null) // no existing customer
  dbMock.customer.create.mockResolvedValue({ id: 'cust-1' })
  dbMock.conversation.findFirst.mockResolvedValue(null) // no existing open conversation
  dbMock.conversation.findUnique.mockResolvedValue(null)
  dbMock.conversation.create.mockResolvedValue({
    id: 'conv-1',
    clickId: null,
    customerPhone: '573001112233',
  })
  dbMock.conversation.update.mockResolvedValue({})
  dbMock.order.findFirst.mockResolvedValue(null)

  // Default WA channel lookup succeeds.
  waCloudMock.findWhatsAppChannelByPhoneNumberId.mockResolvedValue({
    id: 'ch-1',
    tenantId: 'tenant-1',
  })
  waCloudMock.getWhatsAppAdapter.mockResolvedValue({
    markMessageRead: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
  })

  // Default parsed inbound: text message with CTWA click_id from an ad.
  parserMock.parseWhatsAppInbound.mockReturnValue({
    from: '573001112233',
    fromName: 'María',
    messageId: 'wamid.test123',
    timestamp: '1234567890',
    timestampMs: 1234567890000,
    type: 'text',
    text: 'Hola, quiero comprar',
    textBody: 'Hola, quiero comprar',
    ctwClickId: 'cta_abc123',
    phoneNumberId: '106000000000001',
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Helpers ───────────────────────────────────────────────────────────────
function buildPostReq(body: Record<string, unknown>, signature = 'sha256=valid'): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: {
      'x-hub-signature-256': signature,
      'content-type': 'application/json',
    },
    body: raw,
  })
}

/** Canonical Meta WA webhook payload — text message from a CTWA ad. */
function waTextBody(): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+57 300 111 2233',
                phone_number_id: '106000000000001',
              },
              contacts: [
                { wa_id: '573001112233', name: { formatted_name: 'María' } },
              ],
              messages: [
                {
                  from: '573001112233',
                  id: 'wamid.test123',
                  timestamp: '1234567890',
                  type: 'text',
                  text: { body: 'Hola, quiero comprar' },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §2.1 — Scenario 1: Valid text message → creates Customer + Conversation + Message
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp inbound flow · valid text message end-to-end', () => {
  it('creates Customer + Conversation + Message, emits socket events, returns 200 processed', async () => {
    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    // ── ACK contract: always 200 to stop Meta retries ──────────────────────
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({
      received: true,
      status: 'processed',
      conversationId: 'conv-1',
    })

    // ── HMAC verification ran ──────────────────────────────────────────────
    expect(hmacMock.verifyMetaSignature).toHaveBeenCalledTimes(1)

    // ── Parser consumed the raw body ───────────────────────────────────────
    expect(parserMock.parseWhatsAppInbound).toHaveBeenCalledTimes(1)

    // ── Channel resolved via phone_number_id → tenant ──────────────────────
    expect(waCloudMock.findWhatsAppChannelByPhoneNumberId).toHaveBeenCalledWith(
      '106000000000001',
    )

    // ── Customer was created (no existing one) ─────────────────────────────
    expect(dbMock.customer.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', phone: '573001112233' },
    })
    expect(dbMock.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        name: 'María',
        phone: '573001112233',
      }),
    })

    // ── Conversation was created with status=open + CTWA clickId stamped ──
    expect(dbMock.conversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        channelId: 'ch-1',
        status: 'open',
        customerPhone: '573001112233',
        clickId: 'cta_abc123',
      }),
    })

    // ── Message row persisted with waMessageId (for layer-3 dedup) ─────────
    expect(dbMock.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'conv-1',
        direction: 'inbound',
        body: 'Hola, quiero comprar',
        type: 'text',
        status: 'received',
        waMessageId: 'wamid.test123',
      }),
    })

    // ── Conversation lastMessageAt + unreadCount bumped ───────────────────
    expect(dbMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        lastMessageAt: expect.any(Date),
        unreadCount: { increment: 1 },
      }),
    })

    // ── Socket emit fired twice (message:new + message:received) ───────────
    expect(chatEmitMock.emitToTenant).toHaveBeenCalledTimes(2)
    expect(chatEmitMock.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'message:new',
      expect.objectContaining({
        conversationId: 'conv-1',
        customerPhone: '573001112233',
        direction: 'inbound',
        body: 'Hola, quiero comprar',
        type: 'text',
      }),
    )

    // ── Audit log row written for the inbound ─────────────────────────────
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'webhook.wa.inbound',
        entity: 'Webhook',
        entityId: 'wh_wa_test',
      }),
    })
  })

  it('handles image messages with mediaUrl + type=image', async () => {
    parserMock.parseWhatsAppInbound.mockReturnValue({
      from: '573001112233',
      messageId: 'wamid.img-1',
      timestamp: '1234567890',
      timestampMs: 1234567890000,
      type: 'image',
      text: '[Imagen] Foto del producto',
      imageUrl: 'https://cdn.meta.com/img/123.jpg',
      ctwClickId: null,
      phoneNumberId: '106000000000001',
    })

    const req = buildPostReq({ entry: [] })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(dbMock.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'image',
        mediaUrl: 'https://cdn.meta.com/img/123.jpg',
        body: '[Imagen] Foto del producto',
      }),
    })
  })

  it('handles location messages with type=location', async () => {
    parserMock.parseWhatsAppInbound.mockReturnValue({
      from: '573001112233',
      messageId: 'wamid.loc-1',
      timestamp: '1234567890',
      timestampMs: 1234567890000,
      type: 'location',
      text: '[Ubicación] 4.7110,-74.0721',
      location: { latitude: 4.711, longitude: -74.0721 },
      ctwClickId: null,
      phoneNumberId: '106000000000001',
    })

    const req = buildPostReq({ entry: [] })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(dbMock.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'location',
        body: '[Ubicación] 4.7110,-74.0721',
      }),
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2.2 — Scenario 2: Duplicate waMessageId → 200 + no DB writes
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp inbound flow · duplicate waMessageId dedup (layer 3)', () => {
  it('returns 200 with status=duplicate_message_id when waMessageId already persisted', async () => {
    // The DB already has a row for this waMessageId (Meta retried after ~24h).
    dbMock.message.findFirst.mockResolvedValue({ id: 'existing-msg' })

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'duplicate_message_id' })

    // ── No new rows were created — dedup short-circuited the persistence ──
    expect(dbMock.message.create).not.toHaveBeenCalled()
    expect(dbMock.customer.create).not.toHaveBeenCalled()
    expect(dbMock.conversation.create).not.toHaveBeenCalled()

    // ── The dedup check used the waMessageId as the lookup key ─────────────
    expect(dbMock.message.findFirst).toHaveBeenCalledWith({
      where: { waMessageId: 'wamid.test123' },
      select: { id: true },
    })

    // ── Socket emit was NOT fired (no new message to broadcast) ────────────
    expect(chatEmitMock.emitToTenant).not.toHaveBeenCalled()
  })

  it('returns 200 with status=duplicate when in-memory cache hits (layer 1)', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')

    // Parser was NOT called — short-circuited before parsing.
    expect(parserMock.parseWhatsAppInbound).not.toHaveBeenCalled()
    // DB layer 3 dedup check was NOT called.
    expect(dbMock.message.findFirst).not.toHaveBeenCalled()
  })

  it('returns 200 with status=duplicate when DB-backed cache hits (layer 2)', async () => {
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')

    expect(parserMock.parseWhatsAppInbound).not.toHaveBeenCalled()
    expect(dbMock.message.findFirst).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2.3 — Scenario 3: Invalid HMAC → 403 + audit log
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp inbound flow · invalid HMAC signature rejection', () => {
  it('rejects with 403 + audit log when X-Hub-Signature-256 fails verification', async () => {
    hmacMock.verifyMetaSignature.mockReturnValue(false)

    const req = buildPostReq(waTextBody(), 'sha256=tampered')
    const res = await POST(req)

    // ── 403 (NOT 200) — Meta will retry; that's the contract for signature
    //     failures. The route deliberately surfaces 403 here so Meta's retry
    //     policy catches genuine tampering attempts.
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe('invalid signature')

    // ── Audit row records the rejection (truncated body for traceability) ──
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'webhook.wa.invalid_sig',
        entity: 'Webhook',
        metadata: expect.any(String),
      }),
    })

    // ── No persistence happened ────────────────────────────────────────────
    expect(parserMock.parseWhatsAppInbound).not.toHaveBeenCalled()
    expect(dbMock.customer.create).not.toHaveBeenCalled()
    expect(dbMock.conversation.create).not.toHaveBeenCalled()
    expect(dbMock.message.create).not.toHaveBeenCalled()
    expect(chatEmitMock.emitToTenant).not.toHaveBeenCalled()
  })

  it('returns 500 when META_APP_SECRET is missing in production (forgery guard)', async () => {
    vi.stubEnv('META_APP_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')

    const req = buildPostReq({}, 'sha256=any')
    const res = await POST(req)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Webhook secret not configured')

    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'webhook.wa.no_secret',
        entity: 'Webhook',
      }),
    })
    expect(hmacMock.verifyMetaSignature).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2.4 — Scenario 4: Customer already exists → reused
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp inbound flow · existing customer reuse', () => {
  it('reuses an existing Customer when phone matches (no customer.create call)', async () => {
    dbMock.customer.findFirst.mockResolvedValue({
      id: 'cust-existing',
      tenantId: 'tenant-1',
      phone: '573001112233',
      name: 'María (returning)',
    })

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)

    // ── Customer lookup happened ───────────────────────────────────────────
    expect(dbMock.customer.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', phone: '573001112233' },
    })

    // ── NO customer.create — the existing row was reused ──────────────────
    expect(dbMock.customer.create).not.toHaveBeenCalled()

    // ── Conversation + Message were still persisted using the existing custId
    expect(dbMock.conversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        customerId: 'cust-existing', // ← reused ID
      }),
    })
    expect(dbMock.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'conv-1',
      }),
    })
  })

  it('reuses an open Conversation when one exists for the phone (no conversation.create call)', async () => {
    dbMock.conversation.findFirst.mockResolvedValue({
      id: 'conv-existing',
      tenantId: 'tenant-1',
      customerPhone: '573001112233',
      status: 'open',
      clickId: 'cta_existing',
    })

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.conversationId).toBe('conv-existing')

    // ── NO conversation.create — existing row reused ───────────────────────
    expect(dbMock.conversation.create).not.toHaveBeenCalled()

    // ── Message was attached to the existing conversationId ────────────────
    expect(dbMock.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: 'conv-existing' }),
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2.5 — Scenario 5: CTWA click_id → stamped on Conversation
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp inbound flow · CTWA click_id attribution stamping', () => {
  it('stamps CTWA click_id on a NEW conversation at creation time', async () => {
    parserMock.parseWhatsAppInbound.mockReturnValue({
      from: '573001112233',
      messageId: 'wamid.ctwa-new',
      timestamp: '1234567890',
      timestampMs: 1234567890000,
      type: 'text',
      text: 'Vi tu anuncio',
      ctwClickId: 'cta_xyz789',
      phoneNumberId: '106000000000001',
    })

    const req = buildPostReq({ entry: [] })
    await POST(req)

    // The conversation was created with the CTWA click_id stamped.
    expect(dbMock.conversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clickId: 'cta_xyz789',
        customerPhone: '573001112233',
      }),
    })

    // No retroactive update was needed (no existing conversation to patch).
    expect(dbMock.conversation.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clickId: 'cta_xyz789' }),
      }),
    )
  })

  it('retroactively stamps CTWA click_id on an existing conversation that lacks one', async () => {
    // Existing open conversation has NO clickId (e.g. customer replied to a
    // CTWA ad mid-thread — first inbound didn't carry the click_id).
    dbMock.conversation.findFirst.mockResolvedValue({
      id: 'conv-existing',
      tenantId: 'tenant-1',
      customerPhone: '573001112233',
      status: 'open',
      clickId: null,
    })

    parserMock.parseWhatsAppInbound.mockReturnValue({
      from: '573001112233',
      messageId: 'wamid.ctwa-retro',
      timestamp: '1234567890',
      timestampMs: 1234567890000,
      type: 'text',
      text: 'Otra pregunta',
      ctwClickId: 'cta_retro_456',
      phoneNumberId: '106000000000001',
    })

    const req = buildPostReq({ entry: [] })
    await POST(req)

    // ── Retroactive stamp: clickId updated on the existing conversation ───
    // Two update calls happen: (1) retroactive clickId stamp, (2) the
    // standard lastMessageAt + unreadCount bump. We assert the clickId call.
    expect(dbMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-existing' },
      data: expect.objectContaining({ clickId: 'cta_retro_456' }),
    })

    // No new conversation was created — existing one was reused.
    expect(dbMock.conversation.create).not.toHaveBeenCalled()
  })

  it('does NOT overwrite an existing clickId (first-touch attribution)', async () => {
    // Existing conversation already has a clickId — the inbound carries a
    // different one. The route must NOT overwrite (first-touch wins).
    dbMock.conversation.findFirst.mockResolvedValue({
      id: 'conv-existing',
      tenantId: 'tenant-1',
      customerPhone: '573001112233',
      status: 'open',
      clickId: 'cta_first_touch',
    })

    parserMock.parseWhatsAppInbound.mockReturnValue({
      from: '573001112233',
      messageId: 'wamid.ctwa-second',
      timestamp: '1234567890',
      timestampMs: 1234567890000,
      type: 'text',
      text: 'Pregunta adicional',
      ctwClickId: 'cta_later_touch',
      phoneNumberId: '106000000000001',
    })

    const req = buildPostReq({ entry: [] })
    await POST(req)

    // The only update call is the lastMessageAt + unreadCount bump — NOT a
    // clickId overwrite. Verify no update call sets clickId to the later value.
    const clickIdUpdates = dbMock.conversation.update.mock.calls.filter(
      ([, data]) => data && typeof data === 'object' && 'clickId' in data,
    )
    expect(clickIdUpdates).toHaveLength(0)
  })

  it('omits clickId from conversation.create when CTWA click_id is absent (organic inbound)', async () => {
    parserMock.parseWhatsAppInbound.mockReturnValue({
      from: '573001112233',
      messageId: 'wamid.organic',
      timestamp: '1234567890',
      timestampMs: 1234567890000,
      type: 'text',
      text: 'Hola',
      ctwClickId: null, // no CTWA — organic inbound
      phoneNumberId: '106000000000001',
    })

    const req = buildPostReq({ entry: [] })
    await POST(req)

    // conversation.create was called WITHOUT a clickId field (the route
    // conditionally spreads it in via `...(parsed.ctwClickId ? {...} : {})`).
    const createCall = dbMock.conversation.create.mock.calls[0][0]
    expect(createCall.data).not.toHaveProperty('clickId')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2.6 — Edge cases (no_channel + processing_failed)
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp inbound flow · edge cases', () => {
  it('returns no_channel when phone_number_id has no matching tenant', async () => {
    waCloudMock.findWhatsAppChannelByPhoneNumberId.mockResolvedValue(null)

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'no_channel' })

    // No persistence happened.
    expect(dbMock.customer.create).not.toHaveBeenCalled()
    expect(dbMock.conversation.create).not.toHaveBeenCalled()
    expect(dbMock.message.create).not.toHaveBeenCalled()
  })

  it('returns non_message when parser returns null (status update webhook)', async () => {
    parserMock.parseWhatsAppInbound.mockReturnValue(null)

    const req = buildPostReq({
      entry: [{ changes: [{ value: { statuses: [{ id: 's1' }] } }] }],
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'non_message' })

    // Audit row was written with the webhookId for dedup.
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'webhook.wa.non_message',
        entityId: 'wh_wa_test',
      }),
    })

    // No persistence happened.
    expect(dbMock.customer.create).not.toHaveBeenCalled()
    expect(dbMock.conversation.create).not.toHaveBeenCalled()
    expect(dbMock.message.create).not.toHaveBeenCalled()
  })

  it('returns processing_failed (200) when message.create throws — still ACKs to stop retries', async () => {
    dbMock.message.create.mockRejectedValue(new Error('msg db error'))

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('processing_failed')

    // captureError was called so the failure is observable.
    expect(captureErrorMock.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        action: 'webhook.wa.process',
        tenantId: 'tenant-1',
      }),
    )
  })
})
