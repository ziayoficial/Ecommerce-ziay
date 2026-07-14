// Unit tests for src/app/api/webhooks/pix/route.ts
// TASK: SPRINT-WEBHOOK-TESTS-EVAL-001
//
// Contract tests for the PIX (Banco Central do Brasil) webhook
// (Comercio Agéntico study §18):
//   - rejects invalid HMAC-SHA256 signatures with 200 + invalid_signature
//   - returns 500 when PIX_HMAC_SECRET is missing in production (so PIX
//     retries + the operator is alerted — silently ACKing would mask the
//     misconfiguration)
//   - skips verification in dev mode when the secret is missing (accepts any
//     non-empty signature)
//   - accepts valid signatures + maps PIX status codes to canonical internal
//     status (approved / rejected / expired / pending)
//   - deduplicates on webhookId (in-memory + DB layers)
//   - handles both top-level + `data` / `pix`-nested payload shapes
//   - never throws — every error path ACKs 200 + safeAudit
//
// Mock strategy: mock `verifyHmacSha256` from `@/lib/middleware/hmac` so the
// test controls the signature check outcome per-case. Set PIX_HMAC_SECRET
// so the route goes through the real verification branch (not the dev-fallback).
//
// Note: PIX route uses `applyPaymentUpdate` (from payment-webhook-utils) which
// auto-fires the CAPI Purchase event on transition to `paid` (closed-loop study
// §14.4). We mock `applyPaymentUpdate` so we can assert dispatch calls + ensure
// the CAPI fire happens inside the helper (not the route).

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

// Stub logger — the PIX route uses getLogger() directly.
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

import { POST } from '@/app/api/webhooks/pix/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Set the secret so the route goes through the real verifyHmacSha256 branch
  // (not the dev-mode fallback that accepts any non-empty sig). Use vi.stubEnv
  // because `process.env.NODE_ENV` is typed as read-only in @types/node.
  vi.stubEnv('PIX_HMAC_SECRET', 'test-pix-secret')
  vi.stubEnv('NODE_ENV', 'development')
  // Default: valid signature, not a duplicate.
  hmacMock.verifyHmacSha256.mockReturnValue(true)
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_pix_fixed')
  paymentUtilsMock.safeAudit.mockResolvedValue(undefined)
  paymentUtilsMock.applyPaymentUpdate.mockResolvedValue({ found: true, newStatus: 'paid' })
})

afterEach(() => {
  // Restore all stubbed env vars (PIX_HMAC_SECRET + NODE_ENV) so tests
  // don't leak state into each other.
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildReq(body: Record<string, unknown>, signature = 'valid-hex'): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/pix', {
    method: 'POST',
    headers: {
      'x-pix-signature': signature,
      'content-type': 'application/json',
    },
    body: raw,
  })
}

/** Canonical PIX payload — `txid`, `status`, `valor.original`, `pagador`. */
function pixBody(
  txid: string,
  status: string,
  amount = 99.9,
): Record<string, unknown> {
  return {
    txid,
    status,
    valor: { original: String(amount) },
    pagador: { nome: 'João', cpf: '12345678900' },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────
describe('PIX webhook · signature verification', () => {
  it('rejects an invalid HMAC signature with 200 + status=invalid_signature', async () => {
    hmacMock.verifyHmacSha256.mockReturnValue(false)

    const req = buildReq(pixBody('tx-1', 'CONCLUIDA'), 'tampered-hex')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'invalid_signature' })

    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()

    // safeAudit recorded the invalid-sig event.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pix.invalid_sig',
      'Webhook',
      expect.any(String),
    )

    // verifyHmacSha256 was called with (rawBody, signature, secret).
    expect(hmacMock.verifyHmacSha256).toHaveBeenCalledWith(
      expect.any(String),
      'tampered-hex',
      'test-pix-secret',
    )
  })

  it('accepts a valid signature + dispatches applyPaymentUpdate for status=CONCLUIDA', async () => {
    hmacMock.verifyHmacSha256.mockReturnValue(true)

    const req = buildReq(pixBody('txid-123', 'CONCLUIDA'), 'valid-hex')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    // CONCLUIDA → approved, success=true
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith({
      gateway: 'pix',
      paymentId: 'txid-123',
      externalReference: 'txid-123',
      status: 'approved',
      success: true,
    })

    // safeAudit recorded the inbound event with the webhookId.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pix.inbound',
      'Webhook',
      expect.any(String),
      'wh_pix_fixed',
    )
  })

  it('returns 500 when PIX_HMAC_SECRET is missing in production', async () => {
    vi.stubEnv('PIX_HMAC_SECRET', '')
    vi.stubEnv('PIX_WEBHOOK_SECRET', '')
    vi.stubEnv('PIX_MTLS_TERMINATED', '')
    vi.stubEnv('NODE_ENV', 'production')

    const req = buildReq({}, 'any-sig')
    const res = await POST(req)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Webhook secret not configured')

    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pix.no_secret',
      'Webhook',
      'PIX_HMAC_SECRET missing in production and PIX_MTLS_TERMINATED not set',
    )
    expect(hmacMock.verifyHmacSha256).not.toHaveBeenCalled()
  })

  it('skips verification in dev mode when secret is missing (accepts any non-empty sig)', async () => {
    vi.stubEnv('PIX_HMAC_SECRET', '')
    vi.stubEnv('PIX_WEBHOOK_SECRET', '')
    vi.stubEnv('NODE_ENV', 'development')

    const req = buildReq(
      pixBody('txid-dev', 'CONCLUIDA'),
      'any-non-empty-signature',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    // In dev mode, the route logs a warning but still processes the webhook.
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'pix',
        paymentId: 'txid-dev',
        status: 'approved',
      }),
    )
    // verifyHmacSha256 was NOT called (dev-mode bypass).
    expect(hmacMock.verifyHmacSha256).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('accepts mTLS-terminated requests in production when PIX_MTLS_TERMINATED=true', async () => {
    vi.stubEnv('PIX_HMAC_SECRET', '')
    vi.stubEnv('PIX_WEBHOOK_SECRET', '')
    vi.stubEnv('PIX_MTLS_TERMINATED', 'true')
    vi.stubEnv('NODE_ENV', 'production')

    const req = buildReq(pixBody('txid-mtls', 'CONCLUIDA'), '')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
    expect(hmacMock.verifyHmacSha256).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Status code mapping
// ─────────────────────────────────────────────────────────────────────────────
describe('PIX webhook · status code mapping', () => {
  it('maps CONCLUIDA → approved (success=true)', async () => {
    await POST(buildReq(pixBody('tx', 'CONCLUIDA')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
  })

  it('maps CONCLUÍDA (with accent) → approved', async () => {
    await POST(buildReq(pixBody('tx', 'CONCLUÍDA')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
  })

  it('maps APROVADA → approved', async () => {
    await POST(buildReq(pixBody('tx', 'APROVADA')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
  })

  it('maps PAID → approved', async () => {
    await POST(buildReq(pixBody('tx', 'PAID')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
  })

  it('maps REMOVIDA_PELO_USUARIO_RECEBEDOR → rejected', async () => {
    await POST(buildReq(pixBody('tx', 'REMOVIDA_PELO_USUARIO_RECEBEDOR')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', success: false }),
    )
  })

  it('maps CANCELLED → rejected', async () => {
    await POST(buildReq(pixBody('tx', 'CANCELLED')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', success: false }),
    )
  })

  it('maps REJECTED → rejected', async () => {
    await POST(buildReq(pixBody('tx', 'REJECTED')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', success: false }),
    )
  })

  it('maps EXPIRED → expired', async () => {
    await POST(buildReq(pixBody('tx', 'EXPIRED')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired', success: false }),
    )
  })

  it('maps EXPIRADA → expired', async () => {
    await POST(buildReq(pixBody('tx', 'EXPIRADA')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired', success: false }),
    )
  })

  it('maps ATIVA → pending (fail-safe)', async () => {
    await POST(buildReq(pixBody('tx', 'ATIVA')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', success: false }),
    )
  })

  it('maps unknown status → pending (fail-safe)', async () => {
    await POST(buildReq(pixBody('tx', 'UNKNOWN_FUTURE_STATE')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', success: false }),
    )
  })

  it('status mapping is case-insensitive (lowercase "concluida" works)', async () => {
    await POST(buildReq(pixBody('tx', 'concluida')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', success: true }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Payload shape variations
// ─────────────────────────────────────────────────────────────────────────────
describe('PIX webhook · payload shape variations', () => {
  it('accepts the canonical top-level shape { txid, status, valor }', async () => {
    await POST(buildReq(pixBody('tx-top', 'CONCLUIDA')))
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'tx-top',
        externalReference: 'tx-top',
      }),
    )
  })

  it('accepts nested data envelope { data: { txid, status } }', async () => {
    const req = buildReq({ data: { txid: 'tx-nested', status: 'CONCLUIDA', valor: { original: '50.00' } } })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'tx-nested' }),
    )
  })

  it('accepts nested pix envelope { pix: { txid, status } }', async () => {
    const req = buildReq({ pix: { txid: 'tx-pix-nested', status: 'CONCLUIDA' } })
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'tx-pix-nested' }),
    )
  })

  it('skips dispatch when txid is missing', async () => {
    const req = buildReq({ status: 'CONCLUIDA' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    // But the inbound audit was still recorded.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pix.inbound',
      'Webhook',
      expect.any(String),
      'wh_pix_fixed',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('PIX webhook · idempotency', () => {
  it('short-circuits with status=duplicate when in-memory cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildReq(pixBody('dup', 'CONCLUIDA'))
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })

  it('short-circuits with status=duplicate when DB-backed cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildReq(pixBody('dup-db', 'CONCLUIDA'))
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling — always ACKs 200
// ─────────────────────────────────────────────────────────────────────────────
describe('PIX webhook · error handling', () => {
  it('never throws when applyPaymentUpdate rejects — always ACKs 200', async () => {
    paymentUtilsMock.applyPaymentUpdate.mockRejectedValue(new Error('db down'))

    const req = buildReq(pixBody('tx-err', 'CONCLUIDA'))
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.pix.error',
      'Webhook',
      'db down',
      'wh_pix_fixed',
    )
  })

  it('handles malformed JSON bodies gracefully (ACKs 200)', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/pix', {
      method: 'POST',
      headers: { 'x-pix-signature': 'valid-hex' },
      body: 'not-json',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})
