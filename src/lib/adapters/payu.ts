// ZIAY — PayUAdapter
// Saramantha §10 — gateway de pago LATAM (AR, BR, CL, CO, MX, PE).
// API SOAP-like sobre POST JSON, single endpoint `service.cgi`.
//
// Integración:
//   - createPaymentLink → POST  service.cgi  command=SUBMIT_TRANSACTION type=AUTHORIZATION_AND_CAPTURE
//   - verifyPayment     → POST  service.cgi  command=ORDER_DETAIL
//   - refund            → POST  service.cgi  command=SUBMIT_TRANSACTION type=REFUND
//   - webhookVerify     → MD5 of `{apiKey}~{merchantId}~{reference}~{amount}~{currency}~{state_pol}`
//
// Notas:
//   - PayU no maneja "links de pago" nativos — `SUBMIT_TRANSACTION` con
//     `paymentMethod=CODI`/`BANK_REFERENCED` produce un número de transacción
//     y, según el método, una URL de recibo (`URL_PAYMENT_RECEIPT`).
//   - Las cantidades van en la unidad mayor (NO centavos), formato `#.##`.
//   - `signature` para crear transacción es MD5 de
//     `{apiKey}~{merchantId}~{referenceCode}~{amount}~{currency}~1` (state=1).
//   - La firma del webhook es el mismo MD5 pero con `state_pol` real.
//   - Sandbox: https://sandbox.api.payulatam.com/payments-api/4.0/service.cgi
//
// Env vars:
//   - PAYU_API_KEY    (obligatorio)
//   - PAYU_MERCHANT_ID (obligatorio)
//   - PAYU_ACCOUNT_ID (cuenta asociada al país)
//   - PAYU_API_LOGIN  (requerido por la API aunque no se use para firmar)
//   - PAYU_TEST_MODE  ('true' | 'false') — default 'true' para sandbox
//   - PAYU_NOTIFY_URL (URL pública para webhooks PayU)
//   - PAYU_DEFAULT_METHOD (CODI | BANK_REFERENCED | ...)
//   - PAYU_PAYER_EMAIL (email default del pagador)
//   - PAYU_API_BASE   (override; default = producción)
//
// @see https://developers.payulatam.com/latam/en/docs/integrations/api-integration/checkout-api.html

import crypto, { timingSafeEqual } from 'node:crypto'
import type { PaymentAdapter, PaymentResult, CreatePaymentLinkOptions } from './payment-adapter'
import { stubNoCredentials } from './payment-adapter'

const PAYU_API_URL =
  process.env.PAYU_API_BASE ?? 'https://api.payulatam.com/payments-api/4.0/service.cgi'

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

export class PayUAdapter implements PaymentAdapter {
  name = 'payu'
  private readonly apiKey = process.env.PAYU_API_KEY ?? ''
  private readonly merchantId = process.env.PAYU_MERCHANT_ID ?? ''
  private readonly accountId = process.env.PAYU_ACCOUNT_ID ?? ''
  private readonly apiLogin = process.env.PAYU_API_LOGIN ?? ''
  private readonly isTest = (process.env.PAYU_TEST_MODE ?? 'true') === 'true'

  private hasCredentials(): boolean {
    return this.apiKey.length > 0 && this.merchantId.length > 0
  }

  /**
   * Calcula la firma MD5 que PayU exige en `order.signature` y en la
   * verificación del webhook. Formato:
   *   `{apiKey}~{merchantId}~{reference}~{amount}~{currency}~{state}`
   */
  private sign(reference: string, amount: number, currency: string, state: string): string {
    const raw = `${this.apiKey}~${this.merchantId}~${reference}~${amount}~${currency}~${state}`
    return crypto.createHash('md5').update(raw).digest('hex')
  }

  async createPaymentLink(opts: CreatePaymentLinkOptions): Promise<PaymentResult> {
    if (!this.hasCredentials()) return stubNoCredentials(this.name, opts.amount, opts.currency)
    try {
      const signature = this.sign(opts.reference, opts.amount, opts.currency, '1')
      const payload = {
        language: 'en',
        command: 'SUBMIT_TRANSACTION',
        merchant: {
          apiKey: this.apiKey,
          apiLogin: this.apiLogin,
          merchantId: this.merchantId,
        },
        transaction: {
          order: {
            accountId: this.accountId,
            referenceCode: opts.reference,
            description: opts.description.slice(0, 255),
            language: 'en',
            signature,
            notifyUrl: process.env.PAYU_NOTIFY_URL ?? '',
            additionalValues: {
              TX_VALUE: {
                value: Number(opts.amount.toFixed(2)),
                currency: opts.currency,
              },
            },
          },
          payer: {
            merchantBuyerId: opts.reference,
            fullName: 'ZIAY Customer',
            emailAddress:
              process.env.PAYU_PAYER_EMAIL ?? 'noreply@commerceflow.app',
          },
          type: 'AUTHORIZATION_AND_CAPTURE',
          paymentMethod: process.env.PAYU_DEFAULT_METHOD ?? 'CODI',
          paymentCountry: opts.currency === 'COP' ? 'CO' : 'MX',
          deviceSessionId: crypto.randomUUID(),
          // PayU expects the buyer's IP for fraud detection. Default to
          // 127.0.0.1 (sandbox-safe); in production set PAYU_PAYER_IP to the
          // actual buyer IP derived from the request `x-forwarded-for` header.
          ipAddress: process.env.PAYU_PAYER_IP ?? '127.0.0.1',
          cookie: 'N/A',
          userAgent: 'ZIAY/1.0',
        },
        test: this.isTest,
      }
      const res = await fetch(PAYU_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok || data?.error) {
        return {
          success: false,
          status: 'error',
          amount: opts.amount,
          currency: opts.currency,
          message: String(data?.error ?? `PayU createTransaction ${res.status}`),
          rawResponse: data,
        }
      }
      const tx = (data?.transactionResponse ?? {}) as Record<string, unknown>
      const extras = (tx.extraParameters ?? {}) as Record<string, unknown>
      const state = String(tx.state ?? 'PENDING')
      return {
        success: state === 'APPROVED',
        paymentId: String(tx.orderId ?? tx.transactionId ?? ''),
        url: String(extras.URL_PAYMENT_RECEIPT ?? extras.url ?? ''),
        status: state,
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
      const payload = {
        language: 'en',
        command: 'ORDER_DETAIL',
        merchant: {
          apiKey: this.apiKey,
          apiLogin: this.apiLogin,
          merchantId: this.merchantId,
        },
        details: { orderId: paymentId },
        test: this.isTest,
      }
      const res = await fetch(PAYU_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok || data?.error) {
        return {
          success: false,
          status: 'error',
          amount: 0,
          currency: '',
          message: String(data?.error ?? `PayU ORDER_DETAIL ${res.status}`),
          rawResponse: data,
        }
      }
      const result = (data?.result ?? {}) as Record<string, unknown>
      const rawPayload = result?.payload
      const tx = Array.isArray(rawPayload) ? (rawPayload[0] ?? {}) : (rawPayload ?? {})
      const state = String((tx as Record<string, unknown>)?.state ?? 'PENDING')
      const addValues = ((tx as Record<string, unknown>)?.additionalValues ?? {}) as Record<string, unknown>
      const txValue = (addValues.TX_VALUE ?? {}) as Record<string, unknown>
      return {
        success: state === 'APPROVED',
        paymentId: String((tx as Record<string, unknown>)?.orderId ?? paymentId),
        status: state,
        amount: Number(txValue.value ?? 0),
        currency: String(txValue.currency ?? ''),
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
      const payload = {
        language: 'en',
        command: 'SUBMIT_TRANSACTION',
        merchant: {
          apiKey: this.apiKey,
          apiLogin: this.apiLogin,
          merchantId: this.merchantId,
        },
        transaction: {
          order: { id: paymentId },
          type: 'REFUND',
          parentTransactionId: paymentId,
          reason: 'Customer requested refund',
          ...(amount !== undefined ? { amount: Number(amount.toFixed(2)) } : {}),
        },
        test: this.isTest,
      }
      const res = await fetch(PAYU_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok || data?.error) {
        return {
          success: false,
          status: 'error',
          amount: amount ?? 0,
          currency: '',
          message: String(data?.error ?? `PayU refund ${res.status}`),
          rawResponse: data,
        }
      }
      const tx = (data?.transactionResponse ?? {}) as Record<string, unknown>
      const state = String(tx.state ?? 'refunded')
      return {
        success: state === 'APPROVED',
        paymentId: String(tx.orderId ?? paymentId),
        status: state,
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
   * PayU notifica vía webhook con un body que incluye `reference_sale`,
   * `value`, `currency` y `state_pol`. La firma MD5 esperada es
   *   `{apiKey}~{merchantId}~{reference}~{amount}~{currency}~{state_pol}`
   * El header que transporta la firma varía según configuración del merchant
   * (a veces `x-payu-signature`, a veces `sign` dentro del body); el webhook
   * route normaliza ambos y pasa la firma como `signature` aquí.
   *
   * @see https://developers.payulatam.com/latam/en/docs/integrations/api-integration/notifications.html
   */
  webhookVerify(rawBody: string, signature: string): boolean {
    // Dev-mode fallback: if no creds configured, throw in production (forged
    // webhooks would be silently accepted) and allow in dev with a warning.
    // FIX-REALTIME-WEBHOOKS-001 · R3.
    if (!this.apiKey || !this.merchantId) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('PayU credentials not configured in production')
      }
      console.warn(
        '[payu] credentials not configured — skipping verification in dev mode',
      )
      return true
    }
    if (!signature) return false
    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>
      const reference = String(body?.reference_sale ?? body?.referenceCode ?? body?.reference ?? '')
      const amount = Number(body?.value ?? body?.amount ?? 0)
      const currency = String(body?.currency ?? body?.currency_iso ?? '')
      const state = String(body?.state_pol ?? body?.state ?? '')
      if (!reference || !amount || !currency || !state) return false
      const expected = this.sign(reference, amount, currency, state)
      return safeEqual(expected, signature)
    } catch {
      return false
    }
  }
}
