// Webhook edge case tests.
// TASK: SPRINT-TESTS-COMPLETE-001 · §3.
//
// Edge cases NOT covered by the existing per-route webhook test files
// (webhooks.{stripe,meta,whatsapp,pix,payu,wompi,mercadopago,pse}.test.ts):
//
//   1. Stripe `payment_intent.payment_failed` — the existing stripe test
//      only covers `payment_intent.succeeded` + `checkout.session.completed`.
//      This file verifies the failed-payment path (success=false).
//
//   2. Meta batched payload (multiple `entry[]` items in one webhook) —
//      Meta can batch multiple lead/attribution events into a single
//      webhook. The Meta route persists the body to AuditLog as-is; this
//      test verifies the full batched body is audited (not just entry[0]).
//
//   3. WhatsApp image messages via the REAL parser — the existing
//      webhooks.whatsapp.test.ts mocks `parseWhatsAppInbound`, so the
//      actual image-parsing branch in the parser is not exercised
//      end-to-end. This file calls the real parser with a real Meta
//      image payload + asserts the parsed shape.
//
//   4. WhatsApp location messages via the REAL parser — same rationale
//      as #3 for the location branch.
//
//   5. PIX 3 payload envelopes — the existing pix test covers all 3
//      shapes individually. This file consolidates them into a single
//      "smoke" test that explicitly verifies the route handles all 3
//      envelope shapes (top-level, data-nested, pix-nested) in one place
//      — useful for regression protection when the envelope-unpacking
//      logic is touched.
//
//   6. PayU dual signature (header `x-payu-signature` OR body `sign`
//      field) — the existing payu test covers both paths separately.
//      This file consolidates them into a single test that exercises
//      BOTH paths with the same payload, asserting the route resolves
//      the signature from either source.
//
//   7. 3-layer idempotency (in-memory → DB AuditLog → waMessageId) —
//      the existing whatsapp test covers each layer in isolation. This
//      file verifies the precedence chain end-to-end: layer 1 short-
//      circuits before layer 2; layer 2 warms layer 1; layer 3 catches
//      the case where the same waMessageId arrives with a fresh webhookId.
//
//   8. Webhook signature rotation — old secret accepted during grace
//      period. The existing webhook-signature-rotation.test.ts only
//      verifies that `vi.stubEnv` works for setting `*_OLD` env vars.
//      This file verifies the Stripe route end-to-end: when the current
//      secret fails to verify, the route falls back to the old secret
//      (when `STRIPE_WEBHOOK_SECRET_OLD` is set) + processes the webhook.
//
// Mock strategy: mock ALL adapter + helper dependencies up-front (vi.hoisted
// + vi.mock). DO NOT mock `@/lib/adapters/whatsapp-parser` — the WhatsApp
// image/location tests need the REAL parser to exercise the parsing branches.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock StripeAdapter (class — needs to be constructable with `new`) ───────
const { stripeAdapterMock } = vi.hoisted(() => {
  const mock = {
    webhookVerify: vi.fn(),
    name: 'stripe',
  }
  return { stripeAdapterMock: mock }
})
vi.mock('@/lib/adapters/stripe', () => ({
  StripeAdapter: class MockStripeAdapter {
    constructor() {
      Object.assign(this, stripeAdapterMock)
    }
  },
}))

// ── Mock PayUAdapter (class — needs to be constructable with `new`) ─────────
const { payuAdapterMock } = vi.hoisted(() => {
  const mock = {
    webhookVerify: vi.fn(),
    name: 'payu',
  }
  return { payuAdapterMock: mock }
})
vi.mock('@/lib/adapters/payu', () => ({
  PayUAdapter: class MockPayUAdapter {
    constructor() {
      Object.assign(this, payuAdapterMock)
    }
  },
}))

// ── Mock HMAC helpers (covers verifyHmacSha256 + verifyMetaSignature) ───────
const { hmacMock } = vi.hoisted(() => ({
  hmacMock: {
    verifyHmacSha256: vi.fn(),
    verifyMetaSignature: vi.fn(),
    verifyHmacSha256Base64: vi.fn(),
  },
}))
vi.mock('@/lib/middleware/hmac', () => hmacMock)

// ── Mock payment-webhook-utils (applyPaymentUpdate + safeAudit) ─────────────
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

// ── Mock idempotency (isDuplicateWebhook + DB + generateWebhookId) ──────────
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

// ── Mock WhatsApp Cloud adapter helpers ─────────────────────────────────────
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

// ── Mock chat emit (fire-and-forget socket broadcast) ───────────────────────
const { chatEmitMock } = vi.hoisted(() => ({
  chatEmitMock: { emitToTenant: vi.fn() },
}))
vi.mock('@/lib/chat-emit', () => ({
  emitToTenant: chatEmitMock.emitToTenant,
}))

// ── Mock captureError ───────────────────────────────────────────────────────
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

// ── Mock db (covers every model the 5 webhook routes touch) ─────────────────
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    auditLog: { create: vi.fn(), findFirst: vi.fn() },
    message: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    customer: { findFirst: vi.fn(), create: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    consentRecord: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

// ── Mock the whatsapp-parser ONLY when we need to control it ────────────────
// Default: pass through to the real parser. Per-test, the WhatsApp image/
// location tests want the REAL parser, so we DON'T mock the parser at the
// file level. The existing webhooks.whatsapp.test.ts already covers the
// mocked-parser path; this file's value-add is exercising the REAL parser
// branches (image / location / batched messages).
//
// We do, however, need a controllable parser mock for the 3-layer idempotency
// test (which doesn't care about parser internals). Use vi.spyOn at runtime
// for that single test instead of a file-level mock.
import { parseWhatsAppInbound } from '@/lib/adapters/whatsapp-parser'

// Import routes AFTER the mocks take effect.
import { POST as stripePOST } from '@/app/api/webhooks/stripe/route'
import { POST as payuPOST } from '@/app/api/webhooks/payu/route'
import { POST as pixPOST } from '@/app/api/webhooks/pix/route'
import { POST as metaPOST } from '@/app/api/webhooks/meta/route'
import { POST as waPOST } from '@/app/api/webhooks/whatsapp/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Default idempotency: not a duplicate, deterministic webhookId.
  idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
  idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
  idempotencyMock.generateWebhookId.mockReturnValue('wh_edge_fixed')
  paymentUtilsMock.safeAudit.mockResolvedValue(undefined)
  paymentUtilsMock.applyPaymentUpdate.mockResolvedValue({ found: true, newStatus: 'paid' })
  // Stripe + PayU adapter: default to valid signature.
  stripeAdapterMock.webhookVerify.mockReturnValue(true)
  payuAdapterMock.webhookVerify.mockReturnValue(true)
  // HMAC: default to valid.
  hmacMock.verifyHmacSha256.mockReturnValue(true)
  hmacMock.verifyMetaSignature.mockReturnValue(true)
  // DB defaults.
  dbMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  dbMock.auditLog.findFirst.mockResolvedValue(null)
  dbMock.message.findFirst.mockResolvedValue(null) // no existing message → layer-3 dedup misses
  dbMock.message.create.mockResolvedValue({ id: 'msg-1' })
  dbMock.message.update.mockResolvedValue({})
  dbMock.customer.findFirst.mockResolvedValue(null)
  dbMock.customer.create.mockResolvedValue({ id: 'cust-1' })
  dbMock.conversation.findFirst.mockResolvedValue(null)
  dbMock.conversation.create.mockResolvedValue({ id: 'conv-1', clickId: null })
  dbMock.conversation.update.mockResolvedValue({})
  dbMock.consentRecord.findFirst.mockResolvedValue(null)
  dbMock.consentRecord.create.mockResolvedValue({})
  dbMock.consentRecord.update.mockResolvedValue({})
  dbMock.consentRecord.updateMany.mockResolvedValue({ count: 0 })
  dbMock.order.findFirst.mockResolvedValue(null)
  // WhatsApp Cloud adapter defaults.
  waCloudMock.findWhatsAppChannelByPhoneNumberId.mockResolvedValue({
    id: 'ch-1',
    tenantId: 'tenant-1',
  })
  waCloudMock.getWhatsAppAdapter.mockResolvedValue({
    markMessageRead: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue({ messageId: 'wa-out-1' }),
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function buildStripeReq(body: Record<string, unknown>, signature: string): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildPayUReq(
  body: Record<string, unknown>,
  signature: string | null,
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature !== null) headers['x-payu-signature'] = signature
  return new NextRequest('http://localhost/api/webhooks/payu', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function buildPixReq(body: Record<string, unknown>, signature = 'valid-hex'): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/pix', {
    method: 'POST',
    headers: { 'x-pix-signature': signature, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildMetaReq(body: Record<string, unknown>, signature = 'sha256=valid'): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/meta', {
    method: 'POST',
    headers: { 'x-hub-signature-256': signature, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildWAReq(body: Record<string, unknown>, signature = 'sha256=valid'): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': signature, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Stripe — payment_intent.payment_failed
// ─────────────────────────────────────────────────────────────────────────────
describe('Webhook edge cases · Stripe payment_intent.payment_failed', () => {
  it('dispatches applyPaymentUpdate with success=false for failed payment intents', async () => {
    // payment_intent.payment_failed: Stripe sets `status: 'requires_payment_method'`
    // (or similar). The route reads `obj.payment_status ?? obj.status ?? 'unknown'`
    // and computes `success = (status === 'paid')`. For a failed payment_intent,
    // status is NOT 'paid' → success=false → applyPaymentUpdate records the
    // failure on the Order (and downstream CAPI does NOT fire the Purchase event).
    const req = buildStripeReq(
      {
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_failed_001',
            status: 'requires_payment_method',
            // No `payment_status` field on payment_intent events — that's a
            // checkout.session field. The route falls back to `obj.status`.
          },
        },
      },
      't=1700000000,v1=valid_hex',
    )

    const res = await stripePOST(req)

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith({
      gateway: 'stripe',
      paymentId: 'pi_failed_001',
      externalReference: '', // no client_reference_id on payment_intent events
      status: 'requires_payment_method',
      success: false,
    })
  })

  it('dispatches with success=false when payment_intent has status=canceled', async () => {
    const req = buildStripeReq(
      {
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_canceled_001',
            status: 'canceled',
          },
        },
      },
      't=1,v1=valid',
    )

    await stripePOST(req)

    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'canceled',
        success: false,
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Meta webhook — batched payload (multiple entries in one webhook)
// ─────────────────────────────────────────────────────────────────────────────
describe('Webhook edge cases · Meta batched payload', () => {
  beforeEach(() => {
    vi.stubEnv('META_APP_SECRET', 'test-meta-app-secret')
    vi.stubEnv('NODE_ENV', 'development')
  })

  it('persists the full batched body to AuditLog when Meta sends multiple entries', async () => {
    // Meta can batch multiple ad-platform events (lead gen, attributions)
    // into a single webhook. The route persists the entire body — verify
    // the audit log records both entries (not just entry[0]).
    const batchedBody = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            {
              field: 'leadgen',
              value: {
                ad_id: 'ad-1',
                form_id: 'form-1',
                leadgen_id: 'lg-1',
                created_time: 1700000000,
              },
            },
          ],
        },
        {
          id: 'page-2',
          changes: [
            {
              field: 'leadgen',
              value: {
                ad_id: 'ad-2',
                form_id: 'form-2',
                leadgen_id: 'lg-2',
                created_time: 1700000001,
              },
            },
          ],
        },
      ],
    }

    const res = await metaPOST(buildMetaReq(batchedBody))

    expect(res.status).toBe(200)
    expect(dbMock.auditLog.create).toHaveBeenCalledTimes(1)
    const auditCall = dbMock.auditLog.create.mock.calls[0][0] as {
      data: { action: string; entity: string; metadata: string; entityId: string }
    }
    expect(auditCall.data.action).toBe('webhook.meta.inbound')
    // The metadata is the JSON-stringified body, truncated to 1000 chars.
    // Both leadgen_ids must appear in the persisted metadata.
    expect(auditCall.data.metadata).toContain('lg-1')
    expect(auditCall.data.metadata).toContain('lg-2')
    expect(auditCall.data.metadata).toContain('ad-1')
    expect(auditCall.data.metadata).toContain('ad-2')
    // The webhookId is stored as entityId for cross-instance dedup queries.
    expect(auditCall.data.entityId).toBe('wh_edge_fixed')
  })

  it('accepts a single-entry payload too (regression — batched path must not break single)', async () => {
    const singleBody = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [{ field: 'leadgen', value: { leadgen_id: 'lg-single' } }],
        },
      ],
    }

    const res = await metaPOST(buildMetaReq(singleBody))

    expect(res.status).toBe(200)
    const auditCall = dbMock.auditLog.create.mock.calls[0][0] as {
      data: { metadata: string }
    }
    expect(auditCall.data.metadata).toContain('lg-single')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3 & 4. WhatsApp parser — image + location messages via the REAL parser
// ─────────────────────────────────────────────────────────────────────────────
describe('Webhook edge cases · WhatsApp parser (real, not mocked)', () => {
  it('parses image messages: type=image, text="[Imagen] <caption>", mediaId + imageUrl set', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
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
                    id: 'wamid.img.001',
                    timestamp: '1700000000',
                    type: 'image',
                    image: {
                      id: 'media-img-001',
                      caption: 'Esto me gusta',
                      link: 'https://cdn.meta.com/img/001.jpg',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const parsed = parseWhatsAppInbound(payload)

    expect(parsed).not.toBeNull()
    expect(parsed!.type).toBe('image')
    expect(parsed!.from).toBe('573001112233')
    expect(parsed!.messageId).toBe('wamid.img.001')
    expect(parsed!.mediaId).toBe('media-img-001')
    expect(parsed!.imageUrl).toBe('https://cdn.meta.com/img/001.jpg')
    expect(parsed!.caption).toBe('Esto me gusta')
    // The text is a descriptive label for the agent inbox — caption is
    // preserved inside it.
    expect(parsed!.text).toBe('[Imagen] Esto me gusta')
    expect(parsed!.phoneNumberId).toBe('106000000000001')
  })

  it('parses image messages without a caption (text="[Imagen]")', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '106000000000001' },
                messages: [
                  {
                    from: '573001112233',
                    id: 'wamid.img.002',
                    timestamp: '1700000001',
                    type: 'image',
                    image: { id: 'media-img-002' }, // no caption, no link
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const parsed = parseWhatsAppInbound(payload)

    expect(parsed!.type).toBe('image')
    expect(parsed!.caption).toBeUndefined()
    expect(parsed!.imageUrl).toBeUndefined()
    expect(parsed!.text).toBe('[Imagen]')
  })

  it('parses location messages: type=location, text="[Ubicación] lat,lng", location set', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '106000000000001' },
                contacts: [{ wa_id: '573001112233', name: { formatted_name: 'María' } }],
                messages: [
                  {
                    from: '573001112233',
                    id: 'wamid.loc.001',
                    timestamp: '1700000002',
                    type: 'location',
                    location: {
                      latitude: 4.711,
                      longitude: -74.0721,
                      name: 'Oficina',
                      address: 'Cra 7 #1-2, Bogotá',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const parsed = parseWhatsAppInbound(payload)

    expect(parsed).not.toBeNull()
    expect(parsed!.type).toBe('location')
    expect(parsed!.from).toBe('573001112233')
    expect(parsed!.messageId).toBe('wamid.loc.001')
    expect(parsed!.location).toEqual({
      latitude: 4.711,
      longitude: -74.0721,
      name: 'Oficina',
      address: 'Cra 7 #1-2, Bogotá',
    })
    // The text label includes the lat,lng for the agent inbox.
    expect(parsed!.text).toBe('[Ubicación] 4.711,-74.0721')
  })

  it('parses location messages without name/address (minimal payload)', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '106000000000001' },
                messages: [
                  {
                    from: '573001112233',
                    id: 'wamid.loc.002',
                    timestamp: '1700000003',
                    type: 'location',
                    location: { latitude: 0, longitude: 0 },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const parsed = parseWhatsAppInbound(payload)

    expect(parsed!.type).toBe('location')
    expect(parsed!.location).toEqual({
      latitude: 0,
      longitude: 0,
      name: undefined,
      address: undefined,
    })
    expect(parsed!.text).toBe('[Ubicación] 0,0')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. PIX — 3 payload envelopes (consolidated smoke test)
// ─────────────────────────────────────────────────────────────────────────────
describe('Webhook edge cases · PIX 3 payload envelopes', () => {
  beforeEach(() => {
    vi.stubEnv('PIX_HMAC_SECRET', 'test-pix-secret')
    vi.stubEnv('NODE_ENV', 'development')
  })

  it('handles all 3 envelope shapes: top-level, data-nested, pix-nested', async () => {
    // Top-level: { txid, status, valor: { original } }
    const topLevel = {
      txid: 'tx-top',
      status: 'CONCLUIDA',
      valor: { original: '99.90' },
    }
    const res1 = await pixPOST(buildPixReq(topLevel))
    expect(res1.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenNthCalledWith(1, {
      gateway: 'pix',
      paymentId: 'tx-top',
      externalReference: 'tx-top',
      status: 'approved',
      success: true,
    })

    // data-nested: { data: { txid, status, valor: { original } } }
    const dataNested = {
      data: { txid: 'tx-data', status: 'CONCLUIDA', valor: { original: '50.00' } },
    }
    const res2 = await pixPOST(buildPixReq(dataNested))
    expect(res2.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenNthCalledWith(2, {
      gateway: 'pix',
      paymentId: 'tx-data',
      externalReference: 'tx-data',
      status: 'approved',
      success: true,
    })

    // pix-nested: { pix: { txid, status } }
    const pixNested = {
      pix: { txid: 'tx-pix', status: 'CONCLUIDA' },
    }
    const res3 = await pixPOST(buildPixReq(pixNested))
    expect(res3.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenNthCalledWith(3, {
      gateway: 'pix',
      paymentId: 'tx-pix',
      externalReference: 'tx-pix',
      status: 'approved',
      success: true,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. PayU — dual signature (header `x-payu-signature` OR body `sign` field)
// ─────────────────────────────────────────────────────────────────────────────
describe('Webhook edge cases · PayU dual signature path', () => {
  it('accepts the signature from the x-payu-signature header (canonical path)', async () => {
    const body = {
      reference_sale: 'ORD-2024-001',
      state_pol: '4',
      transaction_id: 'payu-tx-1',
      value: '150000.00',
      currency: 'COP',
    }

    const res = await payuPOST(buildPayUReq(body, 'header-sig-md5'))

    expect(res.status).toBe(200)
    expect(payuAdapterMock.webhookVerify).toHaveBeenCalledWith(
      expect.any(String), // rawBody
      'header-sig-md5', // signature resolved from the header
    )
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'payu',
        externalReference: 'ORD-2024-001',
        status: 'APPROVED',
        success: true,
      }),
    )
  })

  it('falls back to the body `sign` field when the x-payu-signature header is absent', async () => {
    const body = {
      reference_sale: 'ORD-2024-002',
      state_pol: '4',
      transaction_id: 'payu-tx-2',
      value: '200000.00',
      currency: 'COP',
      sign: 'body-sig-md5',
    }

    // Pass null for the header so the route falls back to body.sign.
    const res = await payuPOST(buildPayUReq(body, null))

    expect(res.status).toBe(200)
    expect(payuAdapterMock.webhookVerify).toHaveBeenCalledWith(
      expect.any(String), // rawBody
      'body-sig-md5', // signature resolved from body.sign
    )
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: 'ORD-2024-002',
      }),
    )
  })

  it('prefers the header signature when both header AND body.sign are present', async () => {
    const body = {
      reference_sale: 'ORD-2024-003',
      state_pol: '4',
      transaction_id: 'payu-tx-3',
      sign: 'body-sig-md5', // also present in body
    }

    await payuPOST(buildPayUReq(body, 'header-sig-md5'))

    // The route resolves `signature = headerSig || bodySig` — when both are
    // present, the header wins (short-circuit OR).
    expect(payuAdapterMock.webhookVerify).toHaveBeenCalledWith(
      expect.any(String),
      'header-sig-md5',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. 3-layer idempotency chain (in-memory → DB AuditLog → waMessageId)
// ─────────────────────────────────────────────────────────────────────────────
describe('Webhook edge cases · 3-layer idempotency chain', () => {
  beforeEach(() => {
    vi.stubEnv('META_APP_SECRET', 'test-meta-app-secret')
    vi.stubEnv('NODE_ENV', 'development')
  })

  it('layer 1 (in-memory) short-circuits before layer 2 (DB) is queried', async () => {
    // In-memory hit: isDuplicateWebhook returns true → route returns
    // 'duplicate' immediately. The DB check is NOT called.
    idempotencyMock.isDuplicateWebhook.mockReturnValue(true)

    const body = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs-1', payment_status: 'paid' } },
    }
    const res = await stripePOST(buildStripeReq(body, 't=1,v1=valid'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, status: 'duplicate' })
    expect(idempotencyMock.isDuplicateWebhookDB).not.toHaveBeenCalled()
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })

  it('layer 2 (DB AuditLog) hit warms layer 1 (in-memory) for the next retry', async () => {
    // In-memory miss → DB hit → route returns 'duplicate' AND re-warms the
    // in-memory cache so the next retry is fast-pathed.
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(true)

    const body = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs-2', payment_status: 'paid' } },
    }
    const res = await stripePOST(buildStripeReq(body, 't=2,v1=valid'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, status: 'duplicate' })
    // The DB hit re-warms the in-memory cache (isDuplicateWebhook called twice).
    expect(idempotencyMock.isDuplicateWebhook).toHaveBeenCalledTimes(2)
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
  })

  it('layer 3 (waMessageId) catches duplicates even when layers 1 + 2 miss (Meta re-signs the same payload)', async () => {
    // Scenario: Meta re-signs the same inbound message with a fresh
    // signature → webhookId (body + signature hash) differs → layers 1 + 2
    // miss → the route looks up by waMessageId in the messages table →
    // finds an existing row → returns 'duplicate_message_id'.
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
    dbMock.message.findFirst.mockResolvedValue({ id: 'existing-msg-1' })

    // Build a real WA text payload — the REAL parser will extract
    // messageId='wamid.dup.001' which the route uses for the layer-3 lookup.
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '106000000000001' },
                contacts: [{ wa_id: '573001112233', name: { formatted_name: 'María' } }],
                messages: [
                  {
                    from: '573001112233',
                    id: 'wamid.dup.001',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'duplicate test' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const res = await waPOST(buildWAReq(body))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, status: 'duplicate_message_id' })
    // The route looked up by waMessageId.
    expect(dbMock.message.findFirst).toHaveBeenCalledWith({
      where: { waMessageId: 'wamid.dup.001' },
      select: { id: true },
    })
    // No new message persisted (duplicate).
    expect(dbMock.message.create).not.toHaveBeenCalled()
  })

  it('all 3 layers miss → message is persisted (happy path through the dedup chain)', async () => {
    idempotencyMock.isDuplicateWebhook.mockReturnValue(false)
    idempotencyMock.isDuplicateWebhookDB.mockResolvedValue(false)
    dbMock.message.findFirst.mockResolvedValue(null) // no existing waMessageId

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '106000000000001' },
                contacts: [{ wa_id: '573001112233', name: { formatted_name: 'María' } }],
                messages: [
                  {
                    from: '573001112233',
                    id: 'wamid.new.001',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'fresh message' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const res = await waPOST(buildWAReq(body))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('processed')
    expect(dbMock.message.create).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. Webhook signature rotation — old secret accepted during grace period
// ─────────────────────────────────────────────────────────────────────────────
describe('Webhook edge cases · signature rotation (old secret grace period)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('Stripe route falls back to STRIPE_WEBHOOK_SECRET_OLD when the current secret fails to verify', async () => {
    // Simulate a rotation window: STRIPE_WEBHOOK_SECRET_OLD is set, the
    // current secret fails to verify, but the OLD secret verifies.
    // webhookVerify is called twice — first with the current secret (no
    // override), then with the old secret as the 3rd arg.
    vi.stubEnv('STRIPE_WEBHOOK_SECRET_OLD', 'old-stripe-secret')
    stripeAdapterMock.webhookVerify
      .mockReturnValueOnce(false) // current secret fails
      .mockReturnValueOnce(true) // old secret verifies

    const body = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_rot_001',
          payment_status: 'paid',
          client_reference_id: 'ORD-2024-ROT',
        },
      },
    }
    const res = await stripePOST(buildStripeReq(body, 't=1,v1=signed-with-old'))

    expect(res.status).toBe(200)
    // The route processed the webhook (applyPaymentUpdate was called) — the
    // old-secret fallback verified the signature.
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith({
      gateway: 'stripe',
      paymentId: 'cs_rot_001',
      externalReference: 'ORD-2024-ROT',
      status: 'paid',
      success: true,
    })
    // Verify the adapter was called twice — once with the current secret
    // (no override) and once with the old secret as the 3rd arg.
    expect(stripeAdapterMock.webhookVerify).toHaveBeenCalledTimes(2)
    expect(stripeAdapterMock.webhookVerify).toHaveBeenNthCalledWith(
      1,
      expect.any(String), // rawBody
      't=1,v1=signed-with-old', // signature
    )
    expect(stripeAdapterMock.webhookVerify).toHaveBeenNthCalledWith(
      2,
      expect.any(String), // rawBody
      't=1,v1=signed-with-old', // signature
      'old-stripe-secret', // secretOverride = old secret
    )
    // The route logged a warning so the operator knows rotation is in progress.
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Webhook verified with OLD secret — rotation in progress',
    )
  })

  it('Stripe route rejects when BOTH current + old secret fail (rotation grace period expired or wrong old secret)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET_OLD', 'old-stripe-secret')
    stripeAdapterMock.webhookVerify.mockReturnValue(false) // both attempts fail

    const body = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_bad_001', payment_status: 'paid' } },
    }
    const res = await stripePOST(buildStripeReq(body, 't=1,v1=tampered'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, status: 'invalid_signature' })
    expect(paymentUtilsMock.applyPaymentUpdate).not.toHaveBeenCalled()
    // The route tried both secrets.
    expect(stripeAdapterMock.webhookVerify).toHaveBeenCalledTimes(2)
  })

  it('PayU route falls back to PAYU_WEBHOOK_SECRET_OLD when the current key fails to verify', async () => {
    vi.stubEnv('PAYU_WEBHOOK_SECRET_OLD', 'old-payu-key')
    payuAdapterMock.webhookVerify
      .mockReturnValueOnce(false) // current key fails
      .mockReturnValueOnce(true) // old key verifies

    const body = {
      reference_sale: 'ORD-2024-ROT',
      state_pol: '4',
      transaction_id: 'payu-rot-1',
    }
    const res = await payuPOST(buildPayUReq(body, 'signed-with-old-key'))

    expect(res.status).toBe(200)
    expect(paymentUtilsMock.applyPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'payu',
        externalReference: 'ORD-2024-ROT',
        status: 'APPROVED',
        success: true,
      }),
    )
    // The adapter was called twice — current key (no override) + old key.
    expect(payuAdapterMock.webhookVerify).toHaveBeenCalledTimes(2)
    expect(payuAdapterMock.webhookVerify).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      'signed-with-old-key',
      'old-payu-key',
    )
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Webhook verified with OLD secret — rotation in progress',
    )
  })

  it('does NOT fall back when the *_OLD env var is unset (rotation not in progress)', async () => {
    // Ensure STRIPE_WEBHOOK_SECRET_OLD is unset.
    vi.stubEnv('STRIPE_WEBHOOK_SECRET_OLD', '')
    stripeAdapterMock.webhookVerify.mockReturnValue(false) // current fails

    const body = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_no_rot', payment_status: 'paid' } },
    }
    const res = await stripePOST(buildStripeReq(body, 't=1,v1=bad'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, status: 'invalid_signature' })
    // Only the current secret was tried — no fallback.
    expect(stripeAdapterMock.webhookVerify).toHaveBeenCalledTimes(1)
  })
})
