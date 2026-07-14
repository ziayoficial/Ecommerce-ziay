// Unit tests for src/app/api/webhooks/meta/route.ts
// TASK: SPRINT-WEBHOOK-TESTS-EVAL-001
//
// Contract tests for the Meta (Messenger / Instagram / ad platform) webhook:
//
// GET handler (verification handshake):
//   - returns 200 with `hub.challenge` literal when `hub.verify_token` matches
//   - returns 403 when token is wrong or `hub.mode != subscribe`
//   - honors `META_VERIFY_TOKEN` env var (falls back to `commerceflow_verify`)
//
// POST handler (inbound events):
//   - rejects invalid `X-Hub-Signature-256` HMAC with 403
//   - returns 500 when `META_APP_SECRET` is missing in production (forged
//     webhooks would otherwise be silently accepted)
//   - dev mode fallback: accepts any non-empty signature
//   - accepts valid signatures, persists the body in AuditLog
//   - parses `entry[0].changes[0].value` shape (lead ads / attributions /
//     messaging callbacks)
//   - deduplicates on webhookId (in-memory + DB layers)
//   - always returns 200 to stop Meta retries (except 403 on invalid sig +
//     500 on config error)
//
// Mock strategy: mock `verifyMetaSignature` from `@/lib/middleware/hmac`, mock
// `db.auditLog.create` directly (Meta route doesn't use the `safeAudit` helper
// — it writes the AuditLog row inline), and mock the idempotency helpers.

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

// ── Mock db.auditLog (Meta route writes AuditLog directly — not via safeAudit)
const { auditLogMock } = vi.hoisted(() => ({
  auditLogMock: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    auditLog: auditLogMock,
  },
}))

import { GET, POST } from '@/app/api/webhooks/meta/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('META_APP_SECRET', 'test-meta-app-secret')
  vi.stubEnv('META_VERIFY_TOKEN', 'test-meta-verify-token')
  vi.stubEnv('NODE_ENV', 'development')
  // Default: valid signature, not a duplicate.
  hmacMock.verifyMetaSignature.mockReturnValue(true)
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_meta_fixed')
  auditLogMock.create.mockResolvedValue({ id: 'audit-1' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildGetReq(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/webhooks/meta')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), { method: 'GET' })
}

function buildPostReq(body: Record<string, unknown>, signature = 'sha256=valid'): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/meta', {
    method: 'POST',
    headers: {
      'x-hub-signature-256': signature,
      'content-type': 'application/json',
    },
    body: raw,
  })
}

/** Canonical Meta webhook payload — `entry[0].changes[0].value`. */
function metaLeadBody(): Record<string, unknown> {
  return {
    object: 'page',
    entry: [
      {
        id: '1234567890',
        time: 1700000000000,
        changes: [
          {
            field: 'leadgen',
            value: {
              ad_id: '123',
              form_id: '456',
              leadgen_id: '789',
              created_time: 1700000000,
              page_id: '1234567890',
            },
          },
        ],
      },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET handler — verification handshake
// ─────────────────────────────────────────────────────────────────────────────
describe('Meta webhook · GET handshake', () => {
  it('returns 200 with hub.challenge literal when verify_token matches', async () => {
    const req = buildGetReq({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-meta-verify-token',
      'hub.challenge': 'challenge-abc-123',
    })
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('challenge-abc-123')
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
      'hub.verify_token': 'test-meta-verify-token',
      'hub.challenge': 'challenge',
    })
    const res = await GET(req)

    expect(res.status).toBe(403)
  })

  it('returns 403 when hub.verify_token is missing', async () => {
    const req = buildGetReq({
      'hub.mode': 'subscribe',
      'hub.challenge': 'challenge',
    })
    const res = await GET(req)

    expect(res.status).toBe(403)
  })

  it('falls back to default verify_token when META_VERIFY_TOKEN is unset', async () => {
    vi.stubEnv('META_VERIFY_TOKEN', '')
    const req = buildGetReq({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'commerceflow_verify',
      'hub.challenge': 'default-challenge',
    })
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('default-challenge')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — HMAC verification
// ─────────────────────────────────────────────────────────────────────────────
describe('Meta webhook · POST signature verification', () => {
  it('rejects an invalid X-Hub-Signature-256 with 403', async () => {
    hmacMock.verifyMetaSignature.mockReturnValue(false)

    const req = buildPostReq(metaLeadBody(), 'sha256=tampered')
    const res = await POST(req)

    // Meta route returns 403 on invalid sig (unlike payment webhooks which
    // return 200 + invalid_signature to stop retries — Meta accepts 403).
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe('invalid signature')

    // The invalid-sig event was logged to AuditLog.
    expect(auditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'webhook.meta.invalid_sig',
          entity: 'Webhook',
        }),
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

    expect(auditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'webhook.meta.no_secret' }),
      }),
    )
    expect(hmacMock.verifyMetaSignature).not.toHaveBeenCalled()
  })

  it('skips verification in dev mode when META_APP_SECRET is missing (accepts non-empty sig)', async () => {
    vi.stubEnv('META_APP_SECRET', '')
    vi.stubEnv('NODE_ENV', 'development')

    const req = buildPostReq(metaLeadBody(), 'sha256=any-non-empty')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(hmacMock.verifyMetaSignature).not.toHaveBeenCalled()
    // The inbound event was still persisted.
    expect(auditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'webhook.meta.inbound' }),
      }),
    )
  })

  it('accepts a valid signature + persists the inbound body in AuditLog', async () => {
    hmacMock.verifyMetaSignature.mockReturnValue(true)

    const req = buildPostReq(metaLeadBody(), 'sha256=valid')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    // verifyMetaSignature was called with (rawBody, signature, appSecret).
    expect(hmacMock.verifyMetaSignature).toHaveBeenCalledWith(
      expect.any(String),
      'sha256=valid',
      'test-meta-app-secret',
    )

    // The inbound event was persisted with the webhookId as entityId.
    expect(auditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'webhook.meta.inbound',
          entity: 'Webhook',
          entityId: 'wh_meta_fixed',
        }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — entry[].changes[].value parsing
// ─────────────────────────────────────────────────────────────────────────────
describe('Meta webhook · entry parsing', () => {
  beforeEach(() => {
    hmacMock.verifyMetaSignature.mockReturnValue(true)
  })

  it('persists the canonical leadgen payload { entry[0].changes[0].value }', async () => {
    const body = metaLeadBody()
    await POST(buildPostReq(body))

    // The AuditLog write receives the JSON-stringified body (truncated).
    expect(auditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'webhook.meta.inbound',
          metadata: expect.stringContaining('leadgen'),
        }),
      }),
    )
  })

  it('persists messaging payloads (Messenger / Instagram DMs)', async () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'pg-1',
          time: 1700000000000,
          messaging: [
            {
              sender: { id: 'sender-1' },
              recipient: { id: 'pg-1' },
              message: { text: 'Hola, quiero comprar' },
            },
          ],
        },
      ],
    }
    await POST(buildPostReq(body))
    expect(auditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'webhook.meta.inbound',
          metadata: expect.stringContaining('messaging'),
        }),
      }),
    )
  })

  it('handles empty entry array gracefully (ACKs 200)', async () => {
    const req = buildPostReq({ object: 'page', entry: [] })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(auditLogMock.create).toHaveBeenCalled()
  })

  it('handles malformed JSON bodies gracefully (ACKs 200)', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/meta', {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=valid' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(auditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'webhook.meta.inbound' }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('Meta webhook · idempotency', () => {
  beforeEach(() => {
    hmacMock.verifyMetaSignature.mockReturnValue(true)
  })

  it('short-circuits with status=duplicate when in-memory cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildPostReq(metaLeadBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'duplicate' })

    // Duplicate webhooks must NOT trigger the AuditLog write.
    expect(auditLogMock.create).not.toHaveBeenCalled()
    expect(idempotencyMock.isDuplicateWebhookDB).not.toHaveBeenCalled()
  })

  it('short-circuits with status=duplicate when DB-backed cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildPostReq(metaLeadBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')

    expect(idempotencyMock.isDuplicateWebhook).toHaveBeenCalledTimes(2)
    expect(auditLogMock.create).not.toHaveBeenCalled()
  })
})
