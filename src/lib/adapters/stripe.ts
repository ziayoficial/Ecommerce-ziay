// ZIAY — StripeAdapter
// Saramantha §10 — gateway de pago global (US/EU/APAC). Cantidades en centavos.
//
// Integración:
//   - createPaymentLink → POST /v1/checkout/sessions     (form-encoded)
//   - verifyPayment     → GET  /v1/checkout/sessions/{id}
//   - refund            → POST /v1/refunds
//   - webhookVerify     → HMAC-SHA256 sobre `<t>.<body>` con STRIPE_WEBHOOK_SECRET
//
// Notas:
//   - La API de Stripe usa `application/x-www-form-urlencoded`, no JSON.
//     `formEncode` convierte un objeto anidado en params con la convención
//     `key[i]` para arrays y `key[nested]` para sub-objetos.
//   - Cantidades en centavos: $150.00 → `amount=15000`.
//   - El header de webhook es `stripe-signature: t=<ts>,v1=<hex>`.
//
// Env vars:
//   - STRIPE_SECRET_KEY     (obligatorio para producir links reales)
//   - STRIPE_WEBHOOK_SECRET (obligatorio para validar webhooks en prod)
//   - PAYMENT_RETURN_URL_SUCCESS / FAILURE
//
// @see https://stripe.com/docs/api
// @see https://stripe.com/docs/webhooks/signatures

import crypto, { timingSafeEqual } from 'node:crypto'
import type { PaymentAdapter, PaymentResult, CreatePaymentLinkOptions } from './payment-adapter'
import { stubNoCredentials } from './payment-adapter'

const STRIPE_API_BASE = process.env.STRIPE_API_BASE ?? 'https://api.stripe.com/v1'

/**
 * Parses a `k=v,k=v` signature header (Stripe `stripe-signature` and
 * MercadoPago `x-signature` both use this format) into a key/value map.
 *
 * Example: `"ts=1700000000,v1=abc123"` → `{ ts: "1700000000", v1: "abc123" }`
 */
function parseSignatureHeader(header: string): Record<string, string> {
  return header.split(',').reduce<Record<string, string>>((acc, part) => {
    const idx = part.indexOf('=')
    if (idx > 0) {
      const k = part.slice(0, idx).trim()
      const v = part.slice(idx + 1).trim()
      if (k) acc[k] = v
    }
    return acc
  }, {})
}

/** Timing-safe string comparison (returns false on length mismatch without throwing). */
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

/**
 * Convierte un objeto (potencialmente anidado) en un string form-encoded
 * compatible con la API de Stripe. Arrays → `key[i]`, sub-objetos → `key[nested]`.
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

export class StripeAdapter implements PaymentAdapter {
  name = 'stripe'
  private readonly secretKey = process.env.STRIPE_SECRET_KEY ?? ''
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''

  private hasCredentials(): boolean {
    return this.secretKey.length > 0
  }

  /** Convierte una cantidad en la unidad mayor a centavos enteros. */
  private toCents(amount: number): number {
    return Math.round(amount * 100)
  }

  async createPaymentLink(opts: CreatePaymentLinkOptions): Promise<PaymentResult> {
    if (!this.hasCredentials()) return stubNoCredentials(this.name, opts.amount, opts.currency)
    try {
      const body = formEncode({
        mode: 'payment',
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': opts.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': this.toCents(opts.amount),
        'line_items[0][price_data][product_data][name]': opts.description.slice(0, 256),
        client_reference_id: opts.reference,
        success_url: process.env.PAYMENT_RETURN_URL_SUCCESS ?? '',
        cancel_url: process.env.PAYMENT_RETURN_URL_FAILURE ?? '',
        // I2-R3 — 3DS / SCA enforcement (BACEN Brazil + PSD2 EU compliance).
        // `request_three_d_secure: 'any'` tells Stripe to challenge EVERY
        // card payment with 3D Secure, even when the card's issuer doesn't
        // strictly require it. This is mandated by:
        //   - Brazil BACEN Resolução 4.658/2018 (Strong Customer Auth)
        //   - EU PSD2 RTS Art. 18 (SCA for card-not-present)
        // The 'any' value is the most defensive setting — it shifts fraud
        // liability to the issuer for transactions where 3DS is available.
        // For 'automatic' (the default), Stripe only challenges when the
        // issuer mandates it, which leaves the merchant liable for some
        // fraudulent chargebacks.
        // @see https://stripe.com/docs/payments/3d-secure
        'payment_method_options[card][request_three_d_secure]': 'any',
      })
      const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
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
          status: 'error',
          amount: opts.amount,
          currency: opts.currency,
          message: `Stripe createSession ${res.status}`,
          rawResponse: data,
        }
      }
      return {
        success: true,
        paymentId: String(data.id ?? ''),
        url: String(data.url ?? ''),
        status: String(data.status ?? 'open'),
        amount: opts.amount,
        currency: opts.currency,
        rawResponse: data,
      }
    } catch (err) {
      return {
        success: false,
        status: 'error',
        amount: opts.amount,
        currency: opts.currency,
        message: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }

  async verifyPayment(paymentId: string): Promise<PaymentResult> {
    if (!this.hasCredentials()) return stubNoCredentials(this.name, 0, '')
    try {
      const res = await fetch(
        `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(paymentId)}`,
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      )
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: 0,
          currency: '',
          message: `Stripe verify ${res.status}`,
          rawResponse: data,
        }
      }
      const status = String(data.payment_status ?? data.status ?? 'unknown')
      return {
        success: status === 'paid',
        paymentId: String(data.id ?? paymentId),
        url: String(data.url ?? ''),
        status,
        amount: Number(data.amount_total ?? 0) / 100,
        currency: String(data.currency ?? '').toUpperCase(),
        rawResponse: data,
      }
    } catch (err) {
      return {
        success: false,
        status: 'error',
        amount: 0,
        currency: '',
        message: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }

  async refund(paymentId: string, amount?: number): Promise<PaymentResult> {
    if (!this.hasCredentials()) return stubNoCredentials(this.name, amount ?? 0, '')
    try {
      // ── AUDIT-FINTECH R-7 — resolve the right Stripe object for refund ──
      // ZIAY stores the *Checkout Session* ID (`cs_...`) as `Order.paymentRef`
      // for Stripe orders. `POST /v1/refunds` expects either a `payment_intent`
      // (`pi_...`) or a `charge` (`ch_...`), NOT a Checkout Session — so the
      // previous implementation (passing `paymentId` straight as
      // `payment_intent`) failed for every Stripe refund.
      //
      // Strategy:
      //   - `pi_*` → use as `payment_intent` (backward compat).
      //   - `ch_*` → use as `charge` (legacy charge-based orders).
      //   - `cs_*` → fetch the Checkout Session, read its `payment_intent`
      //              field, then use that PI for the refund. If the session
      //              has no PI yet (e.g. still pending), surface a clear error.
      let paymentIntentId: string | undefined
      let chargeId: string | undefined

      if (paymentId.startsWith('pi_')) {
        paymentIntentId = paymentId
      } else if (paymentId.startsWith('ch_')) {
        chargeId = paymentId
      } else if (paymentId.startsWith('cs_')) {
        const sessionRes = await fetch(
          `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(paymentId)}`,
          { headers: { Authorization: `Bearer ${this.secretKey}` } },
        )
        const sessionData = (await sessionRes.json()) as Record<string, unknown>
        if (!sessionRes.ok) {
          return {
            success: false,
            status: 'error',
            amount: amount ?? 0,
            currency: '',
            message: `Stripe refund: failed to load checkout session ${paymentId} (${sessionRes.status})`,
            rawResponse: sessionData,
          }
        }
        // `payment_intent` is returned as a string for Checkout Sessions
        // created with `mode=payment`. Expand if you need the full PI object,
        // but the ID is enough for `POST /v1/refunds`.
        const pi = sessionData.payment_intent
        paymentIntentId = typeof pi === 'string' && pi.startsWith('pi_') ? pi : undefined
        // Older sessions / `mode=payment` may report the charge instead.
        const ch = sessionData.charges
        if (!paymentIntentId && ch && typeof ch === 'object') {
          const data = (ch as { data?: Array<{ id?: string }> }).data
          const firstChargeId = data?.[0]?.id
          if (typeof firstChargeId === 'string' && firstChargeId.startsWith('ch_')) {
            chargeId = firstChargeId
          }
        }
        if (!paymentIntentId && !chargeId) {
          return {
            success: false,
            status: 'error',
            amount: amount ?? 0,
            currency: '',
            message: `Stripe refund: checkout session ${paymentId} has no payment_intent/charge yet (payment not captured?)`,
            rawResponse: sessionData,
          }
        }
      } else {
        // Unknown prefix — surface a clear error rather than sending a
        // malformed refund request to Stripe. Backward-compat fallback for
        // anything pre-existing that didn't follow the `cs_/pi_/ch_` rule.
        return {
          success: false,
          status: 'error',
          amount: amount ?? 0,
          currency: '',
          message: `Stripe refund: unsupported paymentId prefix '${paymentId.slice(0, 4)}' (expected cs_, pi_, or ch_)`,
        }
      }

      const refundBody: Record<string, unknown> = {}
      if (paymentIntentId) refundBody.payment_intent = paymentIntentId
      if (chargeId) refundBody.charge = chargeId
      if (amount !== undefined) refundBody.amount = this.toCents(amount)

      const body = formEncode(refundBody)
      const res = await fetch(`${STRIPE_API_BASE}/refunds`, {
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
          status: 'error',
          amount: amount ?? 0,
          currency: '',
          message: `Stripe refund ${res.status}`,
          rawResponse: data,
        }
      }
      return {
        success: true,
        paymentId: String(data.id ?? paymentId),
        status: String(data.status ?? 'succeeded'),
        amount: Number(data.amount ?? 0) / 100,
        currency: String(data.currency ?? '').toUpperCase(),
        rawResponse: data,
      }
    } catch (err) {
      return {
        success: false,
        status: 'error',
        amount: amount ?? 0,
        currency: '',
        message: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }

  /**
   * Stripe envía el header `stripe-signature: t=<ts>,v1=<hex>`.
   * El HMAC es `HMAC-SHA256(secret, "<ts>.<body>")`.
   * @see https://stripe.com/docs/webhooks/signatures
   *
   * SPRINT-FIXES-FINAL-001 §4 — `secretOverride` opcional para rotación.
   * Cuando se pasa, se usa ese secreto en lugar de `this.webhookSecret`
   * (útil para verificar con `STRIPE_WEBHOOK_SECRET_OLD` durante el grace
   * period de rotación).
   */
  webhookVerify(rawBody: string, signature: string, secretOverride?: string): boolean {
    const secret = secretOverride ?? this.webhookSecret
    // Dev-mode fallback: if no secret configured, throw in production (forged
    // webhooks would be silently accepted) and allow in dev with a warning.
    // FIX-REALTIME-WEBHOOKS-001 · R3.
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Stripe webhook secret not configured in production')
      }
      console.warn(
        '[stripe] webhook secret not configured — skipping verification in dev mode',
      )
      return true
    }
    if (!signature) return false
    const parts = parseSignatureHeader(signature)
    const t = parts.t
    const v1 = parts.v1
    if (!t || !v1) return false
    const manifest = `${t}.${rawBody}`
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
    return safeEqual(expected, v1)
  }
}
