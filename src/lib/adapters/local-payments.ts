// ZIAY — Local LATAM Payment Adapters (PSE / PIX / OXXO / SPEI)
// Saramantha §10 / study §18 — LATAM-specific payment flows that don't fit
// the global `PaymentAdapter` contract (which assumes a checkout URL).
//
// Local methods return QR / barcode / bank-redirect URLs that need a
// different result shape, so they live behind their own `LocalPaymentAdapter`
// interface resolved by `getLocalPaymentAdapter(method)` from
// `payment-registry.ts`.
//
// Methods:
//   pse  — Colombia bank transfer via ACH (PSE — Pagos Seguros en Línea)
//   pix  — Brasil instant payment (Banco Central, BR Code / EMV QR)
//   oxxo — México cash at convenience stores (via Stripe Sources)
//   spei — México interbank transfer (Sistema de Pagos Electrónicos Interbancarios)
//
// Patterns (copied from `mercadopago.ts` / `stripe.ts`):
//   - `hasCredentials()` per adapter; stub mode when env vars missing.
//   - `formEncode(obj)` for `application/x-www-form-urlencoded` bodies.
//   - `crypto.timingSafeEqual` for HMAC comparison (no early-exit leaks).
//   - All fetch calls have a 10s `AbortController` timeout.
//   - `getLogger('adapter:<method>')` for structured logging.
//   - Reuses `STRIPE_SECRET_KEY` for OXXO (Stripe Sources, type=oxxo).
//
// SPRINT-MULTICOUNTRY-001 · R-1 (CRITICAL FIX — AUDITORIA-FINTECH)
// This file was missing on disk because `.gitignore` had a `local-*` pattern
// that hid it. The pattern is removed; this file is the canonical
// implementation of the contract declared in `payment-registry.ts` and
// consumed by `app/api/payments/local/route.ts`.

import crypto, { timingSafeEqual } from 'node:crypto'
import type { PaymentResult } from './payment-adapter'
import { getLogger } from '@/lib/logger'

const log = getLogger('adapter:local-payments')

// ─────────────────────────────────────────────────────────────────────────────
// Public types & exports
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical local LATAM payment method names. */
export type LocalPaymentMethod = 'pse' | 'pix' | 'oxxo' | 'spei'

/** Readonly tuple of supported local methods. */
export const LOCAL_PAYMENT_METHODS = ['pse', 'pix', 'oxxo', 'spei'] as const

/** Map of country (ISO 3166-1 alpha-2) → local methods available there. */
const COUNTRY_METHODS: Record<string, LocalPaymentMethod[]> = {
  CO: ['pse'],
  BR: ['pix'],
  MX: ['oxxo', 'spei'],
}

/**
 * Input for `LocalPaymentAdapter.createPayment`.
 *
 * `currency` and `countryCode` are optional at the type level because the
 * REST route (`POST /api/payments/local`) resolves them upstream (from
 * `getCurrencyForCountry` + `body.countryCode`) and only forwards the
 * minimal subset to the adapter. Each adapter derives what it needs from
 * its env config (PSE → COP, PIX → BRL, OXXO/SPEI → MXN) and falls back
 * gracefully when the caller omits them.
 */
export interface LocalPaymentInput {
  amount: number
  /** Caller-side reference (e.g. cart id, order number). */
  reference: string
  tenantId: string
  /** ISO 4217. Defaults per method (PSE→COP, PIX→BRL, OXXO/SPEI→MXN). */
  currency?: string
  /** ISO 3166-1 alpha-2. Defaults per method (PSE→CO, PIX→BR, OXXO/SPEI→MX). */
  countryCode?: string
  /** PSE only — bank code from `PSE_BANKS`. */
  bankCode?: string
  /** PSE only — URL the bank redirects to after the transfer. */
  returnUrl?: string
  customerName?: string
  customerPhone?: string
  customerId?: string
}

/**
 * Result of `LocalPaymentAdapter.createPayment`.
 *
 * Includes both `paymentId` (gateway-side identifier, per the audit spec)
 * AND `reference` (alias used by `app/api/payments/local/route.ts` to stamp
 * `Order.paymentRef` and build the poll URL). Adapters set both to the same
 * gateway-side identifier — keeping them as separate fields preserves
 * backwards compatibility with both the spec and the existing route.
 */
export interface LocalPaymentResult {
  success: boolean
  method: LocalPaymentMethod
  /** Gateway-side ID — used for polling/webhook reconciliation. */
  paymentId: string
  /** Alias for `paymentId` — what `Order.paymentRef` gets stamped with. */
  reference: string
  /** PIX — the BR Code payload string (encode as QR to render). */
  qrCode?: string
  /** PIX — optional pre-rendered QR image (data: URL). */
  qrImageUrl?: string
  /** OXXO — the barcode / OXXO reference number the customer reads at the store. */
  barcode?: string
  /** PSE — bank selection / transfer URL. OXXO — voucher PDF URL. */
  redirectUrl?: string
  /** SPEI — CLABE account number the customer transfers to. */
  accountNumber?: string
  /** SPEI — reference number the customer includes in the transfer concept. */
  speiReference?: string
  expiresAt?: Date
  amount: number
  currency: string
  rawResponse?: unknown
  message?: string
}

/** Verification result returned by `LocalPaymentAdapter.webhookVerify`. */
export interface LocalWebhookVerifyResult {
  verified: boolean
  paymentId?: string
  status?: string
}

/**
 * Contract every local payment adapter implements. Mirrors the global
 * `PaymentAdapter` interface but with local-method-specific shapes:
 *   - `createPayment` returns QR/barcode/redirect instead of a checkout URL
 *   - `verifyPayment` returns the canonical `PaymentResult` (so the same
 *     webhook / polling handler can process both global and local methods)
 *   - `webhookVerify` is async (some local flows need to call the gateway
 *     to confirm the signature — e.g. Stripe)
 */
export interface LocalPaymentAdapter {
  name: string
  method: LocalPaymentMethod
  /** True if the env vars / credentials required for live calls are present. */
  isConfigured(): boolean
  createPayment(input: LocalPaymentInput): Promise<LocalPaymentResult>
  verifyPayment(paymentId: string): Promise<PaymentResult>
  webhookVerify(payload: string, signature: string): Promise<LocalWebhookVerifyResult>
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (copied from mercadopago.ts / stripe.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Default 10s timeout for upstream fetch calls. */
const FETCH_TIMEOUT_MS = 10_000

/** Wraps a fetch call with an AbortController-based timeout. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Form-encodes an object (potentially nested) into a `x-www-form-urlencoded`
 * string. Arrays use `key[i]`, sub-objects use `key[nested]`. Mirrors the
 * helper in `stripe.ts` (Stripe / PSE form APIs both speak form-encoded).
 */
function formEncode(obj: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      v.forEach((item, i) => params.append(`${k}[${i}]`, String(item)))
    } else if (typeof v === 'object') {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (vv !== undefined && vv !== null) params.append(`${k}[${kk}]`, String(vv))
      }
    } else {
      params.append(k, String(v))
    }
  }
  return params.toString()
}

/** Timing-safe string comparison (returns false on length mismatch). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  try {
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

/** Stable prefix used by every adapter for its stub-mode paymentId. */
function stubPaymentId(method: LocalPaymentMethod): string {
  return `${method}-stub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Stub-mode LocalPaymentResult returned when an adapter is unconfigured.
 * Mirrors the global `stubNoCredentials` helper: `success: false` so the
 * caller can degrade gracefully (show COD, hide the local-method button).
 */
function stubLocalResult(
  method: LocalPaymentMethod,
  amount: number,
  currency: string,
  message: string,
): LocalPaymentResult {
  const paymentId = stubPaymentId(method)
  return {
    success: false,
    method,
    paymentId,
    reference: paymentId,
    amount,
    currency,
    message,
    rawResponse: { method, stub: true },
  }
}

/** Stub PaymentResult for `verifyPayment` when credentials are missing. */
function stubVerifyResult(method: string, amount: number, currency: string): PaymentResult {
  return {
    success: false,
    status: 'stub',
    amount,
    currency,
    message: `${method}: credentials not configured (stub mode)`,
    rawResponse: { method, stub: true },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PSE — Colombia bank transfer via ACH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bank code map for PSE (Pagos Seguros en Línea).
 * Source: ACH Colombia published bank list (test/sandbox environment).
 * Production deployments should refresh this list from the PSE API
 * (`getBankList` SOAP call) at startup.
 */
export const PSE_BANKS: Record<string, string> = {
  '1022': 'Bancolombia',
  '1052': 'Davivienda',
  '1037': 'BBVA Colombia',
  '1002': 'Banco de Bogotá',
  '1023': 'Banco Occidente',
  '1051': 'Banco AV Villas',
  '1006': 'Itaú Colombia',
  '1019': 'Scotiabank Colpatria',
  '1066': 'Banco Falabella',
  '1012': 'Banco GNB Sudameris',
  '1009': 'Banco de Occidente',
  '1040': 'Banco Agrario',
  '1060': 'Banco Cooperativo Coopcentral',
  '1500': 'Nequi',
}

const PSE_API_BASE = process.env.PSE_API_BASE ?? 'https://test.pse.com.co'

class PSEAdapter implements LocalPaymentAdapter {
  name = 'pse'
  method: LocalPaymentMethod = 'pse'
  private readonly merchantId = process.env.PSE_MERCHANT_ID ?? ''
  private readonly apiKey = process.env.PSE_API_KEY ?? ''
  private readonly webhookSecret = process.env.PSE_WEBHOOK_SECRET ?? ''
  private readonly log = getLogger('adapter:pse')

  isConfigured(): boolean {
    return this.merchantId.length > 0 && this.apiKey.length > 0
  }

  async createPayment(input: LocalPaymentInput): Promise<LocalPaymentResult> {
    const currency = (input.currency ?? 'COP').toUpperCase()
    if (!this.isConfigured()) {
      this.log.warn({ tenantId: input.tenantId }, 'PSE not configured — returning stub')
      return stubLocalResult(
        this.method,
        input.amount,
        currency,
        'PSE: credenciales no configuradas (modo stub). Configure PSE_MERCHANT_ID y PSE_API_KEY.',
      )
    }
    if (!input.bankCode) {
      return {
        success: false,
        method: this.method,
        paymentId: '',
        reference: '',
        amount: input.amount,
        currency,
        message: 'PSE requires bankCode (use PSE_BANKS keys, e.g. 1022 for Bancolombia).',
      }
    }
    if (!input.returnUrl) {
      return {
        success: false,
        method: this.method,
        paymentId: '',
        reference: '',
        amount: input.amount,
        currency,
        message: 'PSE requires returnUrl (bank redirects there after the transfer).',
      }
    }

    const bankName = PSE_BANKS[input.bankCode] ?? 'Unknown Bank'
    const transactionId = `pse-${input.tenantId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    try {
      // PSE creates a transaction via POST /api/transaction/create
      // The response includes `redirectURL` (bank selection page).
      const body = formEncode({
        merchantID: this.merchantId,
        bankCode: input.bankCode,
        bankName,
        reference: input.reference,
        description: `Pago ${input.reference}`,
        language: 'es',
        currency: currency === 'COP' ? 'COP' : currency,
        totalAmount: Number(input.amount.toFixed(2)),
        taxpayerID: input.customerId ?? '',
        returnUrl: input.returnUrl,
        transactionID: transactionId,
      })

      const res = await fetchWithTimeout(`${PSE_API_BASE}/api/transaction/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
      const data = (await res.json()) as Record<string, unknown>

      if (!res.ok) {
        return {
          success: false,
          method: this.method,
          paymentId: transactionId,
          reference: transactionId,
          amount: input.amount,
          currency,
          message: `PSE createPayment ${res.status}`,
          rawResponse: data,
        }
      }

      const redirectUrl = String(data.redirectURL ?? data.redirectUrl ?? '')
      const paymentId = String(data.transactionID ?? data.trazabilityCode ?? transactionId)
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 min

      this.log.info(
        { tenantId: input.tenantId, paymentId, bankCode: input.bankCode, amount: input.amount },
        'PSE payment created',
      )

      return {
        success: true,
        method: this.method,
        paymentId,
        reference: paymentId,
        redirectUrl,
        expiresAt,
        amount: input.amount,
        currency,
        rawResponse: data,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      this.log.error({ err, tenantId: input.tenantId }, 'PSE createPayment failed')
      return {
        success: false,
        method: this.method,
        paymentId: transactionId,
        reference: transactionId,
        amount: input.amount,
        currency,
        message,
      }
    }
  }

  async verifyPayment(paymentId: string): Promise<PaymentResult> {
    if (!this.isConfigured()) return stubVerifyResult(this.name, 0, 'COP')
    try {
      const res = await fetchWithTimeout(
        `${PSE_API_BASE}/api/transaction/status?transactionID=${encodeURIComponent(paymentId)}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
      )
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: 0,
          currency: 'COP',
          message: `PSE verify ${res.status}`,
          rawResponse: data,
        }
      }
      const statusRaw = String(data.status ?? data.transactionState ?? 'unknown').toLowerCase()
      // Map PSE states to canonical: approved | pending | rejected | error
      const canonical =
        statusRaw === 'ok' || statusRaw === 'approved' || statusRaw === 'success'
          ? 'approved'
          : statusRaw === 'pending' || statusRaw === 'not_authorised'
            ? 'pending'
            : statusRaw === 'failed' || statusRaw === 'rejected'
              ? 'rejected'
              : 'pending'
      return {
        success: canonical === 'approved',
        paymentId: String(data.transactionID ?? paymentId),
        status: canonical,
        amount: Number(data.totalAmount ?? 0),
        currency: String(data.currency ?? 'COP').toUpperCase(),
        rawResponse: data,
      }
    } catch (err) {
      return {
        success: false,
        status: 'error',
        amount: 0,
        currency: 'COP',
        message: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }

  async webhookVerify(payload: string, signature: string): Promise<LocalWebhookVerifyResult> {
    // PSE webhooks send an HMAC-SHA256 hex signature in the `x-pse-signature`
    // header over the raw body. Without a configured secret we reject in prod
    // and accept (with a warning) in dev — same contract as the global adapters.
    if (!this.webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        this.log.error('PSE webhook secret not configured in production — rejecting webhook')
        return { verified: false }
      }
      this.log.warn('PSE webhook secret not configured — accepting in dev mode')
      return { verified: true, status: 'dev-bypass' }
    }
    if (!signature) return { verified: false }
    try {
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex')
      if (!safeEqual(expected, signature)) {
        return { verified: false }
      }
      const data = JSON.parse(payload) as Record<string, unknown>
      return {
        verified: true,
        paymentId: data.transactionID ? String(data.transactionID) : undefined,
        status: data.status ? String(data.status) : undefined,
      }
    } catch {
      return { verified: false }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PIX — Brasil instant payment (BR Code / EMV QR, generated locally)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CRC16-CCITT (polynomial 0x1021, initial 0xFFFF) — required by the BR Code
 * spec (Banco Central do Brasil · BR Code v1.0 §6). The CRC is computed
 * over the entire payload up to (but not including) the `6304` CRC tag, then
 * appended as a 4-char uppercase hex string.
 */
function crc16Ccitt(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** TLV (Tag-Length-Value) encoder per BR Code spec: `id` + 2-digit length + value. */
function brCodeTlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0')
  return `${id}${len}${value}`
}

/**
 * Generate a PIX BR Code (Payload Format Indicator 01 + CRC16) from a payee
 * key + amount + reference. Pure local computation — no API call needed.
 *
 * The resulting string can be rendered as a QR code client-side (e.g. with
 * the `qrcode` npm package). We optionally also expose it as a data: URL PNG
 * when `PIX_QR_IMAGE_ENDPOINT` is configured (some merchants run a local QR
 * rendering service).
 *
 * @see https://www.bcb.gov.br/estabilidadefinanceira/pix
 * @see https://www.bcb.gov.br/estabilidadefinanceira/repositorio/MessageExceptionPage/PIX%20BR%20Code.pdf
 */
function generatePixBrCode(
  payeeKey: string,
  payeeName: string,
  amount: number,
  reference: string,
): string {
  // Merchant Account Information (id 26) — subfields:
  //   00 = GUI (BR.GOV.BCB.PIX)
  //   01 = payee key (CPF/CNPJ/email/phone/random)
  const mai = brCodeTlv('00', 'BR.GOV.BCB.PIX') + brCodeTlv('01', payeeKey)
  const maiField = brCodeTlv('26', mai)

  // Additional Data Field (id 62) — subfield 05 = reference label
  const refLabel = reference.slice(0, 25)
  const adf = brCodeTlv('05', refLabel)
  const adfField = brCodeTlv('62', adf)

  // Build payload (without CRC), then append CRC.
  // Field 54 (Transaction Amount) is omitted when amount === 0 (allowing the
  // user to type any amount in their banking app — typical PIX "QR estático").
  const amountPart = amount > 0 ? brCodeTlv('54', amount.toFixed(2)) : ''

  const payload =
    brCodeTlv('00', '01') +                          // Payload Format Indicator
    brCodeTlv('01', '12') +                          // Point of Initiation Method (12 = dynamic)
    maiField +                                       // Merchant Account Information
    brCodeTlv('52', '0000') +                        // Merchant Category Code
    brCodeTlv('53', '986') +                         // Transaction Currency (986 = BRL)
    amountPart +                                     // Transaction Amount (optional)
    brCodeTlv('58', 'BR') +                          // Country Code
    brCodeTlv('59', payeeName.slice(0, 25)) +        // Merchant Name (max 25)
    brCodeTlv('60', 'BRASILIA'.slice(0, 15)) +       // Merchant City (max 15)
    adfField +                                       // Additional Data Field
    '6304'                                           // CRC16 tag + length

  return payload + crc16Ccitt(payload)
}

class PIXAdapter implements LocalPaymentAdapter {
  name = 'pix'
  method: LocalPaymentMethod = 'pix'
  private readonly payeeKey = process.env.PIX_PAYEE_KEY ?? ''
  private readonly payeeName = process.env.PIX_PAYEE_NAME ?? ''
  private readonly webhookSecret = process.env.PIX_WEBHOOK_SECRET ?? ''
  private readonly log = getLogger('adapter:pix')

  isConfigured(): boolean {
    return this.payeeKey.length > 0 && this.payeeName.length > 0
  }

  async createPayment(input: LocalPaymentInput): Promise<LocalPaymentResult> {
    const currency = (input.currency ?? 'BRL').toUpperCase()
    if (!this.isConfigured()) {
      this.log.warn({ tenantId: input.tenantId }, 'PIX not configured — returning stub')
      return stubLocalResult(
        this.method,
        input.amount,
        currency,
        'PIX: credenciales no configuradas (modo stub). Configure PIX_PAYEE_KEY y PIX_PAYEE_NAME.',
      )
    }

    // PIX BR Code is generated locally — no upstream API call required.
    const paymentId = `pix-${input.tenantId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const reference = input.reference || paymentId
    const qrPayload = generatePixBrCode(
      this.payeeKey,
      this.payeeName,
      input.amount,
      reference,
    )
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 min

    // Optional pre-rendered QR image (only when a renderer endpoint is configured).
    const qrImageUrl = process.env.PIX_QR_IMAGE_ENDPOINT
      ? `${process.env.PIX_QR_IMAGE_ENDPOINT}?payload=${encodeURIComponent(qrPayload)}`
      : undefined

    this.log.info(
      { tenantId: input.tenantId, paymentId, amount: input.amount },
      'PIX BR Code generated',
    )

    return {
      success: true,
      method: this.method,
      paymentId,
      reference: paymentId,
      qrCode: qrPayload,
      ...(qrImageUrl ? { qrImageUrl } : {}),
      expiresAt,
      amount: input.amount,
      currency,
      rawResponse: { qrPayload, payeeKey: this.payeeKey },
    }
  }

  async verifyPayment(paymentId: string): Promise<PaymentResult> {
    // PIX has no synchronous verify endpoint — status comes exclusively via
    // webhook (the Banco Central broadcasts a payment notification when the
    // customer completes the transfer). Until the webhook fires, the payment
    // stays pending. We surface that here so the polling endpoint degrades
    // gracefully without spurious errors.
    if (!this.isConfigured()) return stubVerifyResult(this.name, 0, 'BRL')
    return {
      success: false,
      paymentId,
      status: 'pending',
      amount: 0,
      currency: 'BRL',
      message: 'PIX: awaiting webhook confirmation from the bank.',
      rawResponse: { paymentId, pending: true },
    }
  }

  async webhookVerify(payload: string, signature: string): Promise<LocalWebhookVerifyResult> {
    // The Banco Central / SPI broadcasts pix payments as a signed webhook.
    // Signature is HMAC-SHA256(secret, payload) hex-encoded in `x-pix-signature`.
    if (!this.webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        this.log.error('PIX webhook secret not configured in production — rejecting webhook')
        return { verified: false }
      }
      this.log.warn('PIX webhook secret not configured — accepting in dev mode')
      return { verified: true, status: 'dev-bypass' }
    }
    if (!signature) return { verified: false }
    try {
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex')
      if (!safeEqual(expected, signature)) {
        return { verified: false }
      }
      const data = JSON.parse(payload) as Record<string, unknown>
      // AUDIT-FINTECH N-5 — fail-closed on missing `status`.
      // Previously defaulted to `'approved'` when the payload omitted
      // `status` — fail-open behavior: a missing-status webhook would
      // mark an unpaid order as paid. An attacker with the webhook
      // secret (or a misconfigured sender) could send `{"endToEndId":"..."}`
      // and the webhook would report `approved`. Now we default to
      // `'pending'` so the handler leaves the order in its current
      // state until an explicit `approved` / `paid` status arrives in
      // a later webhook (or the gateway's REST API confirms).
      if (!('status' in data) || data.status == null || data.status === '') {
        this.log.warn(
          { endToEndId: data.endToEndId ?? null, txid: data.txid ?? null },
          'PIX webhook payload missing `status` field — defaulting to pending (fail-closed, AUDIT-FINTECH N-5)',
        )
      }
      const status = data.status ? String(data.status) : 'pending'
      return {
        verified: true,
        paymentId: data.endToEndId ? String(data.endToEndId) : data.txid ? String(data.txid) : undefined,
        status,
      }
    } catch {
      return { verified: false }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OXXO — México cash at convenience stores (via Stripe Sources)
// ─────────────────────────────────────────────────────────────────────────────

const STRIPE_API_BASE = process.env.STRIPE_API_BASE ?? 'https://api.stripe.com/v1'

class OXXOAdapter implements LocalPaymentAdapter {
  name = 'oxxo'
  method: LocalPaymentMethod = 'oxxo'
  // OXXO reuses the existing Stripe secret key — no separate OXXO_* env.
  private readonly secretKey = process.env.STRIPE_SECRET_KEY ?? ''
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
  private readonly log = getLogger('adapter:oxxo')

  isConfigured(): boolean {
    return this.secretKey.length > 0
  }

  async createPayment(input: LocalPaymentInput): Promise<LocalPaymentResult> {
    const currency = (input.currency ?? 'MXN').toLowerCase()
    if (!this.isConfigured()) {
      this.log.warn({ tenantId: input.tenantId }, 'OXXO not configured — returning stub')
      return stubLocalResult(
        this.method,
        input.amount,
        currency.toUpperCase(),
        'OXXO: STRIPE_SECRET_KEY no configurada (modo stub).',
      )
    }

    try {
      // Stripe Sources API — type=oxxo. Amount in centavos (MXN has 2 decimals).
      const amountInCents = Math.round(input.amount * 100)
      const body = formEncode({
        type: 'oxxo',
        amount: amountInCents,
        currency,
        owner: {
          email: input.customerId ? `${input.customerId}@tenant.ziay.app` : 'merchant@ziay.app',
          ...(input.customerName ? { name: input.customerName } : {}),
          ...(input.customerPhone ? { phone: input.customerPhone } : {}),
        },
        ...(input.reference ? { statement_descriptor: input.reference.slice(0, 40) } : {}),
        metadata: {
          reference: input.reference,
          tenantId: input.tenantId,
          ...(input.customerId ? { customerId: input.customerId } : {}),
        },
      })

      const res = await fetchWithTimeout(`${STRIPE_API_BASE}/sources`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
      const data = (await res.json()) as Record<string, unknown>

      if (!res.ok) {
        return {
          success: false,
          method: this.method,
          paymentId: '',
          reference: '',
          amount: input.amount,
          currency: currency.toUpperCase(),
          message: `OXXO createPayment ${res.status}: ${String((data.error as Record<string, unknown> | undefined)?.message ?? '')}`,
          rawResponse: data,
        }
      }

      const paymentId = String(data.id ?? '')
      const oxxoData = (data.oxxo ?? {}) as Record<string, unknown>
      const barcode = String(oxxoData.number ?? data.id ?? '')
      const redirectUrl = String(
        (data.redirect as Record<string, unknown> | undefined)?.url ??
          oxxoData.voucher_url ??
          '',
      )
      // Stripe OXXO sources expire after 3 days by default.
      const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

      this.log.info(
        { tenantId: input.tenantId, paymentId, amount: input.amount },
        'OXXO source created',
      )

      return {
        success: true,
        method: this.method,
        paymentId,
        reference: paymentId,
        barcode,
        redirectUrl,
        expiresAt,
        amount: input.amount,
        currency: currency.toUpperCase(),
        rawResponse: data,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      this.log.error({ err, tenantId: input.tenantId }, 'OXXO createPayment failed')
      return {
        success: false,
        method: this.method,
        paymentId: '',
        reference: '',
        amount: input.amount,
        currency: currency.toUpperCase(),
        message,
      }
    }
  }

  async verifyPayment(paymentId: string): Promise<PaymentResult> {
    if (!this.isConfigured()) return stubVerifyResult(this.name, 0, 'MXN')
    try {
      const res = await fetchWithTimeout(
        `${STRIPE_API_BASE}/sources/${encodeURIComponent(paymentId)}`,
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      )
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: 0,
          currency: 'MXN',
          message: `OXXO verify ${res.status}`,
          rawResponse: data,
        }
      }
      const status = String(data.status ?? 'unknown')
      // Stripe source statuses: chargeable, consumed, pending, canceled, failed.
      // OXXO is `chargeable` until the customer pays at the store, then `consumed`.
      const canonical =
        status === 'consumed' || status === 'chargeable'
          ? status === 'consumed'
            ? 'approved'
            : 'pending'
          : status === 'canceled' || status === 'failed'
            ? 'rejected'
            : 'pending'
      return {
        success: canonical === 'approved',
        paymentId: String(data.id ?? paymentId),
        status: canonical,
        amount: Number(data.amount ?? 0) / 100,
        currency: String(data.currency ?? 'mxn').toUpperCase(),
        rawResponse: data,
      }
    } catch (err) {
      return {
        success: false,
        status: 'error',
        amount: 0,
        currency: 'MXN',
        message: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }

  async webhookVerify(payload: string, signature: string): Promise<LocalWebhookVerifyResult> {
    // Reuse the Stripe webhook verification: header format
    // `stripe-signature: t=<ts>,v1=<hex>`, manifest = `${t}.${payload}`.
    if (!this.webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        this.log.error('Stripe webhook secret not configured in production — rejecting OXXO webhook')
        return { verified: false }
      }
      this.log.warn('Stripe webhook secret not configured — accepting in dev mode')
      return { verified: true, status: 'dev-bypass' }
    }
    if (!signature) return { verified: false }

    // Parse `t=...,v1=...` format.
    const parts = signature.split(',').reduce<Record<string, string>>((acc, part) => {
      const idx = part.indexOf('=')
      if (idx > 0) acc[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
      return acc
    }, {})
    const t = parts.t
    const v1 = parts.v1
    if (!t || !v1) return { verified: false }

    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(`${t}.${payload}`)
      .digest('hex')
    if (!safeEqual(expected, v1)) return { verified: false }

    try {
      const data = JSON.parse(payload) as Record<string, unknown>
      const obj = ((data.data as Record<string, unknown> | undefined)?.object ?? {}) as Record<string, unknown>
      return {
        verified: true,
        paymentId: obj.id ? String(obj.id) : undefined,
        status: obj.status ? String(obj.status) : undefined,
      }
    } catch {
      return { verified: true }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEI — México interbank transfer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the SPEI/CLABE check digit (control digit) using the weighted-sum
 * algorithm specified by Banxico. Weights cycle [3, 7, 1, 3, 7, 1, ...],
 * applied to the first 17 digits; the sum mod 10 (then 10 − that mod 10,
 * wrapped to 0) is the 18th digit.
 *
 * Implemented locally so the adapter can validate / generate CLABE-like
 * reference numbers without calling the bank — useful in stub mode and as a
 * sanity check in live mode.
 */
function clabeCheckDigit(first17: string): string {
  const weights = [3, 7, 1]
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const d = Number(first17[i] ?? '0')
    sum += (d * weights[i % 3]) % 10
  }
  const check = (10 - (sum % 10)) % 10
  return String(check)
}

/** Generate a virtual CLABE for SPEI collection (bank code + 12-digit account + check digit). */
function generateClabe(bankCode: string, accountNumber: string): string {
  const accountPadded = accountNumber.padStart(12, '0').slice(0, 12)
  const first17 = `${bankCode.padStart(3, '0').slice(0, 3)}${accountPadded.slice(0, 14)}`
  // Pad/truncate first17 to exactly 17 digits (bank 3 + account 14 = 17).
  const first17Padded = first17.padStart(17, '0').slice(0, 17)
  return first17Padded + clabeCheckDigit(first17Padded)
}

class SPEIAdapter implements LocalPaymentAdapter {
  name = 'spei'
  method: LocalPaymentMethod = 'spei'
  private readonly bankCode = process.env.SPEI_BANK_CODE ?? ''
  private readonly accountNumber = process.env.SPEI_ACCOUNT_NUMBER ?? ''
  private readonly webhookSecret = process.env.SPEI_WEBHOOK_SECRET ?? ''
  private readonly apiBase = process.env.SPEI_API_BASE ?? 'https://api.spei.com.mx'
  private readonly apiKey = process.env.SPEI_API_KEY ?? ''
  private readonly log = getLogger('adapter:spei')

  isConfigured(): boolean {
    // Live mode requires bank + account + API key. Stub mode (just bank +
    // account, no API key) generates a CLABE reference locally without
    // calling any bank — useful for dev/demo.
    return this.bankCode.length > 0 && this.accountNumber.length > 0
  }

  private isLive(): boolean {
    return this.isConfigured() && this.apiKey.length > 0
  }

  async createPayment(input: LocalPaymentInput): Promise<LocalPaymentResult> {
    const currency = (input.currency ?? 'MXN').toUpperCase()
    if (!this.isConfigured()) {
      this.log.warn({ tenantId: input.tenantId }, 'SPEI not configured — returning stub')
      return stubLocalResult(
        this.method,
        input.amount,
        currency,
        'SPEI: SPEI_BANK_CODE y SPEI_ACCOUNT_NUMBER no configurados (modo stub).',
      )
    }

    // Generate a SPEI reference (concepto) — what the customer includes in
    // the transfer so the webhook can match it back to the order.
    const speiReference = `SPEI-${input.tenantId.slice(-6)}-${Date.now().toString(36).toUpperCase()}`
    const clabe = generateClabe(this.bankCode, this.accountNumber)
    const paymentId = speiReference
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h

    // Stub mode: no API key — just return the CLABE + reference. The webhook
    // (when configured) confirms payment; otherwise polling returns pending.
    if (!this.isLive()) {
      this.log.info(
        { tenantId: input.tenantId, paymentId, clabe, amount: input.amount },
        'SPEI reference generated (stub mode — no live API key)',
      )
      return {
        success: true,
        method: this.method,
        paymentId,
        reference: paymentId,
        accountNumber: clabe,
        speiReference,
        expiresAt,
        amount: input.amount,
        currency,
        rawResponse: { clabe, speiReference, stub: true },
        message: 'SPEI: configure SPEI_API_KEY para habilitar el registro en vivo con el banco.',
      }
    }

    // Live mode: register the expected transfer with the bank's SPEI API.
    try {
      const body = formEncode({
        bankCode: this.bankCode,
        accountNumber: this.accountNumber,
        amount: Number(input.amount.toFixed(2)),
        currency,
        reference: speiReference,
        concept: input.reference,
        expiresIn: 86400,
        ...(input.customerName ? { customerName: input.customerName } : {}),
      })
      const res = await fetchWithTimeout(`${this.apiBase}/v1/spei/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          method: this.method,
          paymentId,
          reference: paymentId,
          amount: input.amount,
          currency,
          message: `SPEI createPayment ${res.status}: ${String((data.error as Record<string, unknown> | undefined)?.message ?? '')}`,
          rawResponse: data,
        }
      }
      const liveClabe = String(data.clabe ?? clabe)
      const liveRef = String(data.reference ?? speiReference)
      this.log.info(
        { tenantId: input.tenantId, paymentId: liveRef, amount: input.amount },
        'SPEI order registered with bank',
      )
      return {
        success: true,
        method: this.method,
        paymentId: liveRef,
        reference: liveRef,
        accountNumber: liveClabe,
        speiReference: liveRef,
        expiresAt,
        amount: input.amount,
        currency,
        rawResponse: data,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      this.log.error({ err, tenantId: input.tenantId }, 'SPEI createPayment failed — falling back to local reference')
      return {
        success: true, // still success — the customer can transfer to the static CLABE
        method: this.method,
        paymentId,
        reference: paymentId,
        accountNumber: clabe,
        speiReference,
        expiresAt,
        amount: input.amount,
        currency,
        message: `SPEI: API call failed (${message}); CLABE generated locally.`,
        rawResponse: { clabe, speiReference, fallback: true },
      }
    }
  }

  async verifyPayment(paymentId: string): Promise<PaymentResult> {
    if (!this.isConfigured()) return stubVerifyResult(this.name, 0, 'MXN')
    if (!this.isLive()) {
      // Stub mode — no live API, payment stays pending until webhook fires.
      return {
        success: false,
        paymentId,
        status: 'pending',
        amount: 0,
        currency: 'MXN',
        message: 'SPEI: awaiting webhook confirmation (stub mode).',
        rawResponse: { paymentId, pending: true, stub: true },
      }
    }
    try {
      const res = await fetchWithTimeout(
        `${this.apiBase}/v1/spei/orders/${encodeURIComponent(paymentId)}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
      )
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: 0,
          currency: 'MXN',
          message: `SPEI verify ${res.status}`,
          rawResponse: data,
        }
      }
      const statusRaw = String(data.status ?? 'unknown').toLowerCase()
      const canonical =
        statusRaw === 'completed' || statusRaw === 'paid'
          ? 'approved'
          : statusRaw === 'expired' || statusRaw === 'cancelled'
            ? 'rejected'
            : 'pending'
      return {
        success: canonical === 'approved',
        paymentId: String(data.reference ?? paymentId),
        status: canonical,
        amount: Number(data.amount ?? 0),
        currency: String(data.currency ?? 'MXN').toUpperCase(),
        rawResponse: data,
      }
    } catch (err) {
      return {
        success: false,
        status: 'error',
        amount: 0,
        currency: 'MXN',
        message: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }

  async webhookVerify(payload: string, signature: string): Promise<LocalWebhookVerifyResult> {
    // SPEI webhooks: HMAC-SHA256 hex signature in `x-spei-signature` over body.
    if (!this.webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        this.log.error('SPEI webhook secret not configured in production — rejecting webhook')
        return { verified: false }
      }
      this.log.warn('SPEI webhook secret not configured — accepting in dev mode')
      return { verified: true, status: 'dev-bypass' }
    }
    if (!signature) return { verified: false }
    try {
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex')
      if (!safeEqual(expected, signature)) {
        return { verified: false }
      }
      const data = JSON.parse(payload) as Record<string, unknown>
      return {
        verified: true,
        paymentId: data.reference ? String(data.reference) : undefined,
        status: data.status ? String(data.status) : undefined,
      }
    } catch {
      return { verified: false }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry — exports consumed by payment-registry.ts and the API route
// ─────────────────────────────────────────────────────────────────────────────

/** Adapter singletons — created lazily (no env access at module load time). */
const adapters: Partial<Record<LocalPaymentMethod, LocalPaymentAdapter>> = {}

function getAdapter(method: LocalPaymentMethod): LocalPaymentAdapter {
  if (!adapters[method]) {
    switch (method) {
      case 'pse':
        adapters[method] = new PSEAdapter()
        break
      case 'pix':
        adapters[method] = new PIXAdapter()
        break
      case 'oxxo':
        adapters[method] = new OXXOAdapter()
        break
      case 'spei':
        adapters[method] = new SPEIAdapter()
        break
    }
  }
  return adapters[method]!
}

/**
 * Type guard: a string is a canonical local payment method name.
 */
export function isLocalPaymentMethod(method: string): method is LocalPaymentMethod {
  return (LOCAL_PAYMENT_METHODS as readonly string[]).includes(method.toLowerCase())
}

/**
 * Factory: returns the adapter for a local payment method, or null if the
 * method is not a known local method.
 *
 * @param method canonical local method name (case-insensitive)
 */
export function getLocalPaymentAdapter(method: LocalPaymentMethod): LocalPaymentAdapter | null {
  if (!isLocalPaymentMethod(method)) return null
  return getAdapter(method.toLowerCase() as LocalPaymentMethod)
}

/**
 * Returns the local payment methods available for a country (ISO 3166-1
 * alpha-2). PSE→CO, PIX→BR, OXXO/SPEI→MX. Unknown countries return an empty
 * array (the caller can then offer the 4 global gateways instead).
 *
 * @param countryCode ISO 3166-1 alpha-2 (CO, BR, MX, ...) — case-insensitive
 */
export function getAvailableLocalPayments(countryCode?: string): LocalPaymentMethod[] {
  if (!countryCode) return [...LOCAL_PAYMENT_METHODS]
  const upper = countryCode.toUpperCase()
  return COUNTRY_METHODS[upper] ?? []
}

// `PSE_BANKS` is already exported at its declaration site above; no
// re-export needed here.

log.debug(
  { methods: LOCAL_PAYMENT_METHODS, countries: Object.keys(COUNTRY_METHODS) },
  'local-payments adapter module loaded',
)
