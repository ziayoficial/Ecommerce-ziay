// Integration tests for the AP2 Mandate Chain.
// TASK: SPRINT-INTEGRATION-TESTS-001 · §1
//
// End-to-end flow:
//   POST /api/ap2/mandates            → Intent Mandate (signed W3C VC)
//   POST /api/ap2/mandates/cart       → Cart Mandate (linked to Intent, bounds-checked)
//   POST /api/ap2/mandates/payment    → Payment Mandate (linked to Cart, intentCartHash)
//   PATCH /api/ap2/mandates/[id]/revoke → Revokes Intent + cascades to Cart + Payment
//
// Mock strategy: vi.hoisted + vi.mock for db / auth-helpers / crypto.signing /
// governance.mandate-enforcement / logger. Route handlers are imported AFTER
// mocks are in place so the in-memory module registry serves the mocked
// implementations. Tests build real `NextRequest` objects (URL + body + headers)
// and assert on the response status + JSON shape — exercising the route's
// zod schemas, auth guards, governance pilar #1 (bounds enforcement) and
// pilar #2 (revocation cascade).
//
// SPRINT-INTEGRATION-TESTS-001 — focuses on the full chain rather than the
// per-handler unit tests already covered in tests/unit/.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock db (only the models these routes touch) ──────────────────────────
// Note: `vi.hoisted` factory must return a flat object whose keys are the
// destructured variable names. We expose the inner `tx` object as
// `dbMock.__tx` so tests can assert on cascade calls inside `$transaction`.
const { dbMock } = vi.hoisted(() => {
  const tx = {
    aP2Mandate: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  }
  return {
    dbMock: {
      aP2Mandate: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      tenant: { findUnique: vi.fn() },
      setting: { findFirst: vi.fn(), upsert: vi.fn() },
      // $transaction must invoke the callback with a `tx` object exposing the
      // same model delegates the revoke cascade uses (update + findMany +
      // updateMany). The factory is typed loosely — `tx` is the same object
      // the route's BFS cascade will see.
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      // Exposed for tests that want to assert on cascade calls.
      __tx: tx,
    },
  }
})
vi.mock('@/lib/db', () => ({ db: dbMock }))

// ── Mock auth-helpers ──────────────────────────────────────────────────────
// requireAuth returns `{ session, error }` and requireTenantAccess mirrors
// the same shape. Both must return `error: null` for the happy path so the
// route proceeds past the auth guard.
const { authMock } = vi.hoisted(() => ({
  authMock: {
    requireAuth: vi.fn(),
    requireTenantAccess: vi.fn(),
    resolveTenantId: vi.fn(),
  },
}))
vi.mock('@/lib/auth-helpers', () => authMock)

// ── Mock crypto/signing ───────────────────────────────────────────────────
// Real ed25519 keys are expensive to generate per-test. Mock the keypair +
// VC construction so tests stay deterministic + fast. The mocks match the
// real module's exported surface area so the routes import cleanly.
const { cryptoMock } = vi.hoisted(() => ({
  cryptoMock: {
    getOrCreateTenantKeypair: vi.fn(),
    getTenantPublicKey: vi.fn(),
    createW3CVC: vi.fn(),
    signVC: vi.fn(),
    verifyVC: vi.fn(),
    computeHash: vi.fn(),
    computeIntentCartHash: vi.fn(),
  },
}))
vi.mock('@/lib/crypto/signing', () => cryptoMock)

// ── Mock governance.mandate-enforcement ───────────────────────────────────
// Pilar #1 — `enforceMandateBounds` is called by the Cart route before
// creating the Cart Mandate. Mocking it lets us test both the allowed +
// violation paths without crafting real Intent Mandate rows.
const { govMock } = vi.hoisted(() => ({
  govMock: {
    enforceMandateBounds: vi.fn(),
    normalizeUcpCartToItems: vi.fn(),
    checkEscalationRules: vi.fn(),
  },
}))
vi.mock('@/lib/governance/mandate-enforcement', () => govMock)

// ── Mock logger + Sentry so tests stay quiet ──────────────────────────────
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

// Common signed-VC mock return value (a self-consistent VC shape).
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
      proofValue: 'mock-signature-base64url',
      proofPurpose: 'assertionMethod',
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  // Auth: always allow (happy path). Individual tests can override.
  authMock.requireAuth.mockResolvedValue({
    session: {
      user: {
        id: 'user-1',
        tenantId: 'ten-1',
        role: 'admin',
        email: 'test@test.co',
      },
    },
    error: null,
  })
  authMock.requireTenantAccess.mockResolvedValue({
    session: { user: { id: 'user-1', tenantId: 'ten-1', role: 'admin' } },
    error: null,
  })
  authMock.resolveTenantId.mockResolvedValue({
    session: { user: { id: 'user-1', tenantId: 'ten-1', role: 'admin' } },
    tenantId: 'ten-1',
    error: null,
  })

  // Crypto: deterministic keypair + always-valid signatures.
  cryptoMock.getOrCreateTenantKeypair.mockResolvedValue({
    publicKey: 'mock-public-pem',
    privateKey: 'mock-private-pem',
    did: 'did:ziay:ten-1',
  })
  cryptoMock.getTenantPublicKey.mockResolvedValue('mock-public-pem')
  cryptoMock.verifyVC.mockReturnValue(true)
  cryptoMock.computeHash.mockImplementation((input: string) =>
    `hash-${input.slice(0, 10)}`,
  )
  cryptoMock.computeIntentCartHash.mockImplementation(
    (a: string, b: string) => `ich-${a}-${b}`,
  )
  cryptoMock.createW3CVC.mockImplementation(
    (_did: string, type: string[], subject: Record<string, unknown>) => ({
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', ...type],
      issuer: { id: _did },
      issuanceDate: new Date().toISOString(),
      credentialSubject: subject,
    }),
  )
  cryptoMock.signVC.mockImplementation((vc: Record<string, unknown>) => ({
    ...vc,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: 'did:ziay:ten-1#keys-1',
      proofValue: 'mock-signature-base64url',
      proofPurpose: 'assertionMethod',
    },
  }))

  // Governance: default to allowed (happy path).
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
})

// ─────────────────────────────────────────────────────────────────────────────
// §1.1 — Intent Mandate creation
// ─────────────────────────────────────────────────────────────────────────────
describe('AP2 Mandate Chain · Intent Mandate creation', () => {
  it('creates a signed Intent Mandate with bounds + returns 201', async () => {
    dbMock.aP2Mandate.create.mockResolvedValue({
      id: 'mandate-intent-1',
      type: 'intent',
      tenantId: 'ten-1',
      status: 'active',
      maxAmount: 500000,
      currency: 'COP',
    })

    const { POST } = await import('@/app/api/ap2/mandates/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates', {
      tenantId: 'ten-1',
      userId: 'user-1',
      maxAmount: 500000,
      currency: 'COP',
      categoryLimits: { moda: 300000 },
      purpose: 'comprar pijamas',
    })
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.mandateId).toBe('mandate-intent-1')
    expect(data.type).toBe('intent')
    expect(data.did).toBe('did:ziay:ten-1')
    expect(data.status).toBe('active')
    // VC was constructed + signed with the tenant DID.
    expect(cryptoMock.createW3CVC).toHaveBeenCalledWith(
      'did:ziay:ten-1',
      ['AP2IntentMandate'],
      expect.objectContaining({
        userId: 'user-1',
        purpose: 'comprar pijamas',
        maxAmount: 500000,
        currency: 'COP',
      }),
    )
    expect(cryptoMock.signVC).toHaveBeenCalledTimes(1)
    // DB row was created with the signed VC payload + status=active.
    expect(dbMock.aP2Mandate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        type: 'intent',
        userId: 'user-1',
        status: 'active',
        maxAmount: 500000,
        currency: 'COP',
        signatoryDid: 'did:ziay:ten-1',
      }),
    })
  })

  it('returns 400 when required fields are missing (zod validation)', async () => {
    const { POST } = await import('@/app/api/ap2/mandates/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates', {
      tenantId: 'ten-1',
      // missing userId, purpose, maxAmount
    })
    const res = await POST(req, undefined as never)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Parámetros inválidos')
    expect(data.details).toBeDefined()
    expect(dbMock.aP2Mandate.create).not.toHaveBeenCalled()
  })

  it('returns 403 when requireTenantAccess denies (tenant mismatch)', async () => {
    const { NextResponse } = await import('next/server')
    authMock.requireTenantAccess.mockResolvedValueOnce({
      session: null,
      error: NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 }),
    })

    const { POST } = await import('@/app/api/ap2/mandates/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates', {
      tenantId: 'other-tenant',
      userId: 'user-1',
      maxAmount: 100000,
      purpose: 'test',
    })
    const res = await POST(req, undefined as never)
    expect(res.status).toBe(403)
    expect(dbMock.aP2Mandate.create).not.toHaveBeenCalled()
  })

  it('stores categoryLimits as JSON string when provided', async () => {
    dbMock.aP2Mandate.create.mockResolvedValue({ id: 'm-1', status: 'active' })

    const { POST } = await import('@/app/api/ap2/mandates/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates', {
      tenantId: 'ten-1',
      userId: 'user-1',
      maxAmount: 500000,
      currency: 'COP',
      categoryLimits: { moda: 300000, farmacia: 100000 },
      purpose: 'varios',
    })
    await POST(req, undefined as never)

    expect(dbMock.aP2Mandate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        categoryLimits: JSON.stringify({ moda: 300000, farmacia: 100000 }),
      }),
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §1.2 — Cart Mandate creation with bounds enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe('AP2 Mandate Chain · Cart Mandate bounds enforcement', () => {
  function fakeIntent(overrides: Record<string, unknown> = {}) {
    return {
      id: 'intent-1',
      type: 'intent',
      tenantId: 'ten-1',
      status: 'active',
      maxAmount: 100000,
      currency: 'COP',
      categoryLimits: null,
      expiresAt: new Date(Date.now() + 3600_000),
      vcPayload: JSON.stringify(mockSignedVc('did:ziay:ten-1', ['AP2IntentMandate'])),
      ...overrides,
    }
  }

  function validCartBody(total: number, items = 1) {
    return {
      tenantId: 'ten-1',
      intentMandateId: 'intent-1',
      cart: {
        items: Array.from({ length: items }, (_, i) => ({
          sku: `SKU-${i + 1}`,
          name: `Producto ${i + 1}`,
          quantity: 1,
          unitPrice: Math.floor(total / items),
          tax: 0,
          category: 'moda',
        })),
        totals: {
          subtotal: total,
          tax: 0,
          shipping: 0,
          discount: 0,
          total,
        },
      },
    }
  }

  it('creates a Cart Mandate within bounds and returns 201', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue(fakeIntent())
    dbMock.aP2Mandate.create.mockResolvedValue({
      id: 'cart-1',
      type: 'cart',
      status: 'active',
      parentMandateId: 'intent-1',
    })

    const { POST } = await import('@/app/api/ap2/mandates/cart/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates/cart', validCartBody(80000))
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.mandateId).toBe('cart-1')
    expect(data.type).toBe('cart')
    expect(data.parentMandateId).toBe('intent-1')
    expect(data.status).toBe('active')

    // Governance pilar #1 was invoked with the intent ID + normalized items.
    expect(govMock.enforceMandateBounds).toHaveBeenCalledWith(
      'intent-1',
      expect.arrayContaining([
        expect.objectContaining({ sku: 'SKU-1', category: 'moda' }),
      ]),
    )

    // Cart Mandate DB row was created with parentMandateId linking to the Intent.
    expect(dbMock.aP2Mandate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        type: 'cart',
        parentMandateId: 'intent-1',
        status: 'active',
        signatoryDid: 'did:ziay:ten-1',
      }),
    })
  })

  it('rejects with 403 when the cart exceeds the Intent maxAmount (governance block)', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue(fakeIntent())
    govMock.enforceMandateBounds.mockResolvedValueOnce({
      allowed: false,
      violations: ['Total 120000 excede el monto máximo autorizado 100000'],
    })

    const { POST } = await import('@/app/api/ap2/mandates/cart/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates/cart', validCartBody(120000))
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('excede los límites')
    expect(data.violations).toHaveLength(1)
    // The Cart Mandate was NOT created — governance short-circuited.
    expect(dbMock.aP2Mandate.create).not.toHaveBeenCalled()
  })

  it('returns 404 when the Intent Mandate does not exist', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue(null)

    const { POST } = await import('@/app/api/ap2/mandates/cart/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates/cart', validCartBody(50000))
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(404)
    expect(dbMock.aP2Mandate.create).not.toHaveBeenCalled()
  })

  it('returns 409 when the Intent Mandate is not active', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue(
      fakeIntent({ status: 'revoked' }),
    )

    const { POST } = await import('@/app/api/ap2/mandates/cart/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates/cart', validCartBody(50000))
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(409)
    expect(dbMock.aP2Mandate.create).not.toHaveBeenCalled()
  })

  it('returns 409 when the Intent Mandate has expired', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue(
      fakeIntent({ expiresAt: new Date(Date.now() - 60_000) }), // expired 1 min ago
    )

    const { POST } = await import('@/app/api/ap2/mandates/cart/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates/cart', validCartBody(50000))
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(409)
    expect(dbMock.aP2Mandate.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §1.3 — Payment Mandate creation (chain linking)
// ─────────────────────────────────────────────────────────────────────────────
describe('AP2 Mandate Chain · Payment Mandate creation', () => {
  it('creates a Payment Mandate linked to the Cart + Intent and returns 201', async () => {
    const cartVc = mockSignedVc('did:ziay:ten-1', ['AP2CartMandate'])
    dbMock.aP2Mandate.findUnique.mockResolvedValue({
      id: 'cart-1',
      type: 'cart',
      tenantId: 'ten-1',
      status: 'active',
      vcPayload: JSON.stringify(cartVc),
      parentMandate: {
        id: 'intent-1',
        type: 'intent',
        tenantId: 'ten-1',
        status: 'active',
        maxAmount: 100000,
        currency: 'COP',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    dbMock.aP2Mandate.create.mockResolvedValue({
      id: 'pay-1',
      type: 'payment',
      status: 'active',
      parentMandateId: 'cart-1',
    })

    const { POST } = await import('@/app/api/ap2/mandates/payment/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates/payment', {
      tenantId: 'ten-1',
      cartMandateId: 'cart-1',
      paymentMethod: {
        type: 'card',
        handler: 'com.mercadopago',
        token: 'tok_abc123',
        holder: 'Maria Perez',
      },
    })
    const res = await POST(req, undefined as never)

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.mandateId).toBe('pay-1')
    expect(data.type).toBe('payment')
    expect(data.parentMandateId).toBe('cart-1')
    expect(data.intentMandateId).toBe('intent-1')
    expect(data.intentCartHash).toBe('ich-intent-1-cart-1')
    expect(data.status).toBe('active')

    // Payment VC was constructed with intentCartHash binding Intent+Cart.
    expect(cryptoMock.createW3CVC).toHaveBeenCalledWith(
      'did:ziay:ten-1',
      ['AP2PaymentMandate'],
      expect.objectContaining({
        intentMandateId: 'intent-1',
        cartMandateId: 'cart-1',
        intentCartHash: 'ich-intent-1-cart-1',
        paymentMethod: expect.objectContaining({
          type: 'card',
          handler: 'com.mercadopago',
          // Token is hashed (not stored in cleartext).
          tokenRef: expect.any(String),
          holder: 'Maria Perez',
        }),
      }),
    )

    // Payment Mandate row linked to the Cart via parentMandateId.
    expect(dbMock.aP2Mandate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        type: 'payment',
        parentMandateId: 'cart-1',
        status: 'active',
      }),
    })
  })

  it('returns 409 when the parent Cart Mandate is revoked', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue({
      id: 'cart-1',
      type: 'cart',
      tenantId: 'ten-1',
      status: 'revoked', // already revoked
      vcPayload: '{}',
      parentMandate: { id: 'intent-1', status: 'active', type: 'intent', tenantId: 'ten-1' },
    })

    const { POST } = await import('@/app/api/ap2/mandates/payment/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates/payment', {
      tenantId: 'ten-1',
      cartMandateId: 'cart-1',
      paymentMethod: { type: 'card', handler: 'com.mercadopago', token: 'tok' },
    })
    const res = await POST(req, undefined as never)
    expect(res.status).toBe(409)
    expect(dbMock.aP2Mandate.create).not.toHaveBeenCalled()
  })

  it('returns 409 when the Intent parent is revoked (chain integrity)', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue({
      id: 'cart-1',
      type: 'cart',
      tenantId: 'ten-1',
      status: 'active',
      vcPayload: '{}',
      parentMandate: {
        id: 'intent-1',
        type: 'intent',
        tenantId: 'ten-1',
        status: 'revoked', // parent intent was revoked
      },
    })

    const { POST } = await import('@/app/api/ap2/mandates/payment/route')
    const req = buildPostReq('http://localhost/api/ap2/mandates/payment', {
      tenantId: 'ten-1',
      cartMandateId: 'cart-1',
      paymentMethod: { type: 'card', handler: 'com.mercadopago', token: 'tok' },
    })
    const res = await POST(req, undefined as never)
    expect(res.status).toBe(409)
    expect(dbMock.aP2Mandate.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §1.4 — Revocation cascade (Intent → Cart → Payment)
// ─────────────────────────────────────────────────────────────────────────────
describe('AP2 Mandate Chain · Revocation cascade', () => {
  it('revokes the Intent + cascades to Cart + Payment children in a transaction', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue({
      id: 'intent-1',
      type: 'intent',
      tenantId: 'ten-1',
      status: 'active',
    })
    // First BFS depth: Cart child found.
    dbMock.__tx.aP2Mandate.findMany
      .mockResolvedValueOnce([{ id: 'cart-1' }]) // depth 1: cart-1
      .mockResolvedValueOnce([{ id: 'pay-1' }])  // depth 2: payment under cart-1
      .mockResolvedValueOnce([])                  // depth 3: nothing under pay-1
    dbMock.__tx.aP2Mandate.update.mockResolvedValue({})
    dbMock.__tx.aP2Mandate.updateMany.mockResolvedValue({ count: 1 })

    const { PATCH } = await import('@/app/api/ap2/mandates/[id]/revoke/route')
    const req = buildPatchReq(
      'http://localhost/api/ap2/mandates/intent-1/revoke',
      { reason: 'user requested revocation' },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'intent-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.mandateId).toBe('intent-1')
    expect(data.status).toBe('revoked')
    expect(data.reason).toBe('user requested revocation')
    // NextResponse.json serializes Date → ISO string.
    expect(typeof data.revokedAt).toBe('string')
    expect(() => new Date(data.revokedAt)).not.toThrow()

    // $transaction was invoked (cascade happens inside it).
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1)

    // The root mandate was updated to 'revoked' inside the transaction.
    expect(dbMock.__tx.aP2Mandate.update).toHaveBeenCalledWith({
      where: { id: 'intent-1' },
      data: expect.objectContaining({
        status: 'revoked',
        revokedReason: 'user requested revocation',
      }),
    })

    // Cascade: child mandates were updated to 'revoked' via updateMany.
    expect(dbMock.__tx.aP2Mandate.updateMany).toHaveBeenCalled()
  })

  it('returns 404 when the mandate to revoke does not exist', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue(null)

    const { PATCH } = await import('@/app/api/ap2/mandates/[id]/revoke/route')
    const req = buildPatchReq(
      'http://localhost/api/ap2/mandates/unknown/revoke',
      { reason: 'test' },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'unknown' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(404)
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it('returns 409 when the mandate is already revoked (idempotent guard)', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue({
      id: 'intent-1',
      type: 'intent',
      tenantId: 'ten-1',
      status: 'revoked',
      revokedAt: new Date(),
      revokedReason: 'previous revocation',
    })

    const { PATCH } = await import('@/app/api/ap2/mandates/[id]/revoke/route')
    const req = buildPatchReq(
      'http://localhost/api/ap2/mandates/intent-1/revoke',
      { reason: 'try again' },
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'intent-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(409)
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it('uses default reason when none is provided in the body', async () => {
    dbMock.aP2Mandate.findUnique.mockResolvedValue({
      id: 'intent-1',
      type: 'intent',
      tenantId: 'ten-1',
      status: 'active',
    })
    dbMock.__tx.aP2Mandate.findMany.mockResolvedValue([])
    dbMock.__tx.aP2Mandate.update.mockResolvedValue({})

    const { PATCH } = await import('@/app/api/ap2/mandates/[id]/revoke/route')
    // Empty body — the route's zod schema treats `reason` as optional.
    const req = buildPatchReq(
      'http://localhost/api/ap2/mandates/intent-1/revoke',
      {},
    )
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'intent-1' }),
    } as unknown as Parameters<typeof PATCH>[1])

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.reason).toBe('Revocado por el titular')

    expect(dbMock.__tx.aP2Mandate.update).toHaveBeenCalledWith({
      where: { id: 'intent-1' },
      data: expect.objectContaining({
        revokedReason: 'Revocado por el titular',
      }),
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §1.5 — End-to-end chain (Intent → Cart → Payment → Revoke)
// ─────────────────────────────────────────────────────────────────────────────
describe('AP2 Mandate Chain · end-to-end chain integrity', () => {
  it('links Intent → Cart → Payment via parentMandateId + revokes the whole chain', async () => {
    // Step 1: create the Intent Mandate.
    dbMock.aP2Mandate.create.mockResolvedValueOnce({
      id: 'intent-e2e',
      type: 'intent',
      tenantId: 'ten-1',
      status: 'active',
      maxAmount: 100000,
      currency: 'COP',
    })
    const { POST: postIntent } = await import('@/app/api/ap2/mandates/route')
    const intentReq = buildPostReq('http://localhost/api/ap2/mandates', {
      tenantId: 'ten-1',
      userId: 'user-1',
      maxAmount: 100000,
      currency: 'COP',
      purpose: 'e2e test',
    })
    const intentRes = await postIntent(intentReq, undefined as never)
    expect(intentRes.status).toBe(201)
    const intentData = await intentRes.json()
    expect(intentData.mandateId).toBe('intent-e2e')

    // Step 2: create the Cart Mandate linked to the Intent.
    dbMock.aP2Mandate.findUnique.mockResolvedValueOnce({
      id: 'intent-e2e',
      type: 'intent',
      tenantId: 'ten-1',
      status: 'active',
      maxAmount: 100000,
      currency: 'COP',
      categoryLimits: null,
      expiresAt: new Date(Date.now() + 3600_000),
      vcPayload: JSON.stringify(mockSignedVc('did:ziay:ten-1', ['AP2IntentMandate'])),
    })
    dbMock.aP2Mandate.create.mockResolvedValueOnce({
      id: 'cart-e2e',
      type: 'cart',
      status: 'active',
      parentMandateId: 'intent-e2e',
    })
    const { POST: postCart } = await import('@/app/api/ap2/mandates/cart/route')
    const cartReq = buildPostReq('http://localhost/api/ap2/mandates/cart', {
      tenantId: 'ten-1',
      intentMandateId: 'intent-e2e',
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
        totals: { subtotal: 80000, tax: 0, shipping: 0, discount: 0, total: 80000 },
      },
    })
    const cartRes = await postCart(cartReq, undefined as never)
    expect(cartRes.status).toBe(201)
    const cartData = await cartRes.json()
    expect(cartData.parentMandateId).toBe('intent-e2e')

    // Step 3: create the Payment Mandate linked to the Cart.
    dbMock.aP2Mandate.findUnique.mockResolvedValueOnce({
      id: 'cart-e2e',
      type: 'cart',
      tenantId: 'ten-1',
      status: 'active',
      vcPayload: JSON.stringify(mockSignedVc('did:ziay:ten-1', ['AP2CartMandate'])),
      parentMandate: {
        id: 'intent-e2e',
        type: 'intent',
        tenantId: 'ten-1',
        status: 'active',
        maxAmount: 100000,
        currency: 'COP',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    dbMock.aP2Mandate.create.mockResolvedValueOnce({
      id: 'pay-e2e',
      type: 'payment',
      status: 'active',
      parentMandateId: 'cart-e2e',
    })
    const { POST: postPay } = await import('@/app/api/ap2/mandates/payment/route')
    const payReq = buildPostReq('http://localhost/api/ap2/mandates/payment', {
      tenantId: 'ten-1',
      cartMandateId: 'cart-e2e',
      paymentMethod: {
        type: 'card',
        handler: 'com.wompi',
        token: 'tok_xyz',
        holder: 'Maria Perez',
      },
    })
    const payRes = await postPay(payReq, undefined as never)
    expect(payRes.status).toBe(201)
    const payData = await payRes.json()
    expect(payData.parentMandateId).toBe('cart-e2e')
    expect(payData.intentMandateId).toBe('intent-e2e')
    // intentCartHash binds the Intent+Cart — non-repudiation.
    expect(cryptoMock.computeIntentCartHash).toHaveBeenCalledWith('intent-e2e', 'cart-e2e')

    // Step 4: revoke the Intent — cascade should reach the Cart + Payment.
    dbMock.aP2Mandate.findUnique.mockResolvedValueOnce({
      id: 'intent-e2e',
      type: 'intent',
      tenantId: 'ten-1',
      status: 'active',
    })
    dbMock.__tx.aP2Mandate.findMany
      .mockResolvedValueOnce([{ id: 'cart-e2e' }])
      .mockResolvedValueOnce([{ id: 'pay-e2e' }])
      .mockResolvedValueOnce([])
    dbMock.__tx.aP2Mandate.update.mockResolvedValue({})
    dbMock.__tx.aP2Mandate.updateMany.mockResolvedValue({ count: 2 })

    const { PATCH: patchRevoke } = await import(
      '@/app/api/ap2/mandates/[id]/revoke/route'
    )
    const revokeReq = buildPatchReq(
      'http://localhost/api/ap2/mandates/intent-e2e/revoke',
      { reason: 'e2e cascade test' },
    )
    const revokeRes = await patchRevoke(revokeReq, {
      params: Promise.resolve({ id: 'intent-e2e' }),
    } as unknown as Parameters<typeof patchRevoke>[1])

    expect(revokeRes.status).toBe(200)
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1)
    // Root update + 2 cascade levels (cart-e2e, pay-e2e).
    expect(dbMock.__tx.aP2Mandate.update).toHaveBeenCalledTimes(1)
    expect(dbMock.__tx.aP2Mandate.updateMany).toHaveBeenCalledTimes(2)
  })
})
