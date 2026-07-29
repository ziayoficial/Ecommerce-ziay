// ZIAY — DIAN electronic invoicing via Alegra provider.
//
// SPRINT-LEGAL-FINAL-001 — closes the gap flagged by AUDIT-LEGAL-COMPLIANCE-001
// item 2: the DIAN submission seam in `compliance/dian-invoicing.ts` was a
// stub returning `accepted: false`. This adapter wires the real provider
// (Alegra — a DIAN-authorized billing platform widely used in Colombia).
// See ADR-0020 for the decision record.
//
// What Alegra handles for us:
//   - XML signing + digital certificate management (we'd otherwise need to
//     implement Resolución DIAN 165 de 2023 Anexo Técnico ourselves).
//   - Submission to DIAN's recepción endpoint + polling for aceptación.
//   - PDF representación gráfica + email delivery to the customer.
//   - CUFE generation server-side (we still generate our own CUFE locally
//     in `dian-invoicing.ts` for the pre-submission QR/PDF — Alegra's CUFE
//     is the authoritative one post-submission; we overwrite on success).
//
// API docs: https://developer.alegra.com/
//
// Flow (orchestrated by `submitToDian()` in dian-invoicing.ts):
//   1. Create invoice in Alegra with order data (POST /invoices).
//   2. Alegra submits to DIAN automatically (the `stamp.generate: true`
//      field tells Alegra to stamp + submit).
//   3. Alegra returns CUFE + DIAN validation URL synchronously (status
//      `pending` — DIAN takes ~5s to validate) or asynchronously via
//      webhook (not configured here — `checkStatus()` polls instead).
//   4. `checkStatus()` can be called later to poll for the final
//      `accepted` / `rejected` state.
//   5. `sendByEmail()` sends the PDF to the customer.
//
// Credentials via env: `ALEGRA_TOKEN` (Bearer) + `ALEGRA_USERNAME`
// (Alegra account id — sent as `X-Account-Id` header). When either is
// missing, `isConfigured()` returns false and `createInvoice()` returns
// null — the caller (`submitToDian`) surfaces a clear Spanish message.

import { logger } from '@/lib/logger'

const ALEGRA_API_BASE =
  process.env.ALEGRA_API_BASE ?? 'https://api.alegra.com/api/v1'

export interface AlegraInvoice {
  id: string
  number: string
  cufe: string
  dianStatus: string // "accepted" | "rejected" | "pending"
  dianValidationUrl: string
  pdfUrl: string
}

/**
 * Alegra DIAN adapter — wraps the Alegra REST API for factura electrónica
 * submission, status polling, and PDF email delivery.
 *
 * Singleton via `getAlegraDianAdapter()` so the env-var reads happen once
 * per process. Re-instantiation is cheap (no connection pool), but the
 * factory keeps the API surface stable if we later add caching.
 */
export class AlegraDianAdapter {
  private token: string
  private username: string

  constructor() {
    this.token = process.env.ALEGRA_TOKEN || ''
    this.username = process.env.ALEGRA_USERNAME || ''

    if (!this.token || !this.username) {
      logger.warn(
        'Alegra credentials not configured — DIAN submission will be skipped',
      )
    }
  }

  /** True when both `ALEGRA_TOKEN` and `ALEGRA_USERNAME` are set. */
  isConfigured(): boolean {
    return !!this.token && !!this.username
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'X-Account-Id': this.username,
    }
  }

  /**
   * Create + submit an invoice to DIAN via Alegra.
   *
   * Returns `null` when:
   *   - Alegra is not configured (env vars missing) — caller should skip.
   *   - The API call fails (network, 4xx, 5xx) — caller should retry
   *     manually + surface the error.
   *
   * On success, returns the Alegra invoice id + the DIAN-issued CUFE +
   * the public DIAN validation URL (for the QR code) + the PDF URL.
   */
  async createInvoice(params: {
    orderId: string
    tenantId: string
    invoiceNumber: string
    emitterNit: string
    emitterName: string
    receiverNit: string
    receiverName: string
    receiverEmail: string
    items: {
      code: string
      description: string
      quantity: number
      price: number
      total: number
    }[]
    subtotal: number
    ivaAmount: number
    total: number
  }): Promise<AlegraInvoice | null> {
    if (!this.isConfigured()) {
      logger.warn(
        { orderId: params.orderId },
        'Alegra not configured — skipping DIAN submission',
      )
      return null
    }

    try {
      const body = {
        date: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        number: params.invoiceNumber,
        client: {
          identification: params.receiverNit,
          name: params.receiverName,
          email: params.receiverEmail,
        },
        items: params.items.map((item) => ({
          id: item.code,
          name: item.description,
          description: item.description,
          price: item.price,
          quantity: item.quantity,
          // Alegra's tax id "6" is the canonical IVA 19% tax object —
          // pre-created in every Alegra account by default. We pass the
          // full object so Alegra creates it on-the-fly if missing.
          tax: [{ id: '6', name: 'IVA 19%', percentage: 19 }],
        })),
        // Electronic invoice fields — `stamp.generate: true` tells Alegra
        // to sign + submit to DIAN. Without this, Alegra only creates a
        // draft invoice (no CUFE, no DIAN submission).
        stamp: {
          generate: true,
        },
      }

      const res = await fetch(`${ALEGRA_API_BASE}/invoices`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })

      if (!res.ok) {
        const errText = await res.text()
        logger.error(
          { status: res.status, errText, orderId: params.orderId },
          'Alegra invoice creation failed',
        )
        return null
      }

      const data = (await res.json()) as {
        id: string
        number?: { string?: string } | string
        cufe?: string
        stamp?: { status?: string; cufe?: string }
        dianStatus?: string
        dianValidationUrl?: string
        pdfUrl?: string
      }

      // Alegra returns `number` as `{ string: "SETP-0001" }` (a tagged
      // union for nullable strings) in some API versions + a plain string
      // in others. Handle both.
      const numberStr =
        typeof data.number === 'string'
          ? data.number
          : data.number?.string || params.invoiceNumber

      const cufe = data.cufe || data.stamp?.cufe || ''
      const dianStatus =
        data.dianStatus ||
        (data.stamp?.status === 'accepted' ? 'accepted' : 'pending')

      return {
        id: data.id,
        number: numberStr,
        cufe,
        dianStatus,
        dianValidationUrl:
          data.dianValidationUrl ||
          `https://catalogo-vpfe.dian.gov.co/Document/ShowDocument/${cufe}`,
        pdfUrl: data.pdfUrl || '',
      }
    } catch (error) {
      logger.error(
        { err: error, orderId: params.orderId },
        'Alegra API error',
      )
      return null
    }
  }

  /**
   * Check DIAN validation status of an existing invoice.
   *
   * Used to poll a previously-created invoice that returned
   * `dianStatus: 'pending'` — DIAN's async validation typically completes
   * within ~5s but can take up to 60s under load.
   *
   * Returns `null` on any error (network, 4xx, 5xx, parse) — callers
   * should treat null as "status unknown, retry later".
   */
  async checkStatus(
    invoiceId: string,
  ): Promise<{ dianStatus: string; cufe?: string } | null> {
    if (!this.isConfigured()) return null

    try {
      const res = await fetch(`${ALEGRA_API_BASE}/invoices/${invoiceId}`, {
        headers: this.headers,
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) return null

      const data = (await res.json()) as {
        cufe?: string
        dianStatus?: string
        stamp?: { status?: string; cufe?: string }
      }

      return {
        dianStatus:
          data.dianStatus ||
          (data.stamp?.status === 'accepted' ? 'accepted' : 'pending'),
        cufe: data.cufe || data.stamp?.cufe,
      }
    } catch {
      return null
    }
  }

  /**
   * Send invoice PDF to customer via email.
   *
   * Alegra queues the email + sends from the configured sender address
   * (the tenant's Alegra account email). Returns `true` on 2xx, `false`
   * on any error — best-effort, callers should not block the submission
   * flow on this.
   */
  async sendByEmail(invoiceId: string, email: string): Promise<boolean> {
    if (!this.isConfigured()) return false

    try {
      const res = await fetch(`${ALEGRA_API_BASE}/invoices/${invoiceId}/email`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(10_000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────
// Singleton — env-var reads happen once per process. The adapter is
// stateless (each call hits the Alegra API), so the singleton is safe
// across concurrent requests.
let _adapter: AlegraDianAdapter | null = null

export function getAlegraDianAdapter(): AlegraDianAdapter {
  if (!_adapter) _adapter = new AlegraDianAdapter()
  return _adapter
}
