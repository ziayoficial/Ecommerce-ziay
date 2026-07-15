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
      const body = formEncode({
        payment_intent: paymentId,
        ...(amount !== undefined ? { amount: this.toCents(amount) } : {}),
      })
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
