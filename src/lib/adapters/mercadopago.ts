// ZIAY — MercadoPagoAdapter
// Saramantha §10 — gateway de pago principal para LATAM (AR, BR, MX, CO, CL, PE, UY, EC).
//
// Integración:
//   - createPaymentLink → POST /checkout/preferences
//   - verifyPayment     → GET  /v1/payments/{id}
//   - refund            → POST /v1/payments/{id}/refunds
//   - webhookVerify     → HMAC-SHA256 sobre `<ts>.<body>` con MERCADOPAGO_WEBHOOK_SECRET
//
// Env vars:
//   - MERCADOPAGO_ACCESS_TOKEN   (obligatorio para producir links reales)
//   - MERCADOPAGO_WEBHOOK_SECRET (obligatorio para validar webhooks en prod)
//   - PAYMENT_RETURN_URL_SUCCESS / PENDING / FAILURE (URLs de retorno post-checkout)
//
// Dev-mode: cuando MERCADOPAGO_WEBHOOK_SECRET no está configurado, webhookVerify
// acepta cualquier firma no vacía para no romper el flujo local.
//
// @see https://www.mercadopago.com.co/developers/es/docs/checkout-api/integration-configuration/integration-with-api
// @see https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks

import crypto, { timingSafeEqual } from 'node:crypto'
import type { PaymentAdapter, PaymentResult, CreatePaymentLinkOptions } from './payment-adapter'
import { stubNoCredentials } from './payment-adapter'

const MP_API_BASE = process.env.MERCADOPAGO_API_BASE ?? 'https://api.mercadopago.com'

/**
 * Parses a `k=v,k=v` signature header (MercadoPago `x-signature` and Stripe
 * `stripe-signature` both use this format) into a key/value map.
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

export class MercadoPagoAdapter implements PaymentAdapter {
  name = 'mercadopago'
  private readonly accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN ?? ''
  private readonly webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? ''

  private hasCredentials(): boolean {
    return this.accessToken.length > 0
  }

  async createPaymentLink(opts: CreatePaymentLinkOptions): Promise<PaymentResult> {
    if (!this.hasCredentials()) return stubNoCredentials(this.name, opts.amount, opts.currency)
    try {
      const res = await fetch(`${MP_API_BASE}/checkout/preferences`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              title: opts.description.slice(0, 256),
              quantity: 1,
              unit_price: Number(opts.amount.toFixed(2)),
              currency_id: opts.currency,
            },
          ],
          external_reference: opts.reference,
          auto_return: 'approved',
          back_urls: {
            success: process.env.PAYMENT_RETURN_URL_SUCCESS ?? '',
            pending: process.env.PAYMENT_RETURN_URL_PENDING ?? '',
            failure: process.env.PAYMENT_RETURN_URL_FAILURE ?? '',
          },
          statement_descriptor: 'COMMERCEFLOW',
        }),
      })
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: opts.amount,
          currency: opts.currency,
          message: `MercadoPago createPreferences ${res.status}`,
          rawResponse: data,
        }
      }
      return {
        success: true,
        paymentId: String(data.id ?? ''),
        url: String(data.init_point ?? data.sandbox_init_point ?? ''),
        status: 'pending',
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
        `${MP_API_BASE}/v1/payments/${encodeURIComponent(paymentId)}`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      )
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: 0,
          currency: '',
          message: `MercadoPago verify ${res.status}`,
          rawResponse: data,
        }
      }
      const status = String(data.status ?? 'unknown')
      return {
        success: status === 'approved',
        paymentId: String(data.id ?? paymentId),
        status,
        amount: Number(data.transaction_amount ?? 0),
        currency: String(data.currency_id ?? ''),
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
      const body = amount !== undefined ? { amount: Number(amount.toFixed(2)) } : {}
      const res = await fetch(
        `${MP_API_BASE}/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      )
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: amount ?? 0,
          currency: '',
          message: `MercadoPago refund ${res.status}`,
          rawResponse: data,
        }
      }
      return {
        success: true,
        paymentId,
        status: 'refunded',
        amount: Number(data.amount ?? amount ?? 0),
        currency: String(data.currency_id ?? ''),
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
   * MercadoPago envía el header `x-signature` con formato `ts=<ts>,v1=<hex>`.
   * El HMAC es `HMAC-SHA256(secret, "<ts>.<body>")`.
   * @see https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks/webhooks-mp
   */
  webhookVerify(rawBody: string, signature: string): boolean {
    // Dev-mode fallback: if no secret configured, throw in production (forged
    // webhooks would be silently accepted) and allow in dev with a warning.
    // FIX-REALTIME-WEBHOOKS-001 · R3.
    if (!this.webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('MercadoPago webhook secret not configured in production')
      }
      console.warn(
        '[mercadopago] webhook secret not configured — skipping verification in dev mode',
      )
      return true
    }
    if (!signature) return false
    const parts = parseSignatureHeader(signature)
    const ts = parts.ts
    const v1 = parts.v1
    if (!ts || !v1) return false
    const manifest = `${ts}.${rawBody}`
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(manifest).digest('hex')
    return safeEqual(expected, v1)
  }
}
