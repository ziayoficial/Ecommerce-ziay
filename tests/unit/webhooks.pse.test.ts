// Unit tests for src/app/api/webhooks/pse/route.ts
// TASK: SPRINT-TESTS-001
//
// Contract tests for the PSE (ACH Colombia) webhook:
//   - rejects invalid HMAC-SHA256 signatures with 200 + invalid_signature
//   - returns 500 when PSE_WEBHOOK_SECRET is missing in production (so PSE
//     retries + the operator is alerted — silently ACKing would mask the
//     misconfiguration)
//   - skips verification in dev mode when the secret is missing (accepts any
//     non-empty signature)
//   - accepts valid signatures + maps the PSE state code to the canonical
//     internal status (approved / rejected / expired / pending)
//   - deduplicates on webhookId (in-memory + DB layers)
//   - handles both top-level + `data`-nested payload shapes
//   - never throws — every error path ACKs 200 + safeAudit
//
// Mock strategy: mock `verifyHmacSha256` from `@/lib/middleware/hmac` so the
// test controls the signature check outcome per-case. Set PSE_WEBHOOK_SECRET
// so the route goes through the real verification branch (not the dev-fallback).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock verifyHmacSha256 ──────────────────────────────────────────────────
const { hmacMock } = vi.hoisted(() => ({
  hmacMock: {
    verifyHmacSha256: vi.fn(),
    verifyMetaSignature: vi.fn(),
    verifyHmacSha256Base64: vi.fn(),
  },
}))
vi.mock('@/lib/middleware/hmac', () => hmacMock)

// ── Mock payment-webhook-utils ─────────────────────────────────────────────
const { paymentUtilsMock } = vi.hoisted(() => ({
  paymentUtilsMock: {
    applyPaymentUpdate: vi.fn(),
    safeAudit: vi.fn(),
  },
}))
vi.mock('@/lib/adapters/payment-webhook-utils', () => ({
  applyPaymentUpdate: paymentUtilsMock.applyPaymentUpdate,
  safeAudit: paymentUtilsMock.safeAudit,
}))

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

// Stub logger — the PSE route uses getLogger() directly (not the
// payment-webhook-utils logger).
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

import { POST } from '@/app/api/webhooks/pse/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Set the secret so the route goes through the real verifyHmacSha256 branch
  // (not the dev-mode fallback that accepts any non-empty sig). Use vi.stubEnv
  // because `process.env.NODE_ENV` is typed as read-only in @types/node.
  vi.stubEnv('PSE_WEBHOOK_SECRET', 'test-pse-secret')
  // Default: valid signature, not a duplicate.
  hmacMock.verifyHmacSha256.mockReturnValue(true)
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_pse_fixed')
  paymentUtilsMock.safeAudit.mockResolvedValue(undefined)
  paymentUtilsMock.applyPaymentUpdate.mockResolvedValue({ found: true, newStatus: 'paid' })
})

afterEach(() => {
  // Restore all stubbed env vars (PSE_WEBHOOK_SECRET + NODE_ENV) so tests
  // don't leak state into each other.
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildReq(body: Record<string, unknown>, signature = 'valid-hex'): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/pse', {
    method: 'POST',
    headers: {
      'x-pse-signature': signature,
      'content-type': 'application/json',
    },
    body: raw,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────
describe('PSE webhook · signature verification', () => {
  it('rejects an invalid HMAC signature with 200 + status=invalid_signature', async () => {
    hmacMock.verifyHmacSha256.mockReturnValue(false)

    const req = buildReq(
      { transactionId: 'tx-1', state: 'OK', reference: 'ORD-1', amount: 50000 },
      'tampered-hex',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'invalid_signature' })

    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()

    // safeAudit recorded the invalid-sig event.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pse.invalid_sig',
      'Webhook',
      expect.any(String),
    )

    // verifyHmacSha256 was called with (rawBody, signature, secret).
    expect(hmacMock.verifyHmacSha256).toHaveBeenCalledWith(
      expect.any(String),
      'tampered-hex',
      'test-pse-secret',
    )
  })

  it('accepts a valid signature + dispatches applyPaymentUpdate for state=OK', async () => {
    hmacMock.verifyHmacSha256.mockReturnValue(true)

    const req = buildReq({
      transactionId: 'tx-2',
      state: 'OK',
      reference: 'ORD-2024-002',
      amount: 75000,
      currency: 'COP',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    // PSE state 'OK' → canonical 'approved', success=true.
    // AUDIT-FINTECH R-6 — the route now passes the gateway-reported
    // amount/currency (extracted from the webhook body) so `applyPaymentUpdate`
    // can defend against forged-amount webhooks.
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith({
      gateway: 'pse',
      paymentId: 'tx-2',
      externalReference: 'ORD-2024-002',
      status: 'approved',
      success: true,
      amount: 75000,
      currency: 'COP',
    })

    // safeAudit recorded the inbound event with the webhookId.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pse.inbound',
      'Webhook',
      expect.any(String),
      'wh_pse_fixed',
    )
  })

  it('returns 500 when PSE_WEBHOOK_SECRET is missing in production', async () => {
    vi.stubEnv('PSE_WEBHOOK_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')

    const req = buildReq({}, 'any-sig')
    const res = await POST(req)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Webhook secret not configured')

    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pse.no_secret',
      'Webhook',
      'PSE_WEBHOOK_SECRET missing in production',
    )
    expect(hmacMock.verifyHmacSha256).not.toHaveBeenCalled()
  })

  it('skips verification in dev mode when secret is missing (accepts any non-empty sig)', async () => {
    vi.stubEnv('PSE_WEBHOOK_SECRET', '')
    vi.stubEnv('NODE_ENV', 'development')

    const req = buildReq(
      { transactionId: 'tx-dev', state: 'OK', reference: 'ORD-DEV' },
      'any-non-empty-signature',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    // In dev mode, the route logs a warning but still processes the webhook.
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'pse',
        paymentId: 'tx-dev',
        status: 'approved',
      }),
    )
    // verifyHmacSha256 was NOT called (dev-mode bypass).
    expect(hmacMock.verifyHmacSha256).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// State code mapping
// ─────────────────────────────────────────────────────────────────────────────
describe('PSE webhook · state code mapping', () => {
  it('maps APPROVED → approved (success=true)', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'APPROVED', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
  })

  it('maps SUCCESS → approved', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'SUCCESS', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
  })

  it('maps NOT_OK → rejected (success=false)', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'NOT_OK', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', success: false }),
    )
  })

  it('maps FAILED → rejected', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'FAILED', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', success: false }),
    )
  })

  it('maps REJECTED → rejected', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'REJECTED', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', success: false }),
    )
  })

  it('maps NOT_AUTHORIZED → rejected', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'NOT_AUTHORIZED', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', success: false }),
    )
  })

  it('maps EXPIRED → expired', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'EXPIRED', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired', success: false }),
    )
  })

  it('maps PENDING → pending', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'PENDING', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', success: false }),
    )
  })

  it('maps unknown state → pending (fail-safe)', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'UNKNOWN', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', success: false }),
    )
  })

  it('state mapping is case-insensitive (lowercase "ok" works)', async () => {
    const req = buildReq({ transactionId: 'tx', state: 'ok', reference: 'ORD' })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Payload shape variations
// ─────────────────────────────────────────────────────────────────────────────
describe('PSE webhook · payload shape variations', () => {
  it('accepts the canonical top-level shape { transactionId, state, reference }', async () => {
    const req = buildReq({
      transactionId: 'tx-top',
      state: 'OK',
      reference: 'ORD-TOP',
    })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'tx-top',
        externalReference: 'ORD-TOP',
      }),
    )
  })

  it('accepts snake_case fields (transaction_id) — some PSE integrations use this', async () => {
    const req = buildReq({
      data: {
        transaction_id: 'tx-snake',
        state: 'OK',
        reference: 'ORD-SNAKE',
      },
    })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'tx-snake',
        externalReference: 'ORD-SNAKE',
      }),
    )
  })

  it('uses reference as paymentId when transactionId is missing', async () => {
    const req = buildReq({
      reference: 'REF-ONLY',
      state: 'OK',
    })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'REF-ONLY',
        externalReference: 'REF-ONLY',
      }),
    )
  })

  it('skips dispatch when both transactionId and reference are missing', async () => {
    const req = buildReq({ state: 'OK' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    // But the inbound audit was still recorded.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pse.inbound',
      'Webhook',
      expect.any(String),
      'wh_pse_fixed',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('PSE webhook · idempotency', () => {
  it('short-circuits with status=duplicate when in-memory cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildReq({ transactionId: 'dup', state: 'OK', reference: 'ORD' })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })

  it('short-circuits with status=duplicate when DB-backed cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildReq({ transactionId: 'dup-db', state: 'OK', reference: 'ORD' })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────────
describe('PSE webhook · error handling', () => {
  it('never throws when applyPaymentUpdate rejects — always ACKs 200', async () => {
    paymentUtilsMock.applyPaymentUpdate.mockRejectedValue(new Error('db down'))

    const req = buildReq({
      transactionId: 'tx-err',
      state: 'OK',
      reference: 'ORD-ERR',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pse.error',
      'Webhook',
      'db down',
      'wh_pse_fixed',
    )
  })

  it('handles malformed JSON bodies gracefully (ACKs 200)', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/pse', {
      method: 'POST',
      headers: { 'x-pse-signature': 'valid-hex' },
      body: 'not-json',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    // No transactionId / reference resolved from malformed body → no dispatch.
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})
