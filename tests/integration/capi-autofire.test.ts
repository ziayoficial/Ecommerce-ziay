// Integration tests for CAPI auto-fire on payment webhook.
// TASK: SPRINT-INTEGRATION-TESTS-001 · §4
//
// End-to-end flow (study §14.4 closed-loop CAPI):
//   Wompi webhook
//     → adapter.webhookVerify (HMAC)
//     → idempotency (in-memory + DB layers)
//     → applyPaymentUpdate (payment-webhook-utils.ts)
//         → db.order.findFirst by paymentRef
//         → db.$transaction(order.update + orderEvent.create)
//         → fireCapiPurchaseEvent (capi-auto-fire.ts)  [fire-and-forget]
//             → db.order.findUnique (with items + customer)
//             → db.pixelConfig.findMany (active pixels)
//             → db.conversionEvent.create (one row per pixel, status=pending)
//             → enqueue('capi-fire', { ...pixels, eventIds })
//     → safeAudit + 200 ACK
//
// Strategy: do NOT mock applyPaymentUpdate / fireCapiPurchaseEvent — let the
// real chain run against a mocked db + mocked queue so the integration
// between the 3 modules is verified. The Wompi adapter + idempotency + db +
// queue are mocked at the boundary.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock WompiAdapter ──────────────────────────────────────────────────────
const { wompiAdapterMock } = vi.hoisted(() => ({
  wompiAdapterMock: {
    webhookVerify: vi.fn(),
    name: 'wompi',
  },
}))
vi.mock('@/lib/adapters/wompi', () => ({
  WompiAdapter: class MockWompiAdapter {
    constructor() {
      Object.assign(this, wompiAdapterMock)
    }
  },
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

// ── Mock db (every model touched by the chain) ────────────────────────────
const { dbMock } = vi.hoisted(() => {
  // The `tx` object passed to $transaction needs `order.update` +
  // `orderEvent.create` (the two writes applyPaymentUpdate performs).
  const tx = {
    order: { update: vi.fn() },
    orderEvent: { create: vi.fn() },
  }
  return {
    dbMock: {
      auditLog: { create: vi.fn() },
      order: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      orderEvent: { create: vi.fn() },
      pixelConfig: { findMany: vi.fn() },
      conversionEvent: { create: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  }
})
vi.mock('@/lib/db', () => ({ db: dbMock }))

// ── Mock queue.enqueue (so no BullMQ / Redis side effects) ────────────────
const { queueMock } = vi.hoisted(() => ({
  queueMock: { enqueue: vi.fn() },
}))
vi.mock('@/lib/queue', () => ({
  enqueue: queueMock.enqueue,
  // The capi-auto-fire module doesn't use these, but other imports might.
  registerJobHandler: vi.fn(),
  initQueue: vi.fn(async () => undefined),
  isInlineMode: vi.fn(() => true),
  RETENTION_QUEUE_NAME: 'retention-cleanup',
}))

// ── Mock logger + Sentry ──────────────────────────────────────────────────
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

// Import AFTER mocks take effect.
import { POST as wompiWebhookPost } from '@/app/api/webhooks/wompi/route'
import { applyPaymentUpdate } from '@/lib/adapters/payment-webhook-utils'
import { fireCapiPurchaseEvent, hashPii } from '@/lib/attribution/capi-auto-fire'

beforeEach(() => {
  vi.clearAllMocks()

  vi.stubEnv('NODE_ENV', 'development')

  // Default: valid signature, not a duplicate.
  wompiAdapterMock.webhookVerify.mockReturnValue(true)
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_wompi_test')

  dbMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  dbMock.__tx.order.update.mockResolvedValue({})
  dbMock.__tx.orderEvent.create.mockResolvedValue({})
  // Default: no order found — applyPaymentUpdate short-circuits with
  // `{ found: false }`. Individual tests override this.
  dbMock.order.findFirst.mockResolvedValue(null)
  dbMock.order.findUnique.mockResolvedValue(null)
  dbMock.pixelConfig.findMany.mockResolvedValue([])
  dbMock.conversionEvent.create.mockResolvedValue({ id: 'ce-1' })
  queueMock.enqueue.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Helpers ───────────────────────────────────────────────────────────────
function buildWompiReq(body: unknown, signature = 'valid-sig'): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/wompi', {
    method: 'POST',
    headers: {
      'x-events-signature': signature,
      'content-type': 'application/json',
    },
    body: raw,
  })
}

/** Canonical Wompi `transaction.updated` webhook payload. */
function wompiApprovedPayload(txId = 'wompi-tx-1', reference = 'ORD-2024-001') {
  return {
    event: 'transaction.updated',
    data: {
      transaction: {
        id: txId,
        status: 'APPROVED',
        reference,
        amount_in_cents: 8000000,
        currency: 'COP',
      },
    },
  }
}

function flushMicrotasks() {
  // fireCapiPurchaseEvent is invoked fire-and-forget inside
  // applyPaymentUpdate — flush the microtask queue so the call resolves
  // before we assert on it.
  return new Promise((r) => setTimeout(r, 0))
}

// ─────────────────────────────────────────────────────────────────────────────
// §4.1 — End-to-end: Wompi webhook → applyPaymentUpdate → fireCapiPurchaseEvent
// ─────────────────────────────────────────────────────────────────────────────
describe('CAPI auto-fire · end-to-end Wompi webhook → CAPI enqueue', () => {
  it('marks order paid + fires CAPI for every active pixel + enqueues capi-fire job', async () => {
    // ── Order found by paymentRef, currently unpaid ───────────────────────
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1',
      tenantId: 'ten-1',
      number: 'ORD-2024-001',
      paymentStatus: 'unpaid', // ← NOT already paid → CAPI will fire
      paidAt: null,
      total: 80000,
      currency: 'COP',
      paymentRef: null,
      paymentGateway: null,
    })

    // ── fireCapiPurchaseEvent: order loaded with items + customer ─────────
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      tenantId: 'ten-1',
      number: 'ORD-2024-001',
      total: 80000,
      currency: 'COP',
      clickId: 'cta_meta_abc',
      sourceAdId: 'ad-1',
      sourceCampaign: 'camp-1',
      sourcePlatform: 'meta',
      items: [{ id: 'oi-1', name: 'Pijama', quantity: 1, unitPrice: 80000 }],
      customer: {
        id: 'cust-1',
        email: 'maria@test.co',
        phone: '573001112233',
      },
    })

    // ── Two active pixels for the tenant (Meta + Google) ──────────────────
    dbMock.pixelConfig.findMany.mockResolvedValue([
      {
        id: 'px-meta',
        platform: 'meta',
        pixelId: 'meta-pixel-1',
        apiToken: 'meta-token-1',
        testMode: false,
        active: true,
      },
      {
        id: 'px-google',
        platform: 'google',
        pixelId: 'G-XXX',
        apiToken: 'google-secret',
        testMode: false,
        active: true,
      },
    ])

    // ── conversionEvent.create returns a row per pixel ────────────────────
    dbMock.conversionEvent.create
      .mockResolvedValueOnce({ id: 'ce-meta' })
      .mockResolvedValueOnce({ id: 'ce-google' })

    // ── Fire the webhook ──────────────────────────────────────────────────
    const req = buildWompiReq(wompiApprovedPayload())
    const res = await wompiWebhookPost(req)

    // ── Webhook always ACKs 200 ───────────────────────────────────────────
    expect(res.status).toBe(200)

    // ── applyPaymentUpdate found the order via paymentRef/number ──────────
    expect(dbMock.order.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { paymentRef: 'wompi-tx-1' },
          { paymentRef: 'ORD-2024-001' },
          { number: 'ORD-2024-001' },
        ],
      },
    })

    // ── The $transaction was invoked (order.update + orderEvent.create) ───
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1)
    expect(dbMock.__tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        paymentStatus: 'paid',
        paidAt: expect.any(Date),
        paymentRef: 'wompi-tx-1',
        paymentGateway: 'wompi',
      }),
    })
    expect(dbMock.__tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        type: 'paid',
        note: expect.stringContaining('wompi webhook'),
      }),
    })

    // ── fireCapiPurchaseEvent ran (async — flush microtasks) ──────────────
    await flushMicrotasks()

    // ── Order reloaded with items + customer ──────────────────────────────
    expect(dbMock.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      include: { items: true, customer: true },
    })

    // ── Active pixels fetched for the tenant ──────────────────────────────
    expect(dbMock.pixelConfig.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', active: true },
    })

    // ── One ConversionEvent row created PER pixel (status=pending) ────────
    expect(dbMock.conversionEvent.create).toHaveBeenCalledTimes(2)
    expect(dbMock.conversionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        pixelConfigId: 'px-meta',
        eventType: 'Purchase',
        value: 80000,
        currency: 'COP',
        status: 'pending',
        response: expect.stringContaining('"clickId":"cta_meta_abc"'),
      }),
    })
    expect(dbMock.conversionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pixelConfigId: 'px-google',
        eventType: 'Purchase',
      }),
    })

    // ── capi-fire job enqueued with the pixel configs + event IDs ─────────
    expect(queueMock.enqueue).toHaveBeenCalledWith(
      'capi-fire',
      expect.objectContaining({
        tenantId: 'ten-1',
        eventType: 'Purchase',
        value: 80000,
        currency: 'COP',
        pixels: expect.arrayContaining([
          expect.objectContaining({
            id: 'px-meta',
            platform: 'meta',
            pixelId: 'meta-pixel-1',
            apiToken: 'meta-token-1',
            testMode: false,
          }),
          expect.objectContaining({ id: 'px-google', platform: 'google' }),
        ]),
        eventIds: ['ce-meta', 'ce-google'],
      }),
    )
  })

  it('skips CAPI fire when the order was already paid (idempotency guard)', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-paid-earlier',
      tenantId: 'ten-1',
      number: 'ORD-2024-002',
      paymentStatus: 'paid', // ← ALREADY paid — CAPI must NOT fire again
      paidAt: new Date('2024-01-01'),
      total: 50000,
      currency: 'COP',
      paymentRef: 'prev-tx',
      paymentGateway: 'wompi',
    })

    const req = buildWompiReq(wompiApprovedPayload('wompi-tx-2', 'ORD-2024-002'))
    const res = await wompiWebhookPost(req)
    await flushMicrotasks()

    expect(res.status).toBe(200)
    // ── Order was updated (re-stamping paymentRef / paymentGateway) ────────
    expect(dbMock.__tx.order.update).toHaveBeenCalled()
    // ── But CAPI fire was NOT called (wasAlreadyPaid=true) ─────────────────
    expect(dbMock.order.findUnique).not.toHaveBeenCalled()
    expect(dbMock.pixelConfig.findMany).not.toHaveBeenCalled()
    expect(dbMock.conversionEvent.create).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('still ACKs 200 when the order is not found (no CAPI fire, no crash)', async () => {
    dbMock.order.findFirst.mockResolvedValue(null) // not found

    const req = buildWompiReq(wompiApprovedPayload('wompi-tx-3', 'ORD-UNKNOWN'))
    const res = await wompiWebhookPost(req)
    await flushMicrotasks()

    expect(res.status).toBe(200)
    // No transaction, no CAPI fire, no queue enqueue.
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(dbMock.conversionEvent.create).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('skips CAPI fire when the gateway status is not APPROVED (DECLINED)', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-declined',
      tenantId: 'ten-1',
      number: 'ORD-2024-003',
      paymentStatus: 'pending_payment',
      paidAt: null,
      total: 30000,
      currency: 'COP',
      paymentRef: null,
      paymentGateway: null,
    })

    const req = buildWompiReq({
      event: 'transaction.updated',
      data: {
        transaction: {
          id: 'wompi-tx-declined',
          status: 'DECLINED', // ← not APPROVED
          reference: 'ORD-2024-003',
          amount_in_cents: 3000000,
          currency: 'COP',
        },
      },
    })
    const res = await wompiWebhookPost(req)
    await flushMicrotasks()

    expect(res.status).toBe(200)
    // ── Order was updated to 'rejected' (normalizePaymentStatus) ───────────
    expect(dbMock.__tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-declined' },
      data: expect.objectContaining({
        paymentStatus: 'rejected',
        paidAt: null, // NOT paid — paidAt preserved as order.paidAt (null)
      }),
    })
    // ── OrderEvent type=payment_update (not 'paid') ────────────────────────
    expect(dbMock.__tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-declined',
        type: 'payment_update',
      }),
    })
    // ── CAPI fire NOT triggered (success=false) ────────────────────────────
    expect(dbMock.conversionEvent.create).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('does NOT fire CAPI when the tenant has no active pixels', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-no-pixels',
      tenantId: 'ten-empty',
      number: 'ORD-2024-004',
      paymentStatus: 'unpaid',
      paidAt: null,
      // AUDIT-FINTECH R-6 — the Wompi webhook now passes the gateway-reported
      // amount (8000000 cents → 80000 COP) to `applyPaymentUpdate`, which
      // refuses to mark the order paid when the amount differs from
      // `order.total` by >1%. The order total MUST match the wompi payload
      // (wompiApprovedPayload uses amount_in_cents=8000000 → 80000 major
      // unit), otherwise the test would exercise the payment_mismatch path
      // instead of the no-pixels path it's meant to verify.
      total: 80000,
      currency: 'COP',
      paymentRef: null,
      paymentGateway: null,
    })
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-no-pixels',
      tenantId: 'ten-empty',
      number: 'ORD-2024-004',
      total: 80000,
      currency: 'COP',
      items: [],
      customer: null,
    })
    dbMock.pixelConfig.findMany.mockResolvedValue([]) // ← no active pixels

    const req = buildWompiReq(wompiApprovedPayload('wompi-tx-4', 'ORD-2024-004'))
    const res = await wompiWebhookPost(req)
    await flushMicrotasks()

    expect(res.status).toBe(200)
    // ── Payment state still transitioned to paid ──────────────────────────
    expect(dbMock.__tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-no-pixels' },
      data: expect.objectContaining({ paymentStatus: 'paid' }),
    })
    // ── But no ConversionEvent rows + no queue enqueue ─────────────────────
    expect(dbMock.conversionEvent.create).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('skips CAPI fire for $0 orders (test data guard)', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-zero',
      tenantId: 'ten-1',
      number: 'ORD-2024-005',
      paymentStatus: 'unpaid',
      paidAt: null,
      total: 0, // ← $0 order — CAPI must skip
      currency: 'COP',
      paymentRef: null,
      paymentGateway: null,
    })
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-zero',
      tenantId: 'ten-1',
      number: 'ORD-2024-005',
      total: 0,
      currency: 'COP',
      items: [],
      customer: null,
    })

    const req = buildWompiReq(wompiApprovedPayload('wompi-tx-5', 'ORD-2024-005'))
    const res = await wompiWebhookPost(req)
    await flushMicrotasks()

    expect(res.status).toBe(200)
    // Payment still transitioned (the $0 guard is in capi-auto-fire, not
    // applyPaymentUpdate).
    expect(dbMock.__tx.order.update).toHaveBeenCalled()
    // CAPI fire loaded the order but skipped because total=0.
    expect(dbMock.order.findUnique).toHaveBeenCalled()
    expect(dbMock.pixelConfig.findMany).not.toHaveBeenCalled()
    expect(dbMock.conversionEvent.create).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4.2 — applyPaymentUpdate direct tests (transaction + CAPI trigger)
// ─────────────────────────────────────────────────────────────────────────────
describe('CAPI auto-fire · applyPaymentUpdate direct invocation', () => {
  it('wraps order.update + orderEvent.create in a $transaction', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-tx',
      tenantId: 'ten-1',
      paymentStatus: 'unpaid',
      paidAt: null,
      total: 100000,
      currency: 'COP',
      paymentRef: null,
      paymentGateway: null,
    })
    dbMock.order.findUnique.mockResolvedValue(null) // CAPI fire no-ops

    const result = await applyPaymentUpdate({
      gateway: 'wompi',
      paymentId: 'wompi-tx-tx',
      externalReference: 'ORD-TX',
      status: 'APPROVED',
      success: true,
    })

    expect(result.found).toBe(true)
    expect(result.orderId).toBe('order-tx')
    expect(result.newStatus).toBe('paid')

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1)
    expect(dbMock.__tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-tx' },
      data: expect.objectContaining({
        paymentStatus: 'paid',
        paymentRef: 'wompi-tx-tx',
        paymentGateway: 'wompi',
        paidAt: expect.any(Date),
      }),
    })
    expect(dbMock.__tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-tx',
        type: 'paid',
        note: expect.stringContaining('wompi webhook: status=APPROVED'),
      }),
    })
  })

  it('returns { found: false } when the order does not exist', async () => {
    dbMock.order.findFirst.mockResolvedValue(null)

    const result = await applyPaymentUpdate({
      gateway: 'wompi',
      paymentId: 'no-such-tx',
      status: 'APPROVED',
      success: true,
    })

    expect(result.found).toBe(false)
    expect(result.newStatus).toBe('paid')
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('normalizes gateway statuses (succeeded → paid, declined → rejected)', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-stripe',
      tenantId: 'ten-1',
      paymentStatus: 'pending_payment',
      paidAt: null,
      total: 50000,
      currency: 'COP',
      paymentRef: null,
      paymentGateway: null,
    })

    await applyPaymentUpdate({
      gateway: 'stripe',
      paymentId: 'pi_stripe_1',
      status: 'succeeded', // Stripe-style
      success: true,
    })

    expect(dbMock.__tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-stripe' },
      data: expect.objectContaining({
        paymentStatus: 'paid', // normalized from 'succeeded'
        paymentGateway: 'stripe',
      }),
    })
  })

  it('captures + swallows errors so the webhook still ACKs 200', async () => {
    dbMock.order.findFirst.mockRejectedValue(new Error('db down'))

    const result = await applyPaymentUpdate({
      gateway: 'wompi',
      paymentId: 'wompi-tx',
      status: 'APPROVED',
      success: true,
    })

    // Best-effort: returns found=false (no throw).
    expect(result.found).toBe(false)
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4.3 — fireCapiPurchaseEvent direct tests (ConversionEvent + queue enqueue)
// ─────────────────────────────────────────────────────────────────────────────
describe('CAPI auto-fire · fireCapiPurchaseEvent direct invocation', () => {
  function fakeOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order-capi',
      tenantId: 'ten-1',
      number: 'ORD-CAPI',
      total: 120000,
      currency: 'COP',
      clickId: 'cta_test_123',
      sourceAdId: 'ad-test',
      sourceCampaign: 'camp-test',
      sourcePlatform: 'meta',
      items: [
        { id: 'oi-1', name: 'Pijama', quantity: 2, unitPrice: 60000 },
      ],
      customer: {
        id: 'cust-1',
        email: 'maria@test.co',
        phone: '573001112233',
      },
      ...overrides,
    }
  }

  it('creates one ConversionEvent per active pixel + enqueues capi-fire', async () => {
    dbMock.order.findUnique.mockResolvedValue(fakeOrder())
    dbMock.pixelConfig.findMany.mockResolvedValue([
      {
        id: 'px-meta',
        platform: 'meta',
        pixelId: 'meta-pixel-1',
        apiToken: 'meta-token-1',
        testMode: false,
        active: true,
      },
      {
        id: 'px-google',
        platform: 'google',
        pixelId: 'G-XXX',
        apiToken: 'google-secret',
        testMode: false,
        active: true,
      },
      {
        id: 'px-tiktok',
        platform: 'tiktok',
        pixelId: 'TT-YYY',
        apiToken: 'tt-secret',
        testMode: true,
        active: true,
      },
    ])
    dbMock.conversionEvent.create
      .mockResolvedValueOnce({ id: 'ce-meta' })
      .mockResolvedValueOnce({ id: 'ce-google' })
      .mockResolvedValueOnce({ id: 'ce-tiktok' })

    await fireCapiPurchaseEvent('order-capi', 'ten-1')

    // ── 3 ConversionEvent rows created (one per pixel) ────────────────────
    expect(dbMock.conversionEvent.create).toHaveBeenCalledTimes(3)

    // ── Each row stores attribution metadata as JSON in `response` ────────
    expect(dbMock.conversionEvent.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        tenantId: 'ten-1',
        pixelConfigId: 'px-meta',
        eventType: 'Purchase',
        value: 120000,
        currency: 'COP',
        status: 'pending',
        response: expect.any(String),
      }),
    })

    // The `response` JSON contains clickId + hashed PII (privacy-safe).
    const firstResponse = dbMock.conversionEvent.create.mock.calls[0][0].data
      .response as string
    const parsed = JSON.parse(firstResponse)
    expect(parsed.clickId).toBe('cta_test_123')
    expect(parsed.sourceAdId).toBe('ad-test')
    expect(parsed.eventId).toBe('order-order-capi-meta')
    expect(parsed.customerEmailHash).toBe(hashPii('maria@test.co'))
    expect(parsed.customerPhoneHash).toBe(hashPii('573001112233'))
    expect(parsed.itemCount).toBe(1)
    expect(parsed.origin).toBe('payment-webhook-auto-fire')

    // ── Single capi-fire job enqueued with all 3 pixel configs + 3 IDs ────
    expect(queueMock.enqueue).toHaveBeenCalledTimes(1)
    expect(queueMock.enqueue).toHaveBeenCalledWith(
      'capi-fire',
      expect.objectContaining({
        tenantId: 'ten-1',
        eventType: 'Purchase',
        value: 120000,
        currency: 'COP',
        pixels: expect.arrayContaining([
          expect.objectContaining({ id: 'px-meta', platform: 'meta' }),
          expect.objectContaining({ id: 'px-google', platform: 'google' }),
          expect.objectContaining({ id: 'px-tiktok', platform: 'tiktok' }),
        ]),
        eventIds: ['ce-meta', 'ce-google', 'ce-tiktok'],
      }),
    )
  })

  it('skips CAPI fire when order.total <= 0 (test data guard)', async () => {
    dbMock.order.findUnique.mockResolvedValue(fakeOrder({ total: 0 }))
    dbMock.pixelConfig.findMany.mockResolvedValue([
      { id: 'px-1', platform: 'meta', pixelId: 'p', apiToken: 't', testMode: false, active: true },
    ])

    await fireCapiPurchaseEvent('order-zero', 'ten-1')

    expect(dbMock.pixelConfig.findMany).not.toHaveBeenCalled()
    expect(dbMock.conversionEvent.create).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('skips CAPI fire when no active pixels exist for the tenant', async () => {
    dbMock.order.findUnique.mockResolvedValue(fakeOrder())
    dbMock.pixelConfig.findMany.mockResolvedValue([])

    await fireCapiPurchaseEvent('order-capi', 'ten-empty')

    expect(dbMock.conversionEvent.create).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('no-ops gracefully when the order is not found', async () => {
    dbMock.order.findUnique.mockResolvedValue(null)

    await fireCapiPurchaseEvent('order-missing', 'ten-1')

    expect(dbMock.pixelConfig.findMany).not.toHaveBeenCalled()
    expect(dbMock.conversionEvent.create).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('captures + swallows errors so the payment webhook still ACKs 200', async () => {
    dbMock.order.findUnique.mockRejectedValue(new Error('db down'))

    // The function must NOT throw — payment webhooks must still ACK 200.
    await expect(
      fireCapiPurchaseEvent('order-fail', 'ten-1'),
    ).resolves.toBeUndefined()

    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('handles customer with null email/phone (no PII hashing attempted)', async () => {
    dbMock.order.findUnique.mockResolvedValue(
      fakeOrder({ customer: { id: 'cust-1', email: null, phone: null } }),
    )
    dbMock.pixelConfig.findMany.mockResolvedValue([
      { id: 'px-meta', platform: 'meta', pixelId: 'p', apiToken: 't', testMode: false, active: true },
    ])
    dbMock.conversionEvent.create.mockResolvedValue({ id: 'ce-1' })

    await fireCapiPurchaseEvent('order-capi', 'ten-1')

    const responseJson = JSON.parse(
      dbMock.conversionEvent.create.mock.calls[0][0].data.response as string,
    )
    expect(responseJson.customerEmailHash).toBeNull()
    expect(responseJson.customerPhoneHash).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4.4 — hashPii (privacy-safe PII hashing for CAPI user_data)
// ─────────────────────────────────────────────────────────────────────────────
describe('CAPI auto-fire · hashPii (SHA-256 PII hashing)', () => {
  it('returns a lowercase hex SHA-256 of the trimmed+lowercased value', () => {
    const result = hashPii('Maria@Test.CO')
    // SHA-256 of 'maria@test.co' (lowercased + trimmed) — verified via
    // `echo -n 'maria@test.co' | sha256sum`.
    expect(result).toBe(
      '1eedb18ef9ea3cbcf4910fb7db6ba4fe13bf6d952ab48aa748c9f9420d48a8aa',
    )
    expect(result).toMatch(/^[a-f0-9]{64}$/)
  })

  it('trims whitespace before hashing', () => {
    expect(hashPii('  maria@test.co  ')).toBe(hashPii('maria@test.co'))
  })

  it('produces different hashes for different inputs (no collisions)', () => {
    expect(hashPii('a@b.co')).not.toBe(hashPii('a@b.com'))
  })
})
