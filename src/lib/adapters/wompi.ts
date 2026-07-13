// ZIAY — WompiAdapter
// Saramantha §10 — gateway de pago principal en Colombia (Bancolombia).
//
// Integración:
//   - createPaymentLink → POST   /v1/transactions
//   - verifyPayment     → GET    /v1/transactions/{id}
//   - refund            → POST   /v1/transactions/{id}/refund
//   - webhookVerify     → HMAC-SHA256 sobre el body con WOMPI_EVENT_SECRET
//
// Notas:
//   - Todas las cantidades van en CENTAVOS. `toCents` hace la conversión.
//   - El header de webhook es `X-Events-Signature: <hex>`.
//   - En modo sandbox usar `https://sandbox.wompi.co/v1` overrideando
//     `WOMPI_API_BASE` en env (no recomendado en prod).
//
// Env vars:
//   - WOMPI_PUBLIC_KEY   (obligatorio para crear links)
//   - WOMPI_PRIVATE_KEY  (obligatorio para crear/verificar/refund)
//   - WOMPI_EVENT_SECRET (obligatorio para validar webhooks en prod)
//   - PAYMENT_RETURN_URL_SUCCESS (URL de redirección post-checkout)
//
// @see https://docs.wompi.co/docs/en/co/

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PaymentAdapter, PaymentResult, CreatePaymentLinkOptions } from './payment-adapter'
import { stubNoCredentials } from './payment-adapter'

const WOMPI_API_BASE = process.env.WOMPI_API_BASE ?? 'https://production.wompi.co/v1'

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

export class WompiAdapter implements PaymentAdapter {
  name = 'wompi'
  private readonly publicKey = process.env.WOMPI_PUBLIC_KEY ?? ''
  private readonly privateKey = process.env.WOMPI_PRIVATE_KEY ?? ''
  private readonly eventSecret = process.env.WOMPI_EVENT_SECRET ?? ''

  private hasCredentials(): boolean {
    return this.publicKey.length > 0 && this.privateKey.length > 0
  }

  /** Convierte una cantidad en la unidad mayor a centavos enteros. */
  private toCents(amount: number): number {
    return Math.round(amount * 100)
  }

  async createPaymentLink(opts: CreatePaymentLinkOptions): Promise<PaymentResult> {
    if (!this.hasCredentials()) return stubNoCredentials(this.name, opts.amount, opts.currency)
    try {
      const res = await fetch(`${WOMPI_API_BASE}/transactions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.privateKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reference: opts.reference,
          amount_in_cents: this.toCents(opts.amount),
          currency: opts.currency,
          description: opts.description,
          public_key: this.publicKey,
          redirect_url: process.env.PAYMENT_RETURN_URL_SUCCESS ?? undefined,
        }),
      })
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: opts.amount,
          currency: opts.currency,
          message: `Wompi createTransaction ${res.status}`,
          rawResponse: data,
        }
      }
      const tx = (data.data ?? {}) as Record<string, unknown>
      return {
        success: true,
        paymentId: String(tx.id ?? ''),
        url: String(tx.checkout_url ?? ''),
        status: String(tx.status ?? 'PENDING'),
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
        `${WOMPI_API_BASE}/transactions/${encodeURIComponent(paymentId)}`,
        { headers: { Authorization: `Bearer ${this.privateKey}` } },
      )
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        return {
          success: false,
          status: 'error',
          amount: 0,
          currency: '',
          message: `Wompi verify ${res.status}`,
          rawResponse: data,
        }
      }
      const tx = (data.data ?? {}) as Record<string, unknown>
      const status = String(tx.status ?? 'UNKNOWN')
      return {
        success: status === 'APPROVED',
        paymentId: String(tx.id ?? paymentId),
        status,
        amount: Number(tx.amount_in_cents ?? 0) / 100,
        currency: String(tx.currency ?? ''),
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
      const body: Record<string, unknown> = {}
      if (amount !== undefined) body.amount_in_cents = this.toCents(amount)
      const res = await fetch(
        `${WOMPI_API_BASE}/transactions/${encodeURIComponent(paymentId)}/refund`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.privateKey}`,
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
          message: `Wompi refund ${res.status}`,
          rawResponse: data,
        }
      }
      return {
        success: true,
        paymentId,
        status: 'refunded',
        amount: amount ?? 0,
        currency: '',
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
   * Wompi envía el header `X-Events-Signature: <hex>` con HMAC-SHA256 del body
   * usando `WOMPI_EVENT_SECRET` (también llamado "events secret" en el dashboard).
   * @see https://docs.wompi.co/docs/en/co/apks-de-seguridad
   */
  webhookVerify(rawBody: string, signature: string): boolean {
    // Dev-mode fallback: if no secret configured, accept any non-empty signature.
    if (!this.eventSecret) {
      return typeof signature === 'string' && signature.length > 0
    }
    if (!signature) return false
    const expected = createHmac('sha256', this.eventSecret).update(rawBody).digest('hex')
    return safeEqual(expected, signature)
  }
}
