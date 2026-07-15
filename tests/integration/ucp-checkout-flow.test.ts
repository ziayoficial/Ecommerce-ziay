// Integration tests for the UCP Checkout state machine.
// TASK: SPRINT-INTEGRATION-TESTS-001 · §3
//
// State machine (Documento §10.1 + §11):
//   incomplete → requires_escalation → ready_for_complete → completed
//                                                            ↑
//                       └─── governance / age gate / KYC ────┘
//
// Tests:
//   §3.1  POST /api/ucp/v1/checkout          → creates session in `incomplete`
//   §3.2  PATCH .../[sessionId] { to: 'ready_for_complete' } → advances state
//   §3.3  PATCH .../[sessionId] { to: 'completed' }           → creates Order
//   §3.4  orderValue > COP 5M                → forces `requires_escalation`
//   §3.5  Mandate bounds violation on `ready_for_complete` → 403
//
// Mock strategy: vi.hoisted + vi.mock for db / auth-helpers / crypto.signing /
// governance.mandate-enforcement / compliance.kyc-gate / compliance.age-gate /
// logger / Sentry. Real `NextRequest` objects exercise the zod schema + state
// machine + governance integration.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock db ───────────────────────────────────────────────────────────────
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    ucpCheckoutSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    aP2Mandate: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    order: { create: vi.fn() },
    orderItem: { create: vi.fn() },
    orderEvent: { create: vi.fn() },
    conversation: { findUnique: vi.fn() },
    product: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

// ── Mock auth-helpers ──────────────────────────────────────────────────────
const { authMock } = vi.hoisted(() => ({
  authMock: {
    requireAuth: vi.fn(),
    requireTenantAccess: vi.fn(),
  },
}))
vi.mock('@/lib/auth-helpers', () => authMock)

// ── Mock crypto/signing ───────────────────────────────────────────────────
const { cryptoMock } = vi.hoisted(() => ({
  cryptoMock: {
    getTenantPublicKey: vi.fn(),
    verifyVC: vi.fn(),
    computeIntentCartHash: vi.fn(),
  },
}))
vi.mock('@/lib/crypto/signing', () => cryptoMock)

// ── Mock governance.mandate-enforcement ───────────────────────────────────
const { govMock } = vi.hoisted(() => ({
  govMock: {
    enforceMandateBounds: vi.fn(),
    checkEscalationRules: vi.fn(),
    normalizeUcpCartToItems: vi.fn(),
  },
}))
vi.mock('@/lib/governance/mandate-enforcement', () => govMock)

// ── Mock compliance.kyc-gate + age-gate ───────────────────────────────────
const { kycMock, ageGateMock } = vi.hoisted(() => ({
  kycMock: { requireIdentityVerification: vi.fn() },
  ageGateMock: { checkAgeGate: vi.fn(), requireParentalConsent: vi.fn() },
}))
vi.mock('@/lib/compliance/kyc-gate', () => kycMock)
vi.mock('@/lib/compliance/age-gate', () => ageGateMock)

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

// ── Helpers ───────────────────────────────────────────────────────────────
function buildPostReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildPatchReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockSignedVc(issuerDid: string, vcType: string[]) {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', ...vcType],
    issuer: { id: issuerDid },
    issuanceDate: new Date().toISOString(),
    credentialSubject: {},
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: `${issuerDid}#keys-1`,
      proofValue: 'mock-signature',
      proofPurpose: 'assertionMethod',
    },
  }
}

function validCheckoutStartBody(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'ten-1',
    agentDid: 'did:agent:alice',
    cart: {
      items: [
        {
          sku: 'SKU-1',
          name: 'Pijama',
          quantity: 1,
          unitPrice: 80000,
          tax: 0,
          category: 'moda',
        },
      ],
      totals: {
        subtotal: 80000,
        tax: 0,
        shipping: 0,
        discount: 0,
        total: 80000,
      },
      shipping: { name: 'Maria Perez', address: 'Calle 1', city: 'Bogotá', country: 'CO' },
    },
    agentCapabilities: ['dev.ucp.shopping.checkout'],
    agentPaymentHandlers: ['com.mercadopago', 'com.wompi'],
    paymentHandler: 'com.mercadopago',
    ...overrides,
  }
}

function fakeIntentMandate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    type: 'intent',
    tenantId: 'ten-1',
    status: 'active',
    userId: 'user-1',
    maxAmount: 100000,
    currency: 'COP',
    categoryLimits: null,
    expiresAt: new Date(Date.now() + 3600_000),
    vcPayload: JSON.stringify(mockSignedVc('did:ziay:ten-1', ['AP2IntentMandate'])),
    ...overrides,
  }
}

function fakeCartMandate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cart-1',
    type: 'cart',
    tenantId: 'ten-1',
    status: 'active',
    parentMandateId: 'intent-1',
    vcPayload: JSON.stringify(mockSignedVc('did:ziay:ten-1', ['AP2CartMandate'])),
    parentMandate: fakeIntentMandate(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  // Auth: always allow.
  authMock.requireAuth.mockResolvedValue({
    session: {
      user: { id: 'user-1', tenantId: 'ten-1', role: 'admin', email: 'test@test.co' },
    },
    error: null,
  })
  authMock.requireTenantAccess.mockResolvedValue({
    session: { user: { id: 'user-1', tenantId: 'ten-1', role: 'admin' } },
    error: null,
  })

  // Crypto: tenant pub key always present + VCs always verify.
  cryptoMock.getTenantPublicKey.mockResolvedValue('mock-public-pem')
  cryptoMock.verifyVC.mockReturnValue(true)
  cryptoMock.computeIntentCartHash.mockReturnValue('ich-mock')

  // Governance: default to allowed + no escalation.
  govMock.enforceMandateBounds.mockResolvedValue({
    allowed: true,
    violations: [],
  })
  govMock.normalizeUcpCartToItems.mockImplementation(
    (cart: { items?: Array<{ unitPrice: number; tax?: number; quantity: number; sku: string; name?: string; category?: string }> }) =>
      (cart.items ?? []).map((it) => ({
        sku: it.sku,
        name: it.name ?? it.sku,
        price: it.unitPrice + (it.tax ?? 0),
        quantity: it.quantity,
        category: it.category ?? 'uncategorized',
        total: (it.unitPrice + (it.tax ?? 0)) * it.quantity,
      })),
  )
  govMock.checkEscalationRules.mockReturnValue({
    shouldEscalate: false,
    shouldBlock: false,
    reasons: [],
  })

  // Age gate: customer is an adult by default.
  ageGateMock.checkAgeGate.mockResolvedValue({ allowed: true })
  ageGateMock.requireParentalConsent.mockResolvedValue({ verified: false })

  // KYC: not required by default (advance payment mode).
  kycMock.requireIdentityVerification.mockResolvedValue({
    verified: true,
    verificationId: 'kyc-1',
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.1 — POST /api/ucp/v1/checkout → creates session in `incomplete`
// ─────────────────────────────────────────────────────────────────────────────
describe('UCP checkout flow · POST creates session in incomplete state', () => {
  it('returns 201 with sessionId + state=incomplete + negotiated capabilities', async () => {
    dbMock.ucpCheckoutSession.create.mockResolvedValue({
      id: 'sess-1',
      sessionId: 'sess-uuid-1',
      state: 'incomplete',
      tenantId: 'ten-1',
      agentDid: 'did:agent:alice',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })

    const { POST } = await import('@/app/api/ucp/v1/checkout/route')
    const req = buildPostReq(
      'http://localhost/api/ucp/v1/checkout',
      validCheckoutStartBody(),
    )
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.sessionId).toBe('sess-uuid-1')
    expect(data.state).toBe('incomplete')
    // Capability intersection was returned.
    expect(data.negotiatedCapabilities).toContain('dev.ucp.shopping.checkout')
    expect(data.negotiatedPaymentHandlers).toContain('com.mercadopago')
    expect(data.paymentHandler).toBe('com.mercadopago')
    expect(data.next).toEqual({
      poll: 'GET /api/ucp/v1/checkout/sess-uuid-1',
      advance: 'PATCH /api/ucp/v1/checkout/sess-uuid-1',
    })

    // Session row created with state=incomplete + 30-min expiry.
    expect(dbMock.ucpCheckoutSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        agentDid: 'did:agent:alice',
        state: 'incomplete',
        paymentHandler: 'com.mercadopago',
        expiresAt: expect.any(Date),
      }),
    })
  })

  it('returns 422 when the agent does not support dev.ucp.shopping.checkout', async () => {
    const { POST } = await import('@/app/api/ucp/v1/checkout/route')
    const req = buildPostReq('http://localhost/api/ucp/v1/checkout', {
      ...validCheckoutStartBody(),
      agentCapabilities: ['dev.ucp.common.identity_linking'], // missing checkout
    })
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.error).toContain('dev.ucp.shopping.checkout')
    expect(dbMock.ucpCheckoutSession.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the body fails zod validation (missing cart)', async () => {
    const { POST } = await import('@/app/api/ucp/v1/checkout/route')
    const req = buildPostReq('http://localhost/api/ucp/v1/checkout', {
      tenantId: 'ten-1',
      agentDid: 'did:agent:alice',
      // missing cart
    })
    const res = await POST(req, undefined as never)
    expect(res.status).toBe(400)
    expect(dbMock.ucpCheckoutSession.create).not.toHaveBeenCalled()
  })

  it('returns 403 when requireTenantAccess denies (tenant mismatch)', async () => {
    const { NextResponse } = await import('next/server')
    authMock.requireTenantAccess.mockResolvedValueOnce({
      session: null,
      error: NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      ),
    })

    const { POST } = await import('@/app/api/ucp/v1/checkout/route')
    const req = buildPostReq('http://localhost/api/ucp/v1/checkout', {
      ...validCheckoutStartBody(),
      tenantId: 'other-tenant',
    })
    const res = await POST(req, undefined as never)
    expect(res.status).toBe(403)
    expect(dbMock.ucpCheckoutSession.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.2 — PATCH advances state to ready_for_complete
// ─────────────────────────────────────────────────────────────────────────────
describe('UCP checkout flow · PATCH advances incomplete → ready_for_complete', () => {
  function fakeSession(overrides: Record<string, unknown> = {}) {
    return {
      sessionId: 'sess-uuid-1',
      tenantId: 'ten-1',
      state: 'incomplete',
      cart: JSON.stringify({
        items: [
          {
            sku: 'SKU-1',
            name: 'Pijama',
            quantity: 1,
            unitPrice: 80000,
            tax: 0,
            category: 'moda',
          },
        ],
        totals: { subtotal: 80000, tax: 0, shipping: 0, discount: 0, total: 80000 },
      }),
      intentMandateId: null,
      cartMandateId: null,
      paymentMandateId: null,
      ...overrides,
    }
  }

  it('advances to ready_for_complete when Intent + Cart mandates are valid', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(fakeSession())
    dbMock.aP2Mandate.findUnique
      .mockResolvedValueOnce(fakeIntentMandate()) // intent lookup
      .mockResolvedValueOnce(fakeCartMandate())    // cart lookup (with parentMandate)
    dbMock.ucpCheckoutSession.update.mockResolvedValue({
      state: 'ready_for_complete',
      intentMandateId: 'intent-1',
      cartMandateId: 'cart-1',
    })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-uuid-1',
      {
        to: 'ready_for_complete',
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-uuid-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.state).toBe('ready_for_complete')
    expect(data.intentMandateId).toBe('intent-1')
    expect(data.cartMandateId).toBe('cart-1')

    // ── Governance pilar #1: enforceMandateBounds ran ─────────────────────
    expect(govMock.enforceMandateBounds).toHaveBeenCalledWith(
      'intent-1',
      expect.arrayContaining([
        expect.objectContaining({ sku: 'SKU-1', category: 'moda' }),
      ]),
    )

    // ── Governance pilar #2: checkEscalationRules ran ─────────────────────
    expect(govMock.checkEscalationRules).toHaveBeenCalledWith(
      expect.objectContaining({
        orderValue: 80000,
        category: 'moda',
        isFirstPurchase: false,
        paymentMethodChanged: false,
        failedPaymentCount: 0,
      }),
    )

    // ── VC signatures were verified against the tenant pub key ────────────
    expect(cryptoMock.verifyVC).toHaveBeenCalledTimes(2)

    // ── Session row was updated with the mandate IDs ──────────────────────
    expect(dbMock.ucpCheckoutSession.update).toHaveBeenCalledWith({
      where: { sessionId: 'sess-uuid-1' },
      data: expect.objectContaining({
        state: 'ready_for_complete',
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
      }),
    })
  })

  it('returns 409 when the session is already completed (no further transitions)', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(
      fakeSession({ state: 'completed' }),
    )

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-uuid-1',
      { to: 'ready_for_complete' },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-uuid-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(409)
    expect(dbMock.ucpCheckoutSession.update).not.toHaveBeenCalled()
  })

  it('returns 400 when Intent + Cart mandate IDs are missing', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(fakeSession())

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-uuid-1',
      { to: 'ready_for_complete' }, // no mandate IDs
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-uuid-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(400)
    expect(dbMock.ucpCheckoutSession.update).not.toHaveBeenCalled()
  })

  it('returns 400 when the Cart Mandate is not linked to the Intent (chain break)', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(fakeSession())
    dbMock.aP2Mandate.findUnique
      .mockResolvedValueOnce(fakeIntentMandate())
      .mockResolvedValueOnce(
        fakeCartMandate({ parentMandateId: 'some-other-intent' }),
      )

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-uuid-1',
      {
        to: 'ready_for_complete',
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-uuid-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(400)
    expect(dbMock.ucpCheckoutSession.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.3 — PATCH advances ready_for_complete → completed (creates Order)
// ─────────────────────────────────────────────────────────────────────────────
describe('UCP checkout flow · PATCH advances ready_for_complete → completed', () => {
  function fakeReadySession(overrides: Record<string, unknown> = {}) {
    return {
      sessionId: 'sess-uuid-1',
      tenantId: 'ten-1',
      state: 'ready_for_complete',
      cart: JSON.stringify({
        items: [
          {
            sku: 'SKU-1',
            name: 'Pijama',
            quantity: 1,
            unitPrice: 80000,
            tax: 0,
          },
        ],
        totals: { subtotal: 80000, tax: 0, shipping: 0, discount: 0, total: 80000 },
      }),
      intentMandateId: 'intent-1',
      cartMandateId: 'cart-1',
      paymentMandateId: null,
      ...overrides,
    }
  }

  it('creates an Order + OrderEvent + marks Cart + Intent as consumed', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(fakeReadySession())
    dbMock.order.create.mockResolvedValue({
      id: 'order-1',
      number: 'UCP-sess-uui',
      total: 80000,
    })
    dbMock.product.findFirst.mockResolvedValue({ id: 'prod-1' })
    dbMock.orderItem.create.mockResolvedValue({})
    dbMock.orderEvent.create.mockResolvedValue({})
    dbMock.aP2Mandate.updateMany.mockResolvedValue({ count: 2 })
    dbMock.ucpCheckoutSession.update.mockResolvedValue({
      state: 'completed',
      orderId: 'order-1',
    })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-uuid-1',
      { to: 'completed', customerId: 'cust-1' },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-uuid-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.state).toBe('completed')
    expect(data.orderId).toBe('order-1')
    expect(data.orderNumber).toBe('UCP-sess-uui')

    // ── Order row created with totals from the stored cart + retracto window ─
    expect(dbMock.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        customerId: 'cust-1',
        status: 'new',
        paymentStatus: 'unpaid',
        paymentMode: 'advance',
        subtotal: 80000,
        total: 80000,
        currency: 'COP',
        origen: 'ucp_agent',
        retractoWindowUntil: expect.any(Date),
      }),
    })

    // ── OrderItem created for the SKU (matched against the catalog) ────────
    expect(dbMock.product.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', sku: 'SKU-1' },
      select: { id: true },
    })
    expect(dbMock.orderItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        productId: 'prod-1',
        name: 'Pijama',
        quantity: 1,
        unitPrice: 80000,
      }),
    })

    // ── OrderEvent(type='created') recorded for traceability ───────────────
    expect(dbMock.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        type: 'created',
      }),
    })

    // ── Intent + Cart mandates marked as `consumed` + orderId stamped ──────
    expect(dbMock.aP2Mandate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['intent-1', 'cart-1'] } },
      data: expect.objectContaining({
        status: 'consumed',
        orderId: 'order-1',
      }),
    })

    // ── Session advanced to completed ─────────────────────────────────────
    expect(dbMock.ucpCheckoutSession.update).toHaveBeenCalledWith({
      where: { sessionId: 'sess-uuid-1' },
      data: expect.objectContaining({
        state: 'completed',
        orderId: 'order-1',
      }),
    })
  })

  it('returns 400 when customerId is missing on the completed transition', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(fakeReadySession())

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-uuid-1',
      { to: 'completed' }, // no customerId
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-uuid-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(400)
    expect(dbMock.order.create).not.toHaveBeenCalled()
  })

  it('returns 409 when the session is not yet ready_for_complete', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(
      fakeReadySession({
        state: 'incomplete',
        intentMandateId: null,
        cartMandateId: null,
      }),
    )

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-uuid-1',
      { to: 'completed', customerId: 'cust-1' },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-uuid-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(409)
    expect(dbMock.order.create).not.toHaveBeenCalled()
  })

  it('inherits clickId + sourceAdId from the conversation when conversationId is supplied', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(fakeReadySession())
    dbMock.conversation.findUnique.mockResolvedValue({
      id: 'conv-1',
      tenantId: 'ten-1',
      clickId: 'cta_inherited',
      sourceAdId: 'ad-1',
      sourceCampaign: 'camp-1',
      customerPhone: '573001112233',
    })
    dbMock.order.create.mockResolvedValue({ id: 'order-1', number: 'UCP-x' })
    dbMock.product.findFirst.mockResolvedValue(null)
    dbMock.aP2Mandate.updateMany.mockResolvedValue({ count: 2 })
    dbMock.ucpCheckoutSession.update.mockResolvedValue({ state: 'completed' })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-uuid-1',
      {
        to: 'completed',
        customerId: 'cust-1',
        conversationId: 'conv-1',
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-uuid-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(200)
    // ── Order was created with the inherited attribution fields ───────────
    expect(dbMock.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clickId: 'cta_inherited',
        sourceAdId: 'ad-1',
        sourceCampaign: 'camp-1',
        conversationId: 'conv-1',
        attributedAt: expect.any(Date),
      }),
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.4 — Escalation: orderValue > COP 5M → forces requires_escalation
// ─────────────────────────────────────────────────────────────────────────────
describe('UCP checkout flow · governance escalation (order value > COP 5M)', () => {
  function fakeSessionWithLargeCart() {
    return {
      sessionId: 'sess-large',
      tenantId: 'ten-1',
      state: 'incomplete',
      cart: JSON.stringify({
        items: [
          {
            sku: 'SKU-LUXE',
            name: 'Lujo',
            quantity: 1,
            unitPrice: 6_000_000,
            tax: 0,
            category: 'lujo',
          },
        ],
        totals: {
          subtotal: 6_000_000,
          tax: 0,
          shipping: 0,
          discount: 0,
          total: 6_000_000,
        },
      }),
      intentMandateId: null,
      cartMandateId: null,
    }
  }

  it('forces requires_escalation when orderValue >= 5M (checkEscalationRules.shouldEscalate=true)', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue(fakeSessionWithLargeCart())
    dbMock.aP2Mandate.findUnique
      .mockResolvedValueOnce(fakeIntentMandate({ maxAmount: 10_000_000 }))
      .mockResolvedValueOnce(fakeCartMandate())
    // Governance pilar #1 passes (cart is within mandate bounds)…
    govMock.enforceMandateBounds.mockResolvedValue({ allowed: true, violations: [] })
    // …but pilar #2 escalates because orderValue > 5M.
    govMock.checkEscalationRules.mockReturnValue({
      shouldEscalate: true,
      shouldBlock: false,
      reasons: ['Orden mayor a COP 5M requiere aprobación humana'],
    })
    dbMock.ucpCheckoutSession.update.mockResolvedValue({
      state: 'requires_escalation',
      continuationUrl: '/governance/escalations?sessionId=sess-large',
    })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-large',
      {
        to: 'ready_for_complete',
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-large' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.state).toBe('requires_escalation')
    expect(data.escalated).toBe(true)
    expect(data.reasons).toEqual([
      'Orden mayor a COP 5M requiere aprobación humana',
    ])
    expect(data.continuationUrl).toContain('/governance/escalations')

    // ── The session was updated with the escalation continuationUrl ────────
    expect(dbMock.ucpCheckoutSession.update).toHaveBeenCalledWith({
      where: { sessionId: 'sess-large' },
      data: expect.objectContaining({
        state: 'requires_escalation',
        continuationUrl: expect.stringContaining('/governance/escalations'),
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
      }),
    })
  })

  it('returns 403 when checkEscalationRules.shouldBlock=true (e.g. 3+ failed payments)', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue({
      sessionId: 'sess-block',
      tenantId: 'ten-1',
      state: 'incomplete',
      cart: JSON.stringify({
        items: [
          {
            sku: 'SKU-1',
            name: 'Pijama',
            quantity: 1,
            unitPrice: 50000,
            tax: 0,
            category: 'moda',
          },
        ],
        totals: { subtotal: 50000, tax: 0, shipping: 0, discount: 0, total: 50000 },
      }),
    })
    dbMock.aP2Mandate.findUnique
      .mockResolvedValueOnce(fakeIntentMandate())
      .mockResolvedValueOnce(fakeCartMandate())
    govMock.enforceMandateBounds.mockResolvedValue({ allowed: true, violations: [] })
    govMock.checkEscalationRules.mockReturnValue({
      shouldEscalate: false,
      shouldBlock: true,
      reasons: ['3 pagos fallidos bloquean la cuenta temporalmente'],
    })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-block',
      {
        to: 'ready_for_complete',
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
        failedPaymentCount: 3,
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-block' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('gobernanza')
    expect(data.reasons).toEqual([
      '3 pagos fallidos bloquean la cuenta temporalmente',
    ])
    expect(dbMock.ucpCheckoutSession.update).not.toHaveBeenCalled()
  })

  it('forces requires_escalation when the customer is a minor without parental consent (Ley 1098/2006)', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue({
      sessionId: 'sess-minor',
      tenantId: 'ten-1',
      state: 'incomplete',
      cart: JSON.stringify({
        items: [
          {
            sku: 'SKU-1',
            name: 'Pijama',
            quantity: 1,
            unitPrice: 50000,
            tax: 0,
            category: 'moda',
          },
        ],
        totals: { subtotal: 50000, tax: 0, shipping: 0, discount: 0, total: 50000 },
      }),
    })
    dbMock.aP2Mandate.findUnique
      .mockResolvedValueOnce(fakeIntentMandate())
      .mockResolvedValueOnce(fakeCartMandate())
    govMock.enforceMandateBounds.mockResolvedValue({ allowed: true, violations: [] })
    govMock.checkEscalationRules.mockReturnValue({
      shouldEscalate: false,
      shouldBlock: false,
      reasons: [],
    })
    ageGateMock.checkAgeGate.mockResolvedValue({
      allowed: false,
      isMinor: true,
      reason: 'Customer is a minor',
    })
    ageGateMock.requireParentalConsent.mockResolvedValue({ verified: false })
    dbMock.ucpCheckoutSession.update.mockResolvedValue({
      state: 'requires_escalation',
      continuationUrl: '/compliance/parental-consent?customerId=cust-minor',
    })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-minor',
      {
        to: 'ready_for_complete',
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
        customerId: 'cust-minor',
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-minor' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.state).toBe('requires_escalation')
    expect(data.escalated).toBe(true)
    expect(data.legalBasis).toContain('Ley 1098')
    expect(data.continuationUrl).toContain('/compliance/parental-consent')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.5 — Mandate bounds enforcement on ready_for_complete (pilar #1 → 403)
// ─────────────────────────────────────────────────────────────────────────────
describe('UCP checkout flow · mandate bounds enforcement (pilar #1 → 403)', () => {
  it('returns 403 when enforceMandateBounds rejects the cart (exceeds Intent maxAmount)', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue({
      sessionId: 'sess-violation',
      tenantId: 'ten-1',
      state: 'incomplete',
      cart: JSON.stringify({
        items: [
          {
            sku: 'SKU-1',
            name: 'Pijama',
            quantity: 2,
            unitPrice: 60000,
            tax: 0,
            category: 'moda',
          },
        ],
        totals: { subtotal: 120000, tax: 0, shipping: 0, discount: 0, total: 120000 },
      }),
    })
    dbMock.aP2Mandate.findUnique
      .mockResolvedValueOnce(fakeIntentMandate({ maxAmount: 100000 }))
      .mockResolvedValueOnce(fakeCartMandate())
    govMock.enforceMandateBounds.mockResolvedValue({
      allowed: false,
      violations: ['Total 120000 excede el monto máximo autorizado 100000'],
    })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-violation',
      {
        to: 'ready_for_complete',
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-violation' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('excede los límites')
    expect(data.violations).toEqual([
      'Total 120000 excede el monto máximo autorizado 100000',
    ])

    // ── Session NOT advanced — governance short-circuited ─────────────────
    expect(dbMock.ucpCheckoutSession.update).not.toHaveBeenCalled()
  })

  it('returns 400 when the Intent Mandate signature is invalid (verifyVC=false)', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue({
      sessionId: 'sess-bad-sig',
      tenantId: 'ten-1',
      state: 'incomplete',
      cart: JSON.stringify({
        items: [
          {
            sku: 'SKU-1',
            name: 'Pijama',
            quantity: 1,
            unitPrice: 50000,
            tax: 0,
            category: 'moda',
          },
        ],
        totals: { subtotal: 50000, tax: 0, shipping: 0, discount: 0, total: 50000 },
      }),
    })
    dbMock.aP2Mandate.findUnique
      .mockResolvedValueOnce(fakeIntentMandate())
      .mockResolvedValueOnce(fakeCartMandate())
    cryptoMock.verifyVC.mockReturnValue(false) // signature fails

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-bad-sig',
      {
        to: 'ready_for_complete',
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-bad-sig' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(400)
    expect(dbMock.ucpCheckoutSession.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.6 — Direct escalation path: incomplete → requires_escalation (manual)
// ─────────────────────────────────────────────────────────────────────────────
describe('UCP checkout flow · incomplete → requires_escalation (direct)', () => {
  it('advances to requires_escalation when continuationUrl is supplied', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue({
      sessionId: 'sess-esc',
      tenantId: 'ten-1',
      state: 'incomplete',
      cart: JSON.stringify({ items: [], totals: {} }),
    })
    dbMock.ucpCheckoutSession.update.mockResolvedValue({
      state: 'requires_escalation',
      continuationUrl: 'https://human-queue.example.com/case/123',
    })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-esc',
      {
        to: 'requires_escalation',
        continuationUrl: 'https://human-queue.example.com/case/123',
      },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-esc' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.state).toBe('requires_escalation')
    expect(data.continuationUrl).toBe('https://human-queue.example.com/case/123')

    expect(dbMock.ucpCheckoutSession.update).toHaveBeenCalledWith({
      where: { sessionId: 'sess-esc' },
      data: expect.objectContaining({
        state: 'requires_escalation',
        continuationUrl: 'https://human-queue.example.com/case/123',
      }),
    })
  })

  it('returns 400 when continuationUrl is missing on the requires_escalation transition', async () => {
    dbMock.ucpCheckoutSession.findUnique.mockResolvedValue({
      sessionId: 'sess-esc',
      tenantId: 'ten-1',
      state: 'incomplete',
      cart: JSON.stringify({ items: [] }),
    })

    const { PATCH } = await import(
      '@/app/api/ucp/v1/checkout/[sessionId]/route'
    )
    const req = buildPatchReq(
      'http://localhost/api/ucp/v1/checkout/sess-esc',
      { to: 'requires_escalation' }, // missing continuationUrl
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ sessionId: 'sess-esc' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(400)
    expect(dbMock.ucpCheckoutSession.update).not.toHaveBeenCalled()
  })
})
