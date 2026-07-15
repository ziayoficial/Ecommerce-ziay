// Unit tests for src/app/api/webhooks/mercadopago/route.ts
// TASK: SPRINT-TESTS-001
//
// Contract tests for the MercadoPago payment webhook:
//   - rejects invalid signatures with 200 + `{ status: 'invalid_signature' }`
//   - accepts valid signatures + verifies the payment with the gateway before
//     dispatching `applyPaymentUpdate` (defense-in-depth against spoofed
//     webhook bodies — the gateway is the source of truth for payment status)
//   - deduplicates on webhookId (in-memory + DB layers)
//   - skips dispatch for event types the route doesn't handle
//   - never throws — every error path ACKs 200 + safeAudit
//
// Mock strategy mirrors webhooks.stripe.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock MercadoPagoAdapter ────────────────────────────────────────────────
const { mpAdapterMock } = vi.hoisted(() => {
  const mock = {
    webhookVerify: vi.fn(),
    verifyPayment: vi.fn(),
    createPaymentLink: vi.fn(),
    refund: vi.fn(),
    name: 'mercadopago',
  }
  return { mpAdapterMock: mock }
})

vi.mock('@/lib/adapters/mercadopago', () => ({
  // Mock the class so `new MercadoPagoAdapter()` returns an instance whose
  // methods are the vi.fn references on `mpAdapterMock`. Per-test
  // `.mockReturnValue()` / `.mockImplementation()` calls still work because
  // the vi.fn references are stable across instances.
  //
  // NOTE: we use a real class (not `vi.fn(() => mpAdapterMock)`) because
  // arrow functions cannot be invoked with `new` — the route does
  // `new MercadoPagoAdapter()` so the mock must be constructable.
  MercadoPagoAdapter: class MockMercadoPagoAdapter {
    constructor() {
      Object.assign(this, mpAdapterMock)
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

import { POST } from '@/app/api/webhooks/mercadopago/route'

beforeEach(() => {
  vi.clearAllMocks()
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_mp_fixed')
  paymentUtilsMock.safeAudit.mockResolvedValue(undefined)
  paymentUtilsMock.applyPaymentUpdate.mockResolvedValue({ found: true, newStatus: 'paid' })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildReq(body: Record<string, unknown>, signature: string): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/mercadopago', {
    method: 'POST',
    headers: { 'x-signature': signature, 'content-type': 'application/json' },
    body: raw,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────
describe('MercadoPago webhook · signature verification', () => {
  it('rejects an invalid signature with 200 + status=invalid_signature', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(false)

    const req = buildReq(
      { type: 'payment', data: { id: '12345' } },
      'ts=bad,v1=invalid_hex',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'invalid_signature' })

    // No dispatch on invalid sig.
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    expect(mpAdapterMock.verifyPayment).not.toHaveBeenCalled()

    // safeAudit recorded the invalid-sig event for forensic review.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.mercadopago.invalid_sig',
      'Webhook',
      expect.any(String),
    )
  })

  it('returns 500 when the adapter throws (missing webhook secret in prod)', async () => {
    mpAdapterMock.webhookVerify.mockImplementation(() => {
      throw new Error('MercadoPago webhook secret not configured in production')
    })

    const req = buildReq({}, 'ts=1,v1=bad')
    const res = await POST(req)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Webhook verification configuration error')

    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.mercadopago.config_error',
      'Webhook',
      'MercadoPago webhook secret not configured in production',
    )
  })

  it('accepts a valid signature + verifies the payment + dispatches applyPaymentUpdate', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(true)
    // The route calls `adapter.verifyPayment(paymentId)` to get the canonical
    // status + external_reference (== Order.number) from the gateway.
    mpAdapterMock.verifyPayment.mockResolvedValue({
      success: true,
      status: 'approved',
      paymentId: '12345',
      amount: 15000,
      currency: 'COP',
      rawResponse: {
        external_reference: 'ORD-2024-001',
        status: 'approved',
      },
    })

    const req = buildReq(
      { type: 'payment', data: { id: '12345' }, action: 'payment.updated' },
      'ts=1700000000,v1=valid_hex',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    // verifyPayment was called with the payment id from the webhook body.
    expect(mpAdapterMock.verifyPayment).toHaveBeenCalledWith('12345')

    // applyPaymentUpdate dispatched with the canonical status from the gateway
    // (NOT the raw webhook body — the gateway is the source of truth).
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith({
      gateway: 'mercadopago',
      paymentId: '12345',
      externalReference: 'ORD-2024-001',
      status: 'approved',
      success: true,
    })

    // safeAudit recorded the inbound event with the webhookId for cross-instance dedup.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.mercadopago.inbound',
      'Webhook',
      expect.any(String),
      'wh_mp_fixed',
    )
  })

  it('dispatches for merchant_order events too', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(true)
    mpAdapterMock.verifyPayment.mockResolvedValue({
      success: false,
      status: 'pending',
      rawResponse: { external_reference: 'ORD-PENDING' },
    })

    const req = buildReq(
      { type: 'merchant_order', data: { id: 'mo-1' } },
      'ts=1,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'mercadopago',
        paymentId: 'mo-1',
        externalReference: 'ORD-PENDING',
        status: 'pending',
        success: false,
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('MercadoPago webhook · idempotency', () => {
  it('short-circuits with status=duplicate when in-memory cache hits', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(true)
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildReq(
      { type: 'payment', data: { id: 'dup-1' } },
      'ts=1,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'duplicate' })

    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    expect(mpAdapterMock.verifyPayment).not.toHaveBeenCalled()
    expect(idempotencyMock.isDuplicateWebhookDB).not.toHaveBeenCalled()
  })

  it('short-circuits with status=duplicate when DB-backed cache hits', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(true)
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildReq(
      { type: 'payment', data: { id: 'dup-db-1' } },
      'ts=2,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('duplicate')
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Event filtering + error handling
// ─────────────────────────────────────────────────────────────────────────────
describe('MercadoPago webhook · event filtering', () => {
  it('skips dispatch for event types the route does not handle', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(
      { type: 'subscription_preapproval', data: { id: 'sub-1' } },
      'ts=1,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    expect(mpAdapterMock.verifyPayment).not.toHaveBeenCalled()
    // But the inbound audit was still recorded.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.mercadopago.inbound',
      'Webhook',
      expect.any(String),
      'wh_mp_fixed',
    )
  })

  it('skips dispatch when paymentId is missing', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(
      { type: 'payment', data: {} },
      'ts=1,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })

  it('never throws when verifyPayment rejects — always ACKs 200', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(true)
    mpAdapterMock.verifyPayment.mockRejectedValue(new Error('MP API down'))

    const req = buildReq(
      { type: 'payment', data: { id: 'p-err' } },
      'ts=1,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.mercadopago.error',
      'Webhook',
      'MP API down',
      'wh_mp_fixed',
    )
  })

  it('handles malformed JSON bodies gracefully (ACKs 200)', async () => {
    mpAdapterMock.webhookVerify.mockReturnValue(true)

    const req = new NextRequest('http://localhost/api/webhooks/mercadopago', {
      method: 'POST',
      headers: { 'x-signature': 'ts=1,v1=valid' },
      body: 'not-json',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})
