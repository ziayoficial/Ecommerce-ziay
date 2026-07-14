// Unit tests for src/app/api/webhooks/wompi/route.ts
// TASK: SPRINT-WEBHOOK-TESTS-EVAL-001
//
// Contract tests for the Wompi payment webhook (Saramantha §10):
//   - rejects invalid `X-Events-Signature` signatures with 200 + invalid_signature
//   - returns 500 when the adapter throws (missing WOMPI_EVENT_SECRET in prod)
//   - accepts valid signatures and dispatches `applyPaymentUpdate` with the
//     canonical Wompi payload (`data.transaction.{id,reference,status}`)
//   - deduplicates on webhookId (in-memory + DB layers)
//   - parses APPROVED / DECLINED / PENDING transaction statuses
//   - never throws — every error path ACKs 200 + safeAudit
//
// Mock strategy mirrors webhooks.stripe.test.ts + webhooks.mercadopago.test.ts:
//   - Mock the WompiAdapter class so we control `webhookVerify` per-test.
//   - Mock `applyPaymentUpdate` + `safeAudit` so we can assert dispatch calls
//     without touching the DB.
//   - Mock the idempotency helpers so the in-memory Map + DB query don't leak
//     across tests.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock WompiAdapter ───────────────────────────────────────────────────────
// The route imports the class and `new`s it; mock the class so `webhookVerify`
// is controllable per-test. See webhooks.stripe.test.ts for the same pattern.
const { wompiAdapterMock } = vi.hoisted(() => {
  const mock = {
    webhookVerify: vi.fn(),
    verifyPayment: vi.fn(),
    createPaymentLink: vi.fn(),
    refund: vi.fn(),
    name: 'wompi',
  }
  return { wompiAdapterMock: mock }
})

vi.mock('@/lib/adapters/wompi', () => ({
  // Mock the class so `new WompiAdapter()` returns an instance whose
  // methods are the vi.fn references on `wompiAdapterMock`. Per-test
  // `.mockReturnValue()` / `.mockImplementation()` calls still work because
  // the vi.fn references are stable across instances.
  //
  // NOTE: we use a real class (not `vi.fn(() => wompiAdapterMock)`) because
  // arrow functions cannot be invoked with `new` — the route does
  // `new WompiAdapter()` so the mock must be constructable.
  WompiAdapter: class MockWompiAdapter {
    constructor() {
      Object.assign(this, wompiAdapterMock)
    }
  },
}))

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

// Import AFTER the mocks take effect.
import { POST } from '@/app/api/webhooks/wompi/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: not a duplicate, deterministic webhook id.
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_wompi_fixed')
  paymentUtilsMock.safeAudit.mockResolvedValue(undefined)
  paymentUtilsMock.applyPaymentUpdate.mockResolvedValue({ found: true, newStatus: 'paid' })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildReq(body: Record<string, unknown>, signature: string): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/wompi', {
    method: 'POST',
    headers: { 'x-events-signature': signature, 'content-type': 'application/json' },
    body: raw,
  })
}

/** Canonical Wompi payload — `event: transaction.updated` + `data.transaction`. */
function wompiBody(
  txId: string,
  reference: string,
  status: string,
): Record<string, unknown> {
  return {
    event: 'transaction.updated',
    data: {
      transaction: {
        id: txId,
        status,
        reference,
        amount_in_cents: 15000000,
        currency: 'COP',
      },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────
describe('Wompi webhook · signature verification', () => {
  it('rejects an invalid signature with 200 + status=invalid_signature', async () => {
    wompiAdapterMock.webhookVerify.mockReturnValue(false)

    const req = buildReq(wompiBody('tx-1', 'ORD-1', 'APPROVED'), 'invalid-hex')
    const res = await POST(req)

    // Always 200 to stop Wompi retries — but the body flag tells the operator
    // the signature didn't verify.
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'invalid_signature' })

    // The route must NOT dispatch the payment update on an invalid sig.
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()

    // safeAudit recorded the invalid-sig event for forensic review.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.wompi.invalid_sig',
      'Webhook',
      expect.any(String),
    )
  })

  it('returns 500 when the adapter throws (missing webhook secret in prod)', async () => {
    wompiAdapterMock.webhookVerify.mockImplementation(() => {
      throw new Error('Wompi webhook secret not configured in production')
    })

    const req = buildReq({}, 'any-sig')
    const res = await POST(req)

    // Config errors surface as 500 so Wompi retries + the operator is alerted.
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Webhook verification configuration error')

    // safeAudit recorded the config error.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.wompi.config_error',
      'Webhook',
      'Wompi webhook secret not configured in production',
    )
  })

  it('accepts a valid signature and dispatches applyPaymentUpdate for transaction.updated', async () => {
    wompiAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(
      wompiBody('tx-123', 'ORD-2024-001', 'APPROVED'),
      'valid-hex-signature',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true })

    // applyPaymentUpdate was dispatched with the canonical Wompi shape.
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith({
      gateway: 'wompi',
      paymentId: 'tx-123',
      externalReference: 'ORD-2024-001',
      status: 'APPROVED',
      success: true,
    })

    // safeAudit recorded the inbound event with the webhookId for cross-instance dedup.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.wompi.inbound',
      'Webhook',
      expect.any(String),
      'wh_wompi_fixed',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Payload parsing — `data.transaction.{id,reference,status}`
// ─────────────────────────────────────────────────────────────────────────────
describe('Wompi webhook · payload parsing', () => {
  beforeEach(() => {
    wompiAdapterMock.webhookVerify.mockReturnValue(true)
  })

  it('parses APPROVED → success=true', async () => {
    const req = buildReq(wompiBody('tx-a', 'ORD-A', 'APPROVED'), 'sig')
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED', success: true }),
    )
  })

  it('parses DECLINED → success=false', async () => {
    const req = buildReq(wompiBody('tx-d', 'ORD-D', 'DECLINED'), 'sig')
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DECLINED', success: false }),
    )
  })

  it('parses PENDING → success=false', async () => {
    const req = buildReq(wompiBody('tx-p', 'ORD-P', 'PENDING'), 'sig')
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING', success: false }),
    )
  })

  it('extracts transaction id + reference from the data.transaction envelope', async () => {
    const req = buildReq(wompiBody('wompi-tx-999', 'ORD-REF-999', 'APPROVED'), 'sig')
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'wompi-tx-999',
        externalReference: 'ORD-REF-999',
      }),
    )
  })

  it('skips dispatch when event is not transaction.*', async () => {
    const req = buildReq(
      { event: 'account.updated', data: { foo: 'bar' } },
      'sig',
    )
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    // But the inbound audit was still recorded.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.wompi.inbound',
      'Webhook',
      expect.any(String),
      'wh_wompi_fixed',
    )
  })

  it('skips dispatch when transaction id is missing', async () => {
    const req = buildReq(
      { event: 'transaction.updated', data: { transaction: { reference: 'ORD' } } },
      'sig',
    )
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency — in-memory + DB
// ─────────────────────────────────────────────────────────────────────────────
describe('Wompi webhook · idempotency', () => {
  beforeEach(() => {
    wompiAdapterMock.webhookVerify.mockReturnValue(true)
  })

  it('short-circuits with status=duplicate when in-memory cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildReq(wompiBody('dup-1', 'ORD-1', 'APPROVED'), 'sig')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'duplicate' })

    // Duplicate webhooks must NOT trigger applyPaymentUpdate.
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    // And must NOT query the DB-backed dedup check (in-memory hit short-circuits).
    expect(idempotencyMock.isDuplicateWebhookDB).not.toHaveBeenCalled()
  })

  it('short-circuits with status=duplicate when DB-backed cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildReq(wompiBody('dup-db-1', 'ORD-2', 'APPROVED'), 'sig')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'duplicate' })

    // The DB hit also re-warms the in-memory cache so the next retry is fast.
    expect(idempotencyMock.isDuplicateWebhook).toHaveBeenCalledTimes(2)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling — never throws, always ACKs 200
// ─────────────────────────────────────────────────────────────────────────────
describe('Wompi webhook · error handling', () => {
  beforeEach(() => {
    wompiAdapterMock.webhookVerify.mockReturnValue(true)
  })

  it('never throws when applyPaymentUpdate rejects — always ACKs 200', async () => {
    paymentUtilsMock.applyPaymentUpdate.mockRejectedValue(new Error('db down'))

    const req = buildReq(wompiBody('tx-err', 'ORD-ERR', 'APPROVED'), 'sig')
    const res = await POST(req)

    // Gateway contract: always 200 to stop retries, even on processing errors.
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true })

    // The error was captured via safeAudit so the operator sees it.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.wompi.error',
      'Webhook',
      'db down',
      'wh_wompi_fixed',
    )
  })

  it('handles malformed JSON bodies gracefully (ACKs 200)', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/wompi', {
      method: 'POST',
      headers: { 'x-events-signature': 'valid-sig' },
      body: 'not-json-at-all',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    // No paymentId resolved from malformed body → no dispatch.
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })

  it('always returns 200 even on happy path (ack contract)', async () => {
    const req = buildReq(wompiBody('happy-1', 'ORD-HAPPY', 'APPROVED'), 'sig')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).received).toBe(true)
  })
})
