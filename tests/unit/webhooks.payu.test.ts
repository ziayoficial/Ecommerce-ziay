// Unit tests for src/app/api/webhooks/payu/route.ts
// TASK: SPRINT-WEBHOOK-TESTS-EVAL-001
//
// Contract tests for the PayU payment webhook (Saramantha §10):
//   - rejects invalid signatures (header `x-payu-signature` OR body `sign`)
//     with 200 + status=invalid_signature
//   - returns 500 when the adapter throws (missing credentials in prod)
//   - accepts valid signatures and dispatches `applyPaymentUpdate` with the
//     canonical PayU payload (`reference_sale`, `transaction_id`, `state_pol`)
//   - maps all 4 state_pol codes: 4=APPROVED, 6=DECLINED, 5=EXPIRED, 7=PENDING
//   - deduplicates on webhookId (in-memory + DB layers)
//   - never throws — every error path ACKs 200 + safeAudit
//
// Mock strategy mirrors webhooks.wompi.test.ts + webhooks.stripe.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock PayUAdapter ────────────────────────────────────────────────────────
const { payuAdapterMock } = vi.hoisted(() => {
  const mock = {
    webhookVerify: vi.fn(),
    verifyPayment: vi.fn(),
    createPaymentLink: vi.fn(),
    refund: vi.fn(),
    name: 'payu',
  }
  return { payuAdapterMock: mock }
})

vi.mock('@/lib/adapters/payu', () => ({
  // Mock the class so `new PayUAdapter()` returns an instance whose methods
  // are the vi.fn references on `payuAdapterMock`. See webhooks.stripe.test.ts
  // for the rationale (arrow functions can't be `new`-invoked).
  PayUAdapter: class MockPayUAdapter {
    constructor() {
      Object.assign(this, payuAdapterMock)
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
import { POST } from '@/app/api/webhooks/payu/route'

beforeEach(() => {
  vi.clearAllMocks()
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_payu_fixed')
  paymentUtilsMock.safeAudit.mockResolvedValue(undefined)
  paymentUtilsMock.applyPaymentUpdate.mockResolvedValue({ found: true, newStatus: 'paid' })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildReq(
  body: Record<string, unknown>,
  signature: string | null,
): NextRequest {
  const raw = JSON.stringify(body)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // When `signature` is null, the route falls back to body `sign` field.
  if (signature !== null) headers['x-payu-signature'] = signature
  return new NextRequest('http://localhost/api/webhooks/payu', {
    method: 'POST',
    headers,
    body: raw,
  })
}

/** Canonical PayU payload. `state_pol` is a numeric string per PayU docs. */
function payuBody(
  reference: string,
  statePol: string,
  txId = 'payu-tx-123',
  sign?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    reference_sale: reference,
    value: '150000.00',
    currency: 'COP',
    state_pol: statePol,
    transaction_id: txId,
  }
  if (sign) body.sign = sign
  return body
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification — header OR body `sign`
// ─────────────────────────────────────────────────────────────────────────────
describe('PayU webhook · signature verification', () => {
  it('rejects an invalid header signature with 200 + status=invalid_signature', async () => {
    payuAdapterMock.webhookVerify.mockReturnValue(false)

    const req = buildReq(payuBody('ORD-1', '4'), 'invalid-md5')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'invalid_signature' })

    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()

    // safeAudit recorded the invalid-sig event.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.payu.invalid_sig',
      'Webhook',
      expect.any(String),
    )
  })

  it('rejects an invalid body `sign` field when header is absent', async () => {
    payuAdapterMock.webhookVerify.mockReturnValue(false)

    // No header — route falls back to body `sign` field.
    const req = buildReq(payuBody('ORD-2', '4', 'tx', 'body-md5-sig'), null)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'invalid_signature' })

    // The route resolved the signature from the body and passed it to the adapter.
    expect(payuAdapterMock.webhookVerify).toHaveBeenCalledWith(
      expect.any(String),
      'body-md5-sig',
    )
  })

  it('returns 500 when the adapter throws (missing credentials in prod)', async () => {
    payuAdapterMock.webhookVerify.mockImplementation(() => {
      throw new Error('PayU credentials not configured in production')
    })

    const req = buildReq({}, 'any-sig')
    const res = await POST(req)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Webhook verification configuration error')

    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.payu.config_error',
      'Webhook',
      'PayU credentials not configured in production',
    )
  })

  it('accepts a valid header signature + dispatches applyPaymentUpdate', async () => {
    payuAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(payuBody('ORD-2024-001', '4', 'payu-tx-999'), 'valid-md5')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true })

    // state_pol=4 → APPROVED, success=true
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith({
      gateway: 'payu',
      paymentId: 'payu-tx-999',
      externalReference: 'ORD-2024-001',
      status: 'APPROVED',
      success: true,
    })

    // safeAudit recorded the inbound event with the webhookId for cross-instance dedup.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.payu.inbound',
      'Webhook',
      expect.any(String),
      'wh_payu_fixed',
    )
  })

  it('accepts a valid body `sign` field when header is absent', async () => {
    payuAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(payuBody('ORD-BODY', '4', 'tx-body', 'valid-body-sig'), null)
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalReference: 'ORD-BODY', status: 'APPROVED' }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// state_pol code mapping — 4=APPROVED, 6=DECLINED, 5=EXPIRED, 7=PENDING
// ─────────────────────────────────────────────────────────────────────────────
describe('PayU webhook · state_pol code mapping', () => {
  beforeEach(() => {
    payuAdapterMock.webhookVerify.mockReturnValue(true)
  })

  it('maps state_pol=4 → APPROVED (success=true)', async () => {
    const req = buildReq(payuBody('ORD', '4'), 'sig')
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED', success: true }),
    )
  })

  it('maps state_pol=6 → DECLINED (success=false)', async () => {
    const req = buildReq(payuBody('ORD', '6'), 'sig')
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DECLINED', success: false }),
    )
  })

  it('maps state_pol=5 → EXPIRED (success=false)', async () => {
    const req = buildReq(payuBody('ORD', '5'), 'sig')
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'EXPIRED', success: false }),
    )
  })

  it('maps state_pol=7 → PENDING (success=false)', async () => {
    const req = buildReq(payuBody('ORD', '7'), 'sig')
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING', success: false }),
    )
  })

  it('passes through unknown state_pol codes (no map entry)', async () => {
    const req = buildReq(payuBody('ORD', '999'), 'sig')
    await POST(req)
    // No map entry → route uses the literal code as the canonical status.
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: '999', success: false }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Payload field aliases
// ─────────────────────────────────────────────────────────────────────────────
describe('PayU webhook · payload field aliases', () => {
  beforeEach(() => {
    payuAdapterMock.webhookVerify.mockReturnValue(true)
  })

  it('accepts referenceCode in place of reference_sale', async () => {
    const req = buildReq(
      { referenceCode: 'ORD-RC', state_pol: '4', transaction_id: 'tx' },
      'sig',
    )
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalReference: 'ORD-RC' }),
    )
  })

  it('uses reference as paymentId when transaction_id is missing', async () => {
    const req = buildReq(
      { reference_sale: 'REF-ONLY', state_pol: '4' },
      'sig',
    )
    await POST(req)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'REF-ONLY',
        externalReference: 'REF-ONLY',
      }),
    )
  })

  it('skips dispatch when reference is missing', async () => {
    const req = buildReq({ state_pol: '4', transaction_id: 'tx' }, 'sig')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    // But the inbound audit was still recorded.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.payu.inbound',
      'Webhook',
      expect.any(String),
      'wh_payu_fixed',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('PayU webhook · idempotency', () => {
  beforeEach(() => {
    payuAdapterMock.webhookVerify.mockReturnValue(true)
  })

  it('short-circuits with status=duplicate when in-memory cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildReq(payuBody('ORD', '4'), 'sig')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'duplicate' })

    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    expect(idempotencyMock.isDuplicateWebhookDB).not.toHaveBeenCalled()
  })

  it('short-circuits with status=duplicate when DB-backed cache hits', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildReq(payuBody('ORD', '4'), 'sig')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'duplicate' })

    expect(idempotencyMock.isDuplicateWebhook).toHaveBeenCalledTimes(2)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling — always ACKs 200
// ─────────────────────────────────────────────────────────────────────────────
describe('PayU webhook · error handling', () => {
  beforeEach(() => {
    payuAdapterMock.webhookVerify.mockReturnValue(true)
  })

  it('never throws when applyPaymentUpdate rejects — always ACKs 200', async () => {
    paymentUtilsMock.applyPaymentUpdate.mockRejectedValue(new Error('db down'))

    const req = buildReq(payuBody('ORD-ERR', '4'), 'sig')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true })

    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.payu.error',
      'Webhook',
      'db down',
      'wh_payu_fixed',
    )
  })

  it('handles malformed JSON bodies gracefully (ACKs 200)', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/payu', {
      method: 'POST',
      headers: { 'x-payu-signature': 'valid-sig' },
      body: 'not-json',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})
