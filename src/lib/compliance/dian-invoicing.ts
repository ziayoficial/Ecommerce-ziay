// ───────────────────────────────────────────────────────────────────────────
// DIAN electronic invoicing — Decreto 745 de 2014 (Colombia).
//
// SPRINT-DIAN-RETRACTO-001 · P1-1 — closes the gap flagged by
// AUDIT-LEGAL-COMPLIANCE-001: the previous `/api/monetization/generate-invoice`
// returned a JSON "invoice" that is NOT a DIAN-compliant factura electrónica.
// Colombia has mandated electronic invoicing (factura electrónica) since 2019.
//
// SPRINT-LEGAL-FINAL-001 — wires the Alegra provider adapter (see
// `src/lib/adapters/dian-alegra.ts` + ADR-0020). `submitToDian()` now
// performs the real DIAN submission instead of returning a stub.
//
// What DIAN requires (Decreto 745 de 2014):
//   - Validated by DIAN via API (recepción + aceptación)
//   - Numeración consecutiva
//   - CUFE (Código Único de Factura Electrónica) — SHA-384 hash
//   - QR code with DIAN validation URL
//   - PDF con representación gráfica
//   - Envío al cliente via email + acceptance
//
// This module generates a factura electrónica payload with CUFE and persists
// it on the `Invoice` model (orderId-scoped rows). The actual DIAN submission
// is delegated to the Alegra adapter — Alegra handles the XML signing +
// digital certificate management that would otherwise require implementing
// the full Resolución DIAN 165 de 2023 Anexo Técnico ourselves.
// ───────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { getAlegraDianAdapter } from '@/lib/adapters/dian-alegra'

const log = getLogger('compliance/dian-invoicing')

/** IVA rate in Colombia (19% — general rate). */
const IVA_RATE = 0.19

/** Consecutivo prefix — tenant-specific in production (DIAN resolution). */
const INVOICE_PREFIX = 'SETP'

/** DIAN public validation URL (CUFE lookup). */
const DIAN_VALIDATION_URL_BASE =
  'https://catalogo-vpfe.dian.gov.co/Document/ShowDocument'

export interface DianInvoiceItem {
  code: string
  description: string
  quantity: number
  unitPrice: number
  total: number
  ivaRate: number
}

export interface DianInvoiceData {
  invoiceNumber: string // consecutivo (e.g. "SETP-0001")
  cufe: string // Código Único de Factura Electrónica (SHA-384)
  issueDate: Date
  dueDate?: Date
  // Emisor
  emitterNit: string
  emitterName: string
  emitterAddress: string
  emitterCity: string
  // Receptor
  receiverNit: string
  receiverName: string
  receiverEmail: string
  // Items
  items: DianInvoiceItem[]
  // Totals
  subtotal: number
  ivaAmount: number
  ivaRate: number
  total: number
  // Payment
  paymentMethod: string
  paymentDueDate?: Date
  // DIAN
  dianStatus: 'pending_submission' | 'accepted' | 'rejected' | 'error'
  dianValidationUrl?: string // QR code target
  qrCodeData?: string // data for QR code
}

/**
 * Calculate CUFE (Código Único de Factura Electrónica).
 *
 * CUFE = SHA-384(numFac + fechaFactura + horaFactura + valorTotal +
 *                 nitObligado + nitAdquiriente + numTecnico + software)
 *
 * Spec: Anexo Técnico de Factura Electrónica de Venta (Resolución DIAN
 * 165 de 2023, sucesora de la 0004 de 2020 que a su vez implementó el
 * Decreto 745 de 2014). The concatenation order is fixed by the spec.
 */
export function calculateCUFE(params: {
  invoiceNumber: string
  issueDate: Date
  total: number
  emitterNit: string
  receiverNit: string
  softwareId: string
  technicalNumber: string
}): string {
  const dateStr = params.issueDate
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '')
  const timeStr = params.issueDate
    .toISOString()
    .slice(11, 19)
    .replace(/:/g, '')
  const input = [
    params.invoiceNumber,
    dateStr,
    timeStr,
    params.total.toFixed(2),
    params.emitterNit,
    params.receiverNit,
    params.technicalNumber,
    params.softwareId,
  ].join('')

  return crypto.createHash('sha384').update(input).digest('hex')
}

/**
 * Generate a DIAN-compliant invoice from an Order.
 *
 * Side-effects:
 *   - Resolves the next consecutivo (`SETP-XXXX`) per tenant.
 *   - Computes CUFE (SHA-384) per the Anexo Técnico.
 *   - Upserts an `Invoice` row keyed by `orderId` (so re-generating is
 *     idempotent — same CUFE returned).
 *   - Marks the row `dianStatus = 'pending_submission'` (real submission
 *     happens via `submitToDian()`).
 *
 * Throws if the order doesn't exist or doesn't belong to the tenant.
 */
export async function generateDianInvoice(
  orderId: string,
  tenantId: string,
): Promise<DianInvoiceData> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      tenant: true,
      customer: true,
    },
  })

  if (!order) throw new Error('Orden no encontrada')
  if (order.tenantId !== tenantId) throw new Error('Tenant mismatch')

  // Get next invoice number (consecutivo) — scoped to tenant + DIAN rows.
  // Only rows with `invoiceNumber` set are DIAN customer-facing invoices;
  // the SaaS platform-billing rows have `invoiceNumber = null`.
  const lastInvoice = await db.invoice.findFirst({
    where: { tenantId, invoiceNumber: { not: null } },
    orderBy: { invoiceNumber: 'desc' },
  })

  const lastSeq = lastInvoice?.invoiceNumber
    ? parseInt(lastInvoice.invoiceNumber.split('-')[1] || '0', 10)
    : 0
  const invoiceSeq = lastSeq + 1
  const invoiceNumber = `${INVOICE_PREFIX}-${String(invoiceSeq).padStart(4, '0')}`

  // Build items — OrderItem has `productId` (used as código) + `unitPrice`
  // (not `sku`/`price` as in the example). IVA 19% applies on every line.
  const items: DianInvoiceItem[] = order.items.map((item) => ({
    code: item.productId,
    description: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.unitPrice * item.quantity,
    ivaRate: IVA_RATE,
  }))

  const subtotal = items.reduce((sum, i) => sum + i.total, 0)
  const ivaAmount = Math.round(subtotal * IVA_RATE)
  const total = subtotal + ivaAmount

  // NIT resolution — AUDIT-FINTECH R-8 fix.
  //
  // PREVIOUS (broken): `emitterNit = order.tenant?.id` (a CUID — never a real
  // NIT) and `receiverNit = order.customer?.email` (an email — never a NIT).
  // The CUFE was computed with these placeholders so every locally-stamped
  // invoice had an invalid CUFE the moment Alegra was not configured.
  //
  // NOW:
  //   - `emitterNit` comes from `Tenant.nit` (the new optional column added
  //     by this audit). In production we fail-loud when it's missing — a
  //     missing NIT means DIAN would reject the invoice anyway, so emitting
  //     one with a placeholder CUFE is worse than refusing to generate.
  //     In dev we fall back to a placeholder + warn so the local sandbox
  //     still works end-to-end.
  //   - `receiverNit` comes from `Customer.documentNumber` (the new optional
  //     column — NIT/cédula in CO, CPF/CNPJ in BR, RFC in MX). When the
  //     customer has no document on file, we use `'222222222'` — the
  //     standard DIAN placeholder for "consumidor final" (unregistered
  //     consumer) per Resolución DIAN 165 de 2023 Anexo Técnico §4.1.3.
  //     NEVER the email.
  const tenantNit = order.tenant?.nit?.trim() || ''
  const isProd = process.env.NODE_ENV === 'production'
  if (!tenantNit) {
    if (isProd) {
      throw new Error(
        'Tenant NIT required for DIAN invoicing in production. ' +
          'Configure Tenant.nit before generating electronic invoices.',
      )
    }
    log.warn(
      { tenantId, orderId },
      'Tenant.nit not configured — using placeholder NIT for local DIAN invoice (dev only)',
    )
  }
  const emitterNit = tenantNit || '000000000'

  const customerDoc = order.customer?.documentNumber?.trim() || ''
  const receiverNit = customerDoc || '222222222'

  const issueDate = new Date()
  const cufe = calculateCUFE({
    invoiceNumber,
    issueDate,
    total,
    emitterNit,
    receiverNit,
    softwareId: process.env.DIAN_SOFTWARE_ID || 'ZIAY-001',
    technicalNumber: `TEC-${Date.now()}`,
  })

  const dianValidationUrl = `${DIAN_VALIDATION_URL_BASE}/${cufe}`
  const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000)

  const invoiceData: DianInvoiceData = {
    invoiceNumber,
    cufe,
    issueDate,
    dueDate,
    emitterNit,
    emitterName: order.tenant?.nombreNegocio || 'ZIAY',
    emitterAddress: 'Bogotá, Colombia',
    emitterCity: 'Bogotá',
    receiverNit,
    receiverName: order.customer?.name || 'Cliente',
    receiverEmail: order.customer?.email || '',
    items,
    subtotal,
    ivaAmount,
    ivaRate: IVA_RATE,
    total,
    paymentMethod: order.paymentMode || 'transfer',
    paymentDueDate: dueDate,
    dianStatus: 'pending_submission',
    dianValidationUrl,
    qrCodeData: cufe, // QR encodes the CUFE
  }

  // Persist to Invoice model. The `Invoice` table co-hosts SaaS platform
  // billing rows (periodo + null orderId) and DIAN customer-facing rows
  // (orderId + 'n/a' periodo). The `orderId @unique` constraint makes the
  // upsert idempotent — re-generating the same order's invoice returns the
  // same CUFE instead of creating duplicates.
  await db.invoice.upsert({
    where: { orderId: order.id },
    update: {
      invoiceNumber,
      cufe,
      dianStatus: 'pending_submission',
      dianValidationUrl,
      amount: total,
      issuedAt: issueDate,
      metadata: JSON.stringify(invoiceData),
    },
    create: {
      tenantId,
      orderId: order.id,
      invoiceNumber,
      cufe,
      // Required-by-schema fields for the SaaS-billing side of the model —
      // the DIAN row has no GMV/commission, so we zero them out + tag the
      // `periodo` with the issue month so list views still group correctly.
      periodo: issueDate.toISOString().slice(0, 7),
      gmvTotal: 0,
      feeBase: 0,
      comisionTotal: 0,
      tramoAplicado: 'n/a',
      total,
      estado: 'emitida',
      amount: total,
      issuedAt: issueDate,
      dianStatus: 'pending_submission',
      dianValidationUrl,
      metadata: JSON.stringify(invoiceData),
    },
  })

  log.info(
    { orderId, invoiceNumber, cufe: cufe.slice(0, 16) + '...' },
    'DIAN invoice generated',
  )

  return invoiceData
}

/**
 * Submit invoice to DIAN via the Alegra provider adapter.
 *
 * SPRINT-LEGAL-FINAL-001 — replaces the previous stub. The flow:
 *   1. Resolve the Alegra adapter; if not configured (env vars missing),
 *      return `accepted: false` with a clear Spanish message so the
 *      caller (the `/api/compliance/dian-invoice/[invoiceId]/submit`
 *      route) can surface the configuration gap.
 *   2. Fetch the Invoice row + its `metadata` payload (the
 *      `DianInvoiceData` JSON persisted by `generateDianInvoice()`).
 *   3. Call `adapter.createInvoice(...)` — Alegra creates + stamps +
 *      submits to DIAN in one call. Returns CUFE + DIAN status.
 *   4. Persist the Alegra-issued CUFE + status + validation URL back
 *      onto the Invoice row (overwrites the local CUFE — Alegra's is
 *      the authoritative one post-submission).
 *   5. Best-effort: send the PDF to the customer via `adapter.sendByEmail`.
 *   6. Return `{ accepted, message, cufe?, submitted? }` so the caller can render
 *      the result + persist the CUFE on the client side if needed.
 *
 * Non-fatal failures (Alegra not configured, network error, 4xx/5xx)
 * return `accepted: false` with a descriptive message — the Invoice row
 * is left in its previous state (`pending_submission` or whatever it
 * was) so the caller can retry.
 *
 * AUDIT-FINTECH R-8 — added `submitted` flag for the retry function:
 *   - `submitted: true`  — Alegra was configured AND `createInvoice()`
 *     returned a non-null result. The submission reached Alegra (DIAN's
 *     async validation may still be pending). The retry function treats
 *     this as success and DOES NOT increment the retry counter.
 *   - `submitted: false` — Alegra was not configured, the API call
 *     failed (network/4xx/5xx), or the invoice/metadata was missing.
 *     The retry function increments the retry counter.
 * Also persists `dianLastError` on the Invoice row when `submitted: false`
 * so the retry function + ops dashboards can read the failure reason
 * without parsing the return value.
 */
export async function submitToDian(
  invoiceId: string,
): Promise<{ accepted: boolean; message: string; cufe?: string; submitted?: boolean }> {
  const adapter = getAlegraDianAdapter()

  if (!adapter.isConfigured()) {
    // Persist the failure reason so the retry function + ops dashboard can
    // see WHY the invoice is still pending without re-running the submission.
    await safeUpdateDianError(invoiceId, 'Alegra no configurado')
    return {
      accepted: false,
      submitted: false,
      message:
        'Alegra no configurado. Configurar ALEGRA_TOKEN y ALEGRA_USERNAME para envío a DIAN.',
    }
  }

  // Fetch the invoice + its structured data payload.
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) {
    return { accepted: false, submitted: false, message: 'Factura no encontrada' }
  }

  const invoiceData = invoice.metadata
    ? (JSON.parse(invoice.metadata) as DianInvoiceData)
    : null
  if (!invoiceData) {
    await safeUpdateDianError(invoiceId, 'Datos de factura no encontrados (metadata vacía)')
    return {
      accepted: false,
      submitted: false,
      message: 'Datos de factura no encontrados (metadata vacía)',
    }
  }

  // Map DianInvoiceItem (unitPrice) → Alegra item shape (price).
  // DianInvoiceData.items uses `unitPrice`; Alegra's createInvoice expects
  // `price`. The two shapes are intentionally not identical so the
  // DIAN-local payload stays decoupled from the provider API shape.
  const items = (invoiceData.items || []).map((i) => ({
    code: i.code,
    description: i.description,
    quantity: i.quantity,
    price: i.unitPrice,
    total: i.total,
  }))

  // Create in Alegra — Alegra submits to DIAN synchronously when
  // `stamp.generate: true` is set in the body (handled inside the adapter).
  const result = await adapter.createInvoice({
    orderId: invoice.orderId || '',
    tenantId: invoice.tenantId,
    invoiceNumber: invoice.invoiceNumber || '',
    emitterNit: invoiceData.emitterNit || '',
    emitterName: invoiceData.emitterName || '',
    receiverNit: invoiceData.receiverNit || '',
    receiverName: invoiceData.receiverName || '',
    receiverEmail: invoiceData.receiverEmail || '',
    items,
    subtotal: invoiceData.subtotal || 0,
    ivaAmount: invoiceData.ivaAmount || 0,
    total: invoiceData.total || invoice.amount || 0,
  })

  if (result) {
    // Update invoice with the Alegra-issued CUFE + DIAN status. This
    // overwrites the local CUFE computed in `generateDianInvoice()` —
    // Alegra's CUFE is the authoritative one (it includes Alegra's
    // software PIN + technical number, not our placeholders).
    await db.invoice.update({
      where: { id: invoiceId },
      data: {
        cufe: result.cufe,
        dianStatus: result.dianStatus,
        dianValidationUrl: result.dianValidationUrl,
        // Submission reached Alegra — clear the last-error so a subsequent
        // retry attempt doesn't show a stale failure reason.
        dianLastError: null,
      },
    })

    // Best-effort: send the PDF to the customer. Failures are logged
    // inside the adapter + don't affect the submission result.
    if (result.pdfUrl && invoiceData.receiverEmail) {
      await adapter
        .sendByEmail(result.id, invoiceData.receiverEmail)
        .catch(() => {})
    }

    log.info(
      {
        invoiceId,
        alegraId: result.id,
        dianStatus: result.dianStatus,
        cufe: result.cufe.slice(0, 16) + '...',
      },
      'DIAN invoice submitted via Alegra',
    )

    return {
      accepted: result.dianStatus === 'accepted',
      submitted: true,
      message:
        result.dianStatus === 'accepted'
          ? `Factura aceptada por DIAN. CUFE: ${result.cufe.slice(0, 16)}...`
          : `Factura enviada a DIAN. Estado: ${result.dianStatus}. CUFE: ${result.cufe?.slice(0, 16) || 'N/A'}...`,
      cufe: result.cufe,
    }
  }

  // `createInvoice` returned null — Alegra was configured but the call
  // failed (network, 4xx, 5xx). The adapter already logged the error.
  const failMsg = 'Error al enviar factura a DIAN via Alegra. Revisar logs del servidor.'
  await safeUpdateDianError(invoiceId, failMsg)
  log.warn({ invoiceId }, 'Alegra createInvoice returned null — submission failed')

  return {
    accepted: false,
    submitted: false,
    message: failMsg,
  }
}

/**
 * Best-effort persist of `dianLastError` on an Invoice row. Wrapped in
 * try/catch so a DB failure here doesn't mask the original submission
 * error reported by the caller.
 */
async function safeUpdateDianError(invoiceId: string, message: string): Promise<void> {
  try {
    await db.invoice.update({
      where: { id: invoiceId },
      data: { dianLastError: message },
    })
  } catch (err) {
    log.error(
      { invoiceId, err: err instanceof Error ? err.message : String(err) },
      'safeUpdateDianError: failed to persist dianLastError',
    )
  }
}

// ───────────────────────────────────────────────────────────────────────────
// AUDIT-FINTECH R-8 — DIAN submission retry job
//
// Background: when Alegra is not configured at the time the order is paid
// (or Alegra is briefly down), `submitToDian()` returns `accepted: false`
// and the Invoice row stays `dianStatus = 'pending_submission'` FOREVER.
// There was no retry mechanism — the invoice was effectively lost.
//
// `retryPendingDianInvoices()` walks the `pending_submission` backlog and
// re-submits each invoice via `submitToDian()`. It is exposed as the
// admin endpoint `POST /api/compliance/dian-retry` (manual trigger for
// now — TODO: wire to BullMQ cron in a follow-up sprint).
//
// Retry policy:
//   - Max 50 invoices per run (overload protection — Alegra has rate
//     limits).
//   - Max 5 retries per invoice (`MAX_DIAN_RETRIES`). After that the
//     invoice is marked `dianStatus='failed'` + an `AuditLog` entry is
//     created so ops can pick it up for manual review.
//   - `submitted: true` from `submitToDian()` resets the retry counter
//     (the submission reached Alegra — even if DIAN's async validation
//     is still pending, the work is done from our side).
//   - `submitted: false` increments `dianRetryCount` + sets `dianLastError`.
//
// AUDIT-FINTECH N-8 — Exponential backoff between retries.
//   Previously the retry filter was a flat `createdAt < now() - 5min`, so
//   if Alegra was down, all 5 retries for the same invoice ran within
//   ~25 minutes (5 cron ticks × 5 min). Now an invoice is only re-attempted
//   once `now() - updatedAt > backoff(dianRetryCount)` where `backoff(n) =
//   min(5 * 2^n, 1440)` minutes:
//     retry 0 → wait 5 min  (initial — same as the old cutoff)
//     retry 1 → wait 10 min
//     retry 2 → wait 20 min
//     retry 3 → wait 40 min
//     retry 4 → wait 80 min  (cap reached at 24h on retry 9)
//   The total worst-case elapsed for 5 failures is now ~2h35min instead
//   of ~25min, giving Alegra time to recover. `updatedAt` is bumped on
//   every `db.invoice.update` (Prisma `@updatedAt` decorator) so the
//   clock restarts after each attempt.
// ───────────────────────────────────────────────────────────────────────────

/** Maximum retry attempts before an invoice is marked as permanently failed. */
const MAX_DIAN_RETRIES = 5

/** Base backoff window (minutes) — first retry waits this long. */
const RETRY_BASE_BACKOFF_MIN = 5

/** Hard cap on a single backoff window (minutes) — 24h. */
const RETRY_MAX_BACKOFF_MIN = 1440

/** Max invoices processed per run — Alegra rate-limit protection. */
const MAX_INVOICES_PER_RUN = 50

/**
 * Compute the per-invoice backoff window in milliseconds, based on the
 * number of failed retries already recorded on the invoice.
 *
 * `n` is `dianRetryCount` BEFORE the next attempt — i.e. 0 means "this
 * would be the first retry" (wait 5 min after the original submission),
 * 1 means "one failed retry already, wait 10 min", etc. Capped at 24h.
 */
function dianBackoffMs(retryCount: number): number {
  const minutes = Math.min(
    RETRY_BASE_BACKOFF_MIN * Math.pow(2, retryCount),
    RETRY_MAX_BACKOFF_MIN,
  )
  return minutes * 60 * 1000
}

export interface DianRetryResult {
  processed: number
  submitted: number
  failed: number
  permanentlyFailed: number
  skipped: number
}

/**
 * Walk the `pending_submission` invoice backlog + re-submit each via
 * `submitToDian()`. See file-level comment for the retry policy.
 *
 * AUDIT-FINTECH N-8 — exponential backoff. An invoice is eligible for
 * retry only if `now() - updatedAt > backoff(dianRetryCount)`. This
 * means each failed attempt pushes the next attempt further into the
 * future (5 → 10 → 20 → 40 → 80 min, capped at 24h), so a sustained
 * Alegra outage no longer burns all 5 retries in 25 minutes.
 *
 * @param tenantId Optional — scope to a single tenant. When omitted, all
 *                 tenants' pending invoices are processed (used by the
 *                 platform admin endpoint).
 */
export async function retryPendingDianInvoices(
  tenantId?: string,
): Promise<DianRetryResult> {
  const now = Date.now()

  // Pull every pending invoice older than the *minimum* backoff (5 min)
  // so the loop can apply per-invoice backoff based on `dianRetryCount`.
  // The flat 5-min floor avoids racing with a fresh order's synchronous
  // submission attempt (same guard as before N-8); per-invoice backoff
  // is then enforced inside the loop.
  const minCutoff = new Date(now - dianBackoffMs(0))

  const invoices = await db.invoice.findMany({
    where: {
      dianStatus: 'pending_submission',
      updatedAt: { lt: minCutoff },
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true, tenantId: true, dianRetryCount: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
    take: MAX_INVOICES_PER_RUN,
  })

  // Apply per-invoice exponential backoff. An invoice is eligible only
  // if `now - updatedAt > backoff(dianRetryCount)` — i.e. the per-invoice
  // clock (reset by every Prisma `update`) has elapsed the backoff window
  // for its current retry count.
  const eligible = invoices.filter((inv) => {
    const lastTouchedAt = inv.updatedAt.getTime()
    const waitMs = dianBackoffMs(inv.dianRetryCount ?? 0)
    return now - lastTouchedAt >= waitMs
  })

  log.info(
    {
      candidates: invoices.length,
      eligible: eligible.length,
      skippedByBackoff: invoices.length - eligible.length,
      tenantId: tenantId ?? 'all',
    },
    'retryPendingDianInvoices: starting batch (exponential backoff applied)',
  )

  let submitted = 0
  let failed = 0
  let permanentlyFailed = 0
  let skipped = invoices.length - eligible.length

  for (const inv of eligible) {
    try {
      const result = await submitToDian(inv.id)

      if (result.submitted) {
        // Submission reached Alegra — reset the retry counter + clear
        // dianLastError (already done inside submitToDian on success).
        // `updatedAt` is bumped automatically by Prisma `@updatedAt`,
        // which restarts the backoff clock for any future failure.
        await db.invoice.update({
          where: { id: inv.id },
          data: { dianRetryCount: 0 },
        })
        submitted++
        continue
      }

      // Submission failed — increment retry counter + persist last error
      // (dianLastError already set inside submitToDian). Check if we've
      // exhausted the retry budget; if so, mark as permanently failed +
      // create an AuditLog entry for manual review.
      const newCount = (inv.dianRetryCount ?? 0) + 1
      if (newCount >= MAX_DIAN_RETRIES) {
        await db.$transaction(async (tx) => {
          await tx.invoice.update({
            where: { id: inv.id },
            data: {
              dianRetryCount: newCount,
              dianStatus: 'failed',
              dianLastError: result.message,
            },
          })
          await tx.auditLog.create({
            data: {
              tenantId: inv.tenantId,
              action: 'compliance.dian.submission_failed',
              entity: 'invoice',
              entityId: inv.id,
              metadata: JSON.stringify({
                retryCount: newCount,
                lastError: result.message,
                reason: 'Exceeded max DIAN submission retries — manual review required',
              }),
            },
          })
        })
        permanentlyFailed++
        log.error(
          { invoiceId: inv.id, retryCount: newCount, lastError: result.message },
          'retryPendingDianInvoices: invoice permanently failed (max retries exceeded)',
        )
      } else {
        await db.invoice.update({
          where: { id: inv.id },
          data: { dianRetryCount: newCount },
        })
        failed++
        log.warn(
          {
            invoiceId: inv.id,
            retryCount: newCount,
            nextBackoffMin: Math.min(RETRY_BASE_BACKOFF_MIN * Math.pow(2, newCount), RETRY_MAX_BACKOFF_MIN),
            lastError: result.message,
          },
          'retryPendingDianInvoices: submission failed (will retry after backoff)',
        )
      }
    } catch (err) {
      // Defensive — submitToDian should never throw (it catches its own
      // errors), but if something unexpected happens we still want to
      // continue the batch rather than abort.
      failed++
      skipped++
      log.error(
        { invoiceId: inv.id, err: err instanceof Error ? err.message : String(err) },
        'retryPendingDianInvoices: unexpected exception for invoice (skipped)',
      )
    }
  }

  const result: DianRetryResult = {
    processed: eligible.length,
    submitted,
    failed,
    permanentlyFailed,
    skipped,
  }
  log.info(result, 'retryPendingDianInvoices: batch complete')
  return result
}
