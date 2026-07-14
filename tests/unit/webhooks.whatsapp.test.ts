// Unit tests for src/app/api/webhooks/whatsapp/route.ts
// TASK: SPRINT-WEBHOOK-TESTS-EVAL-001
//
// Contract tests for the WhatsApp Cloud API webhook
// (SPRINT-WHATSAPP-FUNCTIONAL-001, study §13.1 + §14.4 CTWA + closed-loop CAPI):
//
// GET handler (verification handshake):
//   - returns 200 with `hub.challenge` literal when `hub.verify_token` matches
//   - returns 403 when token is wrong or `hub.mode != subscribe`
//
// POST handler (inbound messages + status):
//   - rejects invalid `X-Hub-Signature-256` HMAC with 403
//   - returns 500 when `META_APP_SECRET` is missing in production
//   - dev mode fallback: accepts any non-empty signature
//   - accepts valid signatures + parses inbound via `parseWhatsAppInbound`
//   - returns `non_message` for status updates / template callbacks (parser
//     returns null)
//   - returns `no_channel` when no tenant matches the `phone_number_id`
//   - resolves / creates Customer + Conversation + Message rows
//   - stamps CTWA `click_id` on the conversation for closed-loop attribution
//   - emits `message:new` + `message:received` socket events (fire-and-forget)
//   - layer-3 dedup via `waMessageId` (Meta can retry the same message ~24h)
//   - handles adapter throws gracefully (always ACKs 200)
//   - always returns 200 to stop Meta retries (~24h retry window)
//
// Mock strategy: mock `verifyMetaSignature`, `parseWhatsAppInbound`,
// `findWhatsAppChannelByPhoneNumberId`, `getWhatsAppAdapter`, `emitToTenant`,
// `db` (multiple models), `captureError`, and the idempotency helpers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock verifyMetaSignature ────────────────────────────────────────────────
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
// Returns a controllable parsed inbound object per-test. Default = a text
// message from a CTWA ad (with ctwClickId).
const { parserMock } = vi.hoisted(() => ({
  parserMock: {
    parseWhatsAppInbound: vi.fn(),
  },
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

// ── Mock db (multiple models touched by the WhatsApp route) ────────────────
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    auditLog: { create: vi.fn() },
    message: { findFirst: vi.fn(), create: vi.fn() },
    customer: { findFirst: vi.fn(), create: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { GET, POST } from '@/app/api/webhooks/whatsapp/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('META_APP_SECRET', 'test-meta-app-secret')
  vi.stubEnv('WA_VERIFY_TOKEN', 'test-wa-verify-token')
  vi.stubEnv('NODE_ENV', 'development')
  // Default: valid signature, not a duplicate.
  hmacMock.verifyMetaSignature.mockReturnValue(true)
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_wa_fixed')
  dbMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  dbMock.message.findFirst.mockResolvedValue(null) // no existing message → not a dup
  dbMock.message.create.mockResolvedValue({ id: 'msg-1' })
  dbMock.customer.findFirst.mockResolvedValue(null) // no existing customer
  dbMock.customer.create.mockResolvedValue({ id: 'cust-1' })
  dbMock.conversation.findFirst.mockResolvedValue(null) // no existing open conversation
  dbMock.conversation.create.mockResolvedValue({ id: 'conv-1', clickId: null })
  dbMock.conversation.update.mockResolvedValue({})
  // Default: WA channel lookup succeeds for the parsed phone_number_id.
  waCloudMock.findWhatsAppChannelByPhoneNumberId.mockResolvedValue({
    id: 'ch-1',
    tenantId: 'tenant-1',
  })
  waCloudMock.getWhatsAppAdapter.mockResolvedValue({
    markMessageRead: vi.fn().mockResolvedValue(undefined),
  })
  // Default parsed inbound: text message with a CTWA click_id from an ad.
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildGetReq(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/webhooks/whatsapp')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), { method: 'GET' })
}

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

/** Canonical Meta WA webhook payload — `entry[0].changes[0].value.messages[0]`. */
function waTextBody(text = 'Hola, quiero comprar'): Record<string, unknown> {
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
              contacts: [{ wa_id: '573001112233', name: { formatted_name: 'María' } }],
              messages: [
                {
                  from: '573001112233',
                  id: 'wamid.test123',
                  timestamp: '1234567890',
                  type: 'text',
                  text: { body: text },
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
// GET handler — verification handshake
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp webhook · GET handshake', () => {
  it('returns 200 with hub.challenge literal when verify_token matches', async () => {
    const req = buildGetReq({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-wa-verify-token',
      'hub.challenge': 'wa-challenge-abc',
    })
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('wa-challenge-abc')
  })

  it('returns 403 when hub.verify_token is wrong', async () => {
    const req = buildGetReq({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'challenge',
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when hub.mode is not "subscribe"', async () => {
    const req = buildGetReq({
      'hub.mode': 'other',
      'hub.verify_token': 'test-wa-verify-token',
      'hub.challenge': 'challenge',
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('falls back to default verify_token when WA_VERIFY_TOKEN is unset', async () => {
    vi.stubEnv('WA_VERIFY_TOKEN', '')
    const req = buildGetReq({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'commerceflow_verify',
      'hub.challenge': 'default-wa-challenge',
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('default-wa-challenge')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — HMAC verification
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp webhook · POST signature verification', () => {
  it('rejects an invalid X-Hub-Signature-256 with 403', async () => {
    hmacMock.verifyMetaSignature.mockReturnValue(false)

    const req = buildPostReq(waTextBody(), 'sha256=tampered')
    const res = await POST(req)

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe('invalid signature')

    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'webhook.wa.invalid_sig' }),
      }),
    )
  })

  it('returns 500 when META_APP_SECRET is missing in production', async () => {
    vi.stubEnv('META_APP_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')

    const req = buildPostReq({}, 'sha256=any')
    const res = await POST(req)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Webhook secret not configured')

    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'webhook.wa.no_secret' }),
      }),
    )
    expect(hmacMock.verifyMetaSignature).not.toHaveBeenCalled()
  })

  it('skips verification in dev mode when META_APP_SECRET is missing (accepts non-empty sig)', async () => {
    vi.stubEnv('META_APP_SECRET', '')
    vi.stubEnv('NODE_ENV', 'development')

    const req = buildPostReq(waTextBody(), 'sha256=any-non-empty')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(hmacMock.verifyMetaSignature).not.toHaveBeenCalled()
  })

  it('always returns 200 on happy path (ack contract)', async () => {
    const req = buildPostReq(waTextBody(), 'sha256=valid')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — inbound parsing (text / image / location)
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp webhook · inbound message parsing', () => {
  it('parses text messages and persists Customer + Conversation + Message', async () => {
    const req = buildPostReq(waTextBody('Hola, quiero comprar'))
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'processed', conversationId: 'conv-1' })

    // parser was called with the raw body.
    expect(parserMock.parseWhatsAppInbound).toHaveBeenCalledTimes(1)

    // Customer was created (no existing customer for this phone).
    expect(dbMock.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          name: 'María',
          phone: '573001112233',
        }),
      }),
    )

    // Conversation was created (status=open).
    expect(dbMock.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          customerId: 'cust-1',
          status: 'open',
          customerPhone: '573001112233',
          clickId: 'cta_abc123', // CTWA click_id stamped at creation
        }),
      }),
    )

    // Message was persisted with direction=inbound + waMessageId.
    expect(dbMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          conversationId: 'conv-1',
          direction: 'inbound',
          body: 'Hola, quiero comprar',
          type: 'text',
          status: 'received',
          waMessageId: 'wamid.test123',
        }),
      }),
    )
  })

  it('parses image messages and persists with type=image + mediaUrl', async () => {
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
    expect(dbMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'image',
          mediaUrl: 'https://cdn.meta.com/img/123.jpg',
          body: '[Imagen] Foto del producto',
        }),
      }),
    )
  })

  it('parses location messages and persists with type=location', async () => {
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
    expect(dbMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'location',
          body: '[Ubicación] 4.7110,-74.0721',
        }),
      }),
    )
  })

  it('extracts CTWA click_id from context.cta_url_link (closed-loop attribution)', async () => {
    parserMock.parseWhatsAppInbound.mockReturnValue({
      from: '573001112233',
      messageId: 'wamid.ctwa-1',
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
    expect(dbMock.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clickId: 'cta_xyz789' }),
      }),
    )
  })

  it('returns non_message status when parser returns null (status updates)', async () => {
    parserMock.parseWhatsAppInbound.mockReturnValue(null)

    const req = buildPostReq({ entry: [{ changes: [{ value: { statuses: [{ id: 's1' }] } }] }] })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'non_message' })

    // The non_message audit row was written with the webhookId for dedup.
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'webhook.wa.non_message',
          entityId: 'wh_wa_fixed',
        }),
      }),
    )

    // No DB writes for customer / conversation / message.
    expect(dbMock.customer.create).not.toHaveBeenCalled()
    expect(dbMock.conversation.create).not.toHaveBeenCalled()
    expect(dbMock.message.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — tenant / channel resolution
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp webhook · channel resolution', () => {
  it('returns no_channel when phone_number_id has no matching tenant', async () => {
    waCloudMock.findWhatsAppChannelByPhoneNumberId.mockResolvedValue(null)
    // Also clear the env-var fallback so the second lookup also returns null.
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '')

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'no_channel' })

    // No DB writes happened.
    expect(dbMock.customer.create).not.toHaveBeenCalled()
    expect(dbMock.conversation.create).not.toHaveBeenCalled()
  })

  it('falls back to WHATSAPP_PHONE_NUMBER_ID env var when parsed.phoneNumberId misses', async () => {
    // First call (parsed.phoneNumberId) → null; second call (env var) → channel.
    waCloudMock.findWhatsAppChannelByPhoneNumberId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ch-env', tenantId: 'tenant-env' })
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'env-phone-id')

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('processed')

    // Two lookups happened (parsed.phoneNumberId then env var).
    expect(waCloudMock.findWhatsAppChannelByPhoneNumberId).toHaveBeenCalledTimes(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — socket emit + markMessageRead
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp webhook · realtime emit + read receipts', () => {
  it('emits message:new + message:received to chat-service', async () => {
    const req = buildPostReq(waTextBody())
    await POST(req)

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
    expect(chatEmitMock.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'message:received',
      expect.objectContaining({ conversationId: 'conv-1' }),
    )
  })

  it('bumps conversation lastMessageAt + unreadCount', async () => {
    const req = buildPostReq(waTextBody())
    await POST(req)

    expect(dbMock.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1' },
        data: expect.objectContaining({
          lastMessageAt: expect.any(Date),
          unreadCount: { increment: 1 },
        }),
      }),
    )
  })

  it('attempts markMessageRead via the WA adapter (fire-and-forget)', async () => {
    const markReadSpy = vi.fn().mockResolvedValue(undefined)
    waCloudMock.getWhatsAppAdapter.mockResolvedValue({ markMessageRead: markReadSpy })

    const req = buildPostReq(waTextBody())
    await POST(req)

    // The markMessageRead call is fire-and-forget — wait a tick for it to
    // resolve. await Promise.resolve() flushes the microtask queue.
    await new Promise((r) => setTimeout(r, 0))

    expect(waCloudMock.getWhatsAppAdapter).toHaveBeenCalledWith('tenant-1')
    expect(markReadSpy).toHaveBeenCalledWith('wamid.test123')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — idempotency (in-memory + DB + waMessageId layer-3)
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp webhook · idempotency', () => {
  it('short-circuits with status=duplicate when in-memory cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')

    expect(parserMock.parseWhatsAppInbound).not.toHaveBeenCalled()
    expect(idempotencyMock.isDuplicateWebhookDB).not.toHaveBeenCalled()
  })

  it('short-circuits with status=duplicate when DB-backed cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')

    expect(parserMock.parseWhatsAppInbound).not.toHaveBeenCalled()
  })

  it('returns duplicate_message_id when waMessageId already persisted (layer 3)', async () => {
    dbMock.message.findFirst.mockResolvedValue({ id: 'existing-msg' })

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate_message_id')

    expect(dbMock.message.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — error handling (always ACKs 200)
// ─────────────────────────────────────────────────────────────────────────────
describe('WhatsApp webhook · error handling', () => {
  it('returns processing_failed (200) when customer.create throws', async () => {
    dbMock.customer.create.mockRejectedValue(new Error('db unique constraint'))

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'processing_failed' })

    expect(captureErrorMock.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'webhook.wa.process', tenantId: 'tenant-1' }),
    )
  })

  it('returns processing_failed (200) when conversation.create throws', async () => {
    dbMock.conversation.create.mockRejectedValue(new Error('conv db error'))

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('processing_failed')
    expect(captureErrorMock.captureError).toHaveBeenCalled()
  })

  it('returns processing_failed (200) when message.create throws', async () => {
    dbMock.message.create.mockRejectedValue(new Error('msg db error'))

    const req = buildPostReq(waTextBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('processing_failed')
    expect(captureErrorMock.captureError).toHaveBeenCalled()
  })

  it('propagates the WA channel lookup error (outside try/catch) — Next.js wraps as 500', async () => {
    // NOTE: the route deliberately keeps the `findWhatsAppChannelByPhoneNumberId`
    // call OUTSIDE the try/catch — the catch block needs `tenantId`/`channelId`
    // to be set, which they aren't yet. A DB error during channel resolution
    // bubbles up to Next.js's `withErrorHandling` wrapper (which logs + returns
    // 500). Meta would retry per its ~24h retry policy, which is acceptable
    // because a DB-down state is transient.
    waCloudMock.findWhatsAppChannelByPhoneNumberId.mockRejectedValue(new Error('db down'))
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '')

    const req = buildPostReq(waTextBody())
    await expect(POST(req)).rejects.toThrow('db down')

    // The lookup was attempted before the error escaped.
    expect(waCloudMock.findWhatsAppChannelByPhoneNumberId).toHaveBeenCalled()
    // No DB writes happened because the catch block didn't run.
    expect(dbMock.customer.create).not.toHaveBeenCalled()
    expect(dbMock.message.create).not.toHaveBeenCalled()
  })
})
