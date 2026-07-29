// Webhook signature rotation unit tests.
// SPRINT-TESTS-FINAL-001 · §2.
//
// Tests the per-adapter `webhookVerify(rawBody, signature, secretOverride?)`
// contract that powers the route-level rotation fallback:
//
//   1. Accepts a signature computed with the CURRENT secret.
//   2. Accepts a signature computed with the OLD secret during rotation
//      (passed as `secretOverride` — the route layer re-invokes
//      `webhookVerify` with `*_WEBHOOK_SECRET_OLD` when the first call
//      with the current secret returns false).
//   3. Rejects a signature computed with an UNKNOWN secret (forged
//      webhook from an attacker who doesn't know either secret).
//   4. Uses the env-configured secret when `secretOverride` is omitted
//      (the backward-compatible 2-arg path — the route layer's first
//      call uses this path).
//
// Covers all 4 payment gateways:
//   - Stripe        — HMAC-SHA256 over `<t>.<body>`, signature `t=<ts>,v1=<hex>`
//   - MercadoPago   — HMAC-SHA256 over `<ts>.<body>`, signature `ts=<ts>,v1=<hex>`
//   - Wompi         — HMAC-SHA256 over `<body>`,        signature `<hex>` (raw)
//   - PayU          — MD5 of `{apiKey}~{merchantId}~{reference}~{amount}~{currency}~{state_pol}`,
//                     rawBody is a JSON string with `reference_sale`/`value`/`currency`/`state_pol`
//
// Adapters read their credentials from `process.env` at construction time.
// Tests use `vi.stubEnv` BEFORE `new Adapter()` so the adapter's
// `private readonly` fields capture the test secret. `vi.unstubAllEnvs()`
// in `afterEach` ensures no env leakage between tests.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import crypto from 'node:crypto'

// ─── HMAC helpers ───────────────────────────────────────────────────────────

/** Compute the Stripe/MercadoPago-style `v1` HMAC over `<t>.<body>`. */
function hmacSha256Hex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex')
}

/** Compute the PayU-style MD5 signature. */
function payuMd5Hex(
  apiKey: string,
  merchantId: string,
  reference: string,
  amount: number,
  currency: string,
  state: string,
): string {
  const raw = `${apiKey}~${merchantId}~${reference}~${amount}~${currency}~${state}`
  return crypto.createHash('md5').update(raw).digest('hex')
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────────
// Stripe
// ─────────────────────────────────────────────────────────────────────────────

describe('Webhook signature rotation · Stripe', () => {
  const RAW_BODY = '{"id":"evt_1","type":"checkout.session.completed"}'
  const TS = '1700000000'

  function buildStripeSig(secret: string): string {
    return `t=${TS},v1=${hmacSha256Hex(secret, `${TS}.${RAW_BODY}`)}`
  }

  it('accepts signature computed with the CURRENT secret (env-configured)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'new-secret')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET_OLD', 'old-secret')
    // Avoid the dev-mode "no secret configured" fallback that returns true
    // for any signature — we want the real HMAC path.
    vi.stubEnv('NODE_ENV', 'production')

    const { StripeAdapter } = await import('@/lib/adapters/stripe')
    const adapter = new StripeAdapter()

    const sig = buildStripeSig('new-secret')
    // 2-arg call (no override) — uses env-configured `new-secret`.
    const valid = adapter.webhookVerify(RAW_BODY, sig)
    expect(valid).toBe(true)
  })

  it('accepts signature computed with the OLD secret via secretOverride', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'new-secret')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET_OLD', 'old-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { StripeAdapter } = await import('@/lib/adapters/stripe')
    const adapter = new StripeAdapter()

    // Forged with the OLD secret — would fail against the new secret, but
    // the route layer retries with `secretOverride = old-secret` during
    // the rotation grace period.
    const sig = buildStripeSig('old-secret')
    const validNew = adapter.webhookVerify(RAW_BODY, sig)
    expect(validNew).toBe(false) // fails against current secret

    const validOld = adapter.webhookVerify(RAW_BODY, sig, 'old-secret')
    expect(validOld).toBe(true) // succeeds with override
  })

  it('rejects signature computed with an UNKNOWN secret', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'new-secret')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET_OLD', 'old-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { StripeAdapter } = await import('@/lib/adapters/stripe')
    const adapter = new StripeAdapter()

    // Attacker forges with `evil-secret` — neither the current nor the
    // old secret matches.
    const evilSig = buildStripeSig('evil-secret')
    expect(adapter.webhookVerify(RAW_BODY, evilSig)).toBe(false)
    expect(adapter.webhookVerify(RAW_BODY, evilSig, 'old-secret')).toBe(false)
  })

  it('rejects malformed signature header (missing v1)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'new-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { StripeAdapter } = await import('@/lib/adapters/stripe')
    const adapter = new StripeAdapter()

    expect(adapter.webhookVerify(RAW_BODY, 't=123')).toBe(false)
    expect(adapter.webhookVerify(RAW_BODY, '')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// MercadoPago
// ─────────────────────────────────────────────────────────────────────────────

describe('Webhook signature rotation · MercadoPago', () => {
  const RAW_BODY = '{"id":12345,"type":"payment","data":{"id":"pay_1"}}'
  const TS = '1700000000'

  function buildMpSig(secret: string): string {
    return `ts=${TS},v1=${hmacSha256Hex(secret, `${TS}.${RAW_BODY}`)}`
  }

  it('accepts signature computed with the CURRENT secret (env-configured)', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'new-mp-secret')
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET_OLD', 'old-mp-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { MercadoPagoAdapter } = await import('@/lib/adapters/mercadopago')
    const adapter = new MercadoPagoAdapter()

    const sig = buildMpSig('new-mp-secret')
    expect(adapter.webhookVerify(RAW_BODY, sig)).toBe(true)
  })

  it('accepts signature computed with the OLD secret via secretOverride', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'new-mp-secret')
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET_OLD', 'old-mp-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { MercadoPagoAdapter } = await import('@/lib/adapters/mercadopago')
    const adapter = new MercadoPagoAdapter()

    const sig = buildMpSig('old-mp-secret')
    expect(adapter.webhookVerify(RAW_BODY, sig)).toBe(false)
    expect(adapter.webhookVerify(RAW_BODY, sig, 'old-mp-secret')).toBe(true)
  })

  it('rejects signature computed with an UNKNOWN secret', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'new-mp-secret')
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET_OLD', 'old-mp-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { MercadoPagoAdapter } = await import('@/lib/adapters/mercadopago')
    const adapter = new MercadoPagoAdapter()

    const evilSig = buildMpSig('evil-mp-secret')
    expect(adapter.webhookVerify(RAW_BODY, evilSig)).toBe(false)
    expect(adapter.webhookVerify(RAW_BODY, evilSig, 'old-mp-secret')).toBe(false)
  })

  it('rejects malformed signature header (missing ts)', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'new-mp-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { MercadoPagoAdapter } = await import('@/lib/adapters/mercadopago')
    const adapter = new MercadoPagoAdapter()

    expect(adapter.webhookVerify(RAW_BODY, 'v1=abc')).toBe(false)
    expect(adapter.webhookVerify(RAW_BODY, '')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wompi
// ─────────────────────────────────────────────────────────────────────────────

describe('Webhook signature rotation · Wompi', () => {
  // Wompi's signature is the raw HMAC-SHA256 hex over the body (no
  // `t=...,v1=...` framing — just the hex digest in the
  // `X-Events-Signature` header).
  const RAW_BODY = JSON.stringify({
    event: 'transaction.updated',
    data: { transaction: { id: 'tx_1', status: 'APPROVED' } },
  })

  function buildWompiSig(secret: string): string {
    return hmacSha256Hex(secret, RAW_BODY)
  }

  it('accepts signature computed with the CURRENT secret (env-configured)', async () => {
    vi.stubEnv('WOMPI_EVENT_SECRET', 'new-wompi-secret')
    vi.stubEnv('WOMPI_WEBHOOK_SECRET_OLD', 'old-wompi-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { WompiAdapter } = await import('@/lib/adapters/wompi')
    const adapter = new WompiAdapter()

    const sig = buildWompiSig('new-wompi-secret')
    expect(adapter.webhookVerify(RAW_BODY, sig)).toBe(true)
  })

  it('accepts signature computed with the OLD secret via secretOverride', async () => {
    vi.stubEnv('WOMPI_EVENT_SECRET', 'new-wompi-secret')
    vi.stubEnv('WOMPI_WEBHOOK_SECRET_OLD', 'old-wompi-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { WompiAdapter } = await import('@/lib/adapters/wompi')
    const adapter = new WompiAdapter()

    const sig = buildWompiSig('old-wompi-secret')
    expect(adapter.webhookVerify(RAW_BODY, sig)).toBe(false)
    expect(adapter.webhookVerify(RAW_BODY, sig, 'old-wompi-secret')).toBe(true)
  })

  it('rejects signature computed with an UNKNOWN secret', async () => {
    vi.stubEnv('WOMPI_EVENT_SECRET', 'new-wompi-secret')
    vi.stubEnv('WOMPI_WEBHOOK_SECRET_OLD', 'old-wompi-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { WompiAdapter } = await import('@/lib/adapters/wompi')
    const adapter = new WompiAdapter()

    const evilSig = buildWompiSig('evil-wompi-secret')
    expect(adapter.webhookVerify(RAW_BODY, evilSig)).toBe(false)
    expect(adapter.webhookVerify(RAW_BODY, evilSig, 'old-wompi-secret')).toBe(false)
  })

  it('rejects empty signature', async () => {
    vi.stubEnv('WOMPI_EVENT_SECRET', 'new-wompi-secret')
    vi.stubEnv('NODE_ENV', 'production')

    const { WompiAdapter } = await import('@/lib/adapters/wompi')
    const adapter = new WompiAdapter()

    expect(adapter.webhookVerify(RAW_BODY, '')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PayU
// ─────────────────────────────────────────────────────────────────────────────

describe('Webhook signature rotation · PayU', () => {
  // PayU's webhook body is JSON with `reference_sale`, `value`, `currency`,
  // and `state_pol`. The signature is MD5 of
  //   `{apiKey}~{merchantId}~{reference}~{amount}~{currency}~{state_pol}`
  // where `apiKey` is the rotatable credential (overridable via
  // `secretOverride`) and `merchantId` is stable.
  const REFERENCE = 'ORD-2024-001'
  const AMOUNT = 150
  const CURRENCY = 'USD'
  const STATE = '4' // 4 = approved in PayU's state_pol

  function buildPayuBody(): string {
    return JSON.stringify({
      reference_sale: REFERENCE,
      value: AMOUNT,
      currency: CURRENCY,
      state_pol: STATE,
    })
  }

  function buildPayuSig(apiKey: string, merchantId: string): string {
    return payuMd5Hex(apiKey, merchantId, REFERENCE, AMOUNT, CURRENCY, STATE)
  }

  it('accepts signature computed with the CURRENT API key (env-configured)', async () => {
    vi.stubEnv('PAYU_API_KEY', 'new-payu-key')
    vi.stubEnv('PAYU_MERCHANT_ID', 'merchant-123')
    vi.stubEnv('PAYU_WEBHOOK_SECRET_OLD', 'old-payu-key')
    vi.stubEnv('NODE_ENV', 'production')

    const { PayUAdapter } = await import('@/lib/adapters/payu')
    const adapter = new PayUAdapter()

    const sig = buildPayuSig('new-payu-key', 'merchant-123')
    expect(adapter.webhookVerify(buildPayuBody(), sig)).toBe(true)
  })

  it('accepts signature computed with the OLD API key via secretOverride', async () => {
    vi.stubEnv('PAYU_API_KEY', 'new-payu-key')
    vi.stubEnv('PAYU_MERCHANT_ID', 'merchant-123')
    vi.stubEnv('PAYU_WEBHOOK_SECRET_OLD', 'old-payu-key')
    vi.stubEnv('NODE_ENV', 'production')

    const { PayUAdapter } = await import('@/lib/adapters/payu')
    const adapter = new PayUAdapter()

    // Signed with the OLD API key — fails against the new key, succeeds
    // with `secretOverride = 'old-payu-key'`.
    const sig = buildPayuSig('old-payu-key', 'merchant-123')
    expect(adapter.webhookVerify(buildPayuBody(), sig)).toBe(false)
    expect(adapter.webhookVerify(buildPayuBody(), sig, 'old-payu-key')).toBe(true)
  })

  it('rejects signature computed with an UNKNOWN API key', async () => {
    vi.stubEnv('PAYU_API_KEY', 'new-payu-key')
    vi.stubEnv('PAYU_MERCHANT_ID', 'merchant-123')
    vi.stubEnv('PAYU_WEBHOOK_SECRET_OLD', 'old-payu-key')
    vi.stubEnv('NODE_ENV', 'production')

    const { PayUAdapter } = await import('@/lib/adapters/payu')
    const adapter = new PayUAdapter()

    const evilSig = buildPayuSig('evil-payu-key', 'merchant-123')
    expect(adapter.webhookVerify(buildPayuBody(), evilSig)).toBe(false)
    expect(adapter.webhookVerify(buildPayuBody(), evilSig, 'old-payu-key')).toBe(false)
  })

  it('rejects malformed webhook body (missing required fields)', async () => {
    vi.stubEnv('PAYU_API_KEY', 'new-payu-key')
    vi.stubEnv('PAYU_MERCHANT_ID', 'merchant-123')
    vi.stubEnv('NODE_ENV', 'production')

    const { PayUAdapter } = await import('@/lib/adapters/payu')
    const adapter = new PayUAdapter()

    // Missing `state_pol` → `if (!reference || !amount || !currency || !state) return false`
    const incomplete = JSON.stringify({ reference_sale: 'ORD-1', value: 100, currency: 'USD' })
    expect(adapter.webhookVerify(incomplete, 'anysig')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-adapter contract
// ─────────────────────────────────────────────────────────────────────────────

describe('Webhook signature rotation · cross-adapter contract', () => {
  it('all 4 adapters expose `webhookVerify(rawBody, signature, secretOverride?)`', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 's')
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'm')
    vi.stubEnv('WOMPI_EVENT_SECRET', 'w')
    vi.stubEnv('PAYU_API_KEY', 'p')
    vi.stubEnv('PAYU_MERCHANT_ID', 'mid')

    const { StripeAdapter } = await import('@/lib/adapters/stripe')
    const { MercadoPagoAdapter } = await import('@/lib/adapters/mercadopago')
    const { WompiAdapter } = await import('@/lib/adapters/wompi')
    const { PayUAdapter } = await import('@/lib/adapters/payu')

    for (const Adapter of [StripeAdapter, MercadoPagoAdapter, WompiAdapter, PayUAdapter]) {
      const instance = new Adapter()
      expect(typeof instance.webhookVerify).toBe('function')
      // Calling with 3 args should not throw — the override param is
      // part of the contract.
      expect(() => instance.webhookVerify('body', 'sig', 'override-secret')).not.toThrow()
    }
  })
})
