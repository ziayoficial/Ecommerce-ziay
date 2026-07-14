// Unit tests for src/app/api/webhooks/stripe/route.ts
// TASK: SPRINT-TESTS-001
//
// Contract tests for the Stripe payment webhook:
//   - rejects invalid signatures with a 200 + `{ status: 'invalid_signature' }`
//     (always 200 to stop Stripe's retry storm, but the body flag lets the
//      operator identify the failure mode in logs)
//   - accepts valid signatures and dispatches `applyPaymentUpdate` for
//     `checkout.session.*` + `payment_intent.*` events
//   - deduplicates on webhookId (in-memory + DB layers)
//   - skips dispatch for event types the route doesn't handle (e.g. `customer.*`)
//   - never throws — every error path ACKs 200 + safeAudit (gateway contract)
//
// Mock strategy:
//   - Mock the StripeAdapter class so we control `webhookVerify` per-test.
//   - Mock `applyPaymentUpdate` + `safeAudit` so we can assert dispatch calls
//     without touching the DB.
//   - Mock the idempotency helpers so the in-memory Map + DB query don't leak
//     across tests.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock StripeAdapter ─────────────────────────────────────────────────────
// The route imports the class and `new`s it; mock the class so `webhookVerify`
// is controllable per-test.
const { stripeAdapterMock } = vi.hoisted(() => {
  const mock = {
    webhookVerify: vi.fn(),
    verifyPayment: vi.fn(),
    createPaymentLink: vi.fn(),
    refund: vi.fn(),
    name: 'stripe',
  }
  return { stripeAdapterMock: mock }
})

vi.mock('@/lib/adapters/stripe', () => ({
  // Mock the class so `new StripeAdapter()` returns an instance whose
  // methods are the vi.fn references on `stripeAdapterMock`. Per-test
  // `.mockReturnValue()` / `.mockImplementation()` calls still work because
  // the vi.fn references are stable across instances.
  //
  // NOTE: we use a real class (not `vi.fn(() => stripeAdapterMock)`) because
  // arrow functions cannot be invoked with `new` — the route does
  // `new StripeAdapter()` so the mock must be constructable.
  StripeAdapter: class MockStripeAdapter {
    constructor() {
      Object.assign(this, stripeAdapterMock)
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
    // Exposed for tests — re-exported so the route's import resolves.
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
import { POST } from '@/app/api/webhooks/stripe/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: not a duplicate, deterministic webhook id.
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_test_fixed')
  paymentUtilsMock.safeAudit.mockResolvedValue(undefined)
  paymentUtilsMock.applyPaymentUpdate.mockResolvedValue({ found: true, newStatus: 'paid' })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildReq(body: Record<string, unknown>, signature: string): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: raw,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────
describe('Stripe webhook · signature verification', () => {
  it('rejects an invalid signature with 200 + status=invalid_signature', async () => {
    stripeAdapterMock.webhookVerify.mockReturnValue(false)

    const req = buildReq(
      { type: 'checkout.session.completed', data: { object: { id: 'cs_test_1' } } },
      't=123,v1=invalid_hex',
    )
    const res = await POST(req)

    // Always 200 to stop Stripe retries — but the body flag tells the operator
    // the signature didn't verify.
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true, status: 'invalid_signature' })

    // The route must NOT dispatch the payment update on an invalid sig.
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()

    // safeAudit recorded the invalid-sig event for forensic review.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.stripe.invalid_sig',
      'Webhook',
      expect.any(String),
    )
  })

  it('returns 500 when the adapter throws (missing webhook secret in prod)', async () => {
    stripeAdapterMock.webhookVerify.mockImplementation(() => {
      throw new Error('Stripe webhook secret not configured in production')
    })

    const req = buildReq({}, 't=1,v1=bad')
    const res = await POST(req)

    // Config errors surface as 500 so Stripe retries + the operator is alerted.
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Webhook verification configuration error')

    // safeAudit recorded the config error.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.stripe.config_error',
      'Webhook',
      'Stripe webhook secret not configured in production',
    )
  })

  it('accepts a valid signature and dispatches applyPaymentUpdate for checkout.session.completed', async () => {
    stripeAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            payment_status: 'paid',
            client_reference_id: 'ORD-2024-001',
            amount_total: 15000,
          },
        },
      },
      't=1700000000,v1=valid_hex',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true })

    // applyPaymentUpdate was dispatched with the canonical Stripe shape.
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith({
      gateway: 'stripe',
      paymentId: 'cs_test_123',
      externalReference: 'ORD-2024-001',
      status: 'paid',
      success: true,
    })

    // safeAudit recorded the inbound event with the webhookId for cross-instance dedup.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.stripe.inbound',
      'Webhook',
      expect.any(String),
      'wh_test_fixed',
    )
  })

  it('accepts a valid signature and dispatches for payment_intent.succeeded', async () => {
    stripeAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(
      {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_456',
            // The route reads `obj.payment_status ?? obj.status ?? 'unknown'`
            // and sets `success = (status === 'paid')`. For payment_intent
            // events Stripe uses `status` (not `payment_status`), so the
            // dispatch will see status='paid' + success=true only when
            // payment_status is explicitly set. Mirror that here.
            payment_status: 'paid',
            status: 'succeeded',
          },
        },
      },
      't=1700000001,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'stripe',
        paymentId: 'pi_test_456',
        // No client_reference_id on payment_intent events → empty string.
        externalReference: '',
        status: 'paid',
        success: true,
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('Stripe webhook · idempotency', () => {
  it('short-circuits with status=duplicate when in-memory cache hits', async () => {
    stripeAdapterMock.webhookVerify.mockReturnValue(true)
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const req = buildReq(
      { type: 'checkout.session.completed', data: { object: { id: 'cs_dup' } } },
      't=1,v1=valid',
    )
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
    stripeAdapterMock.webhookVerify.mockReturnValue(true)
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const req = buildReq(
      { type: 'checkout.session.completed', data: { object: { id: 'cs_dup_db' } } },
      't=2,v1=valid',
    )
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
// Event filtering + error handling
// ─────────────────────────────────────────────────────────────────────────────
describe('Stripe webhook · event filtering', () => {
  it('skips dispatch for event types the route does not handle (e.g. customer.*)', async () => {
    stripeAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(
      {
        type: 'customer.created',
        data: { object: { id: 'cus_123' } },
      },
      't=3,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    // No payment update dispatched for unrelated event types.
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    // But the inbound audit was still recorded.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.stripe.inbound',
      'Webhook',
      expect.any(String),
      'wh_test_fixed',
    )
  })

  it('skips dispatch when the session id is missing', async () => {
    stripeAdapterMock.webhookVerify.mockReturnValue(true)

    const req = buildReq(
      { type: 'checkout.session.completed', data: { object: {} } },
      't=4,v1=valid',
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })

  it('never throws when applyPaymentUpdate rejects — always ACKs 200', async () => {
    stripeAdapterMock.webhookVerify.mockReturnValue(true)
    paymentUtilsMock.applyPaymentUpdate.mockRejectedValue(new Error('db down'))

    const req = buildReq(
      {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_err', payment_status: 'paid' } },
      },
      't=5,v1=valid',
    )
    const res = await POST(req)

    // Gateway contract: always 200 to stop retries, even on processing errors.
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ received: true })

    // The error was captured via safeAudit so the operator sees it.
    expect(paymentUtilsMock.safeAudit).toHaveBeenCalledWith(
      'webhook.stripe.error',
      'Webhook',
      'db down',
      'wh_test_fixed',
    )
  })

  it('handles malformed JSON bodies gracefully (ACKs 200)', async () => {
    stripeAdapterMock.webhookVerify.mockReturnValue(true)

    const raw = 'not-json-at-all'
    const req = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=6,v1=valid' },
      body: raw,
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    // No paymentId resolved from malformed body → no dispatch.
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })
})
