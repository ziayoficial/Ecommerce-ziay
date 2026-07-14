import { NextRequest, NextResponse } from 'next/server'
import { verifyHmacSha256 } from '@/lib/middleware/hmac'
import {
  isDuplicateWebhook,
  isDuplicateWebhookDB,
  generateWebhookId,
} from '@/lib/middleware/idempotency'
import {
  applyPaymentUpdate,
  safeAudit,
} from '@/lib/adapters/payment-webhook-utils'
import { getLogger } from '@/lib/logger'

const log = getLogger('webhook/pix')

// ─────────────────────────────────────────────────────────────────────────────
// PIX (Banco Central do Brasil) webhook — Comercio Agéntico study §18.
//
// PIX sends a server-to-server callback when the customer pays the charge
// in their bank app. The callback carries:
//   - txid (matches the reference returned by createPayment)
//   - status (CONCLUIDA = paid; ATIVA = still pending; REMOVIDA_PELO_USUARIO_RECEBEDOR = cancelled)
//   - valor.original
//   - pagador (name, cpf, bank) — for reconciliation + KYC audit
//
// Signature: in production, Banco Central / PSPs use mTLS (mutual TLS) for
// webhook authentication. Some PSPs (e.g. MercadoPago PIX, Pagar.me) use
// HMAC-SHA256 with a shared secret instead. We support the HMAC path here
// (PIX_HMAC_SECRET env var) and document the mTLS requirement in the
// deployment guide — the runtime infra (Caddy) terminates mTLS and forwards
// the verified payload with an internal-only header.
//
// The webhook ALWAYS ACKs with 200 to stop retries.
//
// On transition to `paid` the shared `applyPaymentUpdate` helper auto-fires
// the CAPI Purchase event (per tenant pixel config) — closing the
// attribution loop study §14.4 the same way Stripe / Wompi / MP do.
//
// SPRINT-MULTICOUNTRY-001
// ─────────────────────────────────────────────────────────────────────────────

// PIX status codes → our canonical payment status mapping.
// Reference: https://www.bcb.gov.br/estabilidadefinanceira/pix
function mapPixStatus(status: string): { status: string; success: boolean } {
  const s = status.toUpperCase()
  // CONCLUIDA = paid. Other states: ATIVA (pending), REMOVIDA_*, etc.
  if (s === 'CONCLUIDA' || s === 'CONCLUÍDA' || s === 'APROVADA' || s === 'PAID') {
    return { status: 'approved', success: true }
  }
  if (s.startsWith('REMOVIDA') || s === 'CANCELLED' || s === 'REJECTED') {
    return { status: 'rejected', success: false }
  }
  if (s === 'EXPIRED' || s === 'EXPIRADA') {
    return { status: 'expired', success: false }
  }
  // ATIVA + unknown → leave as pending
  return { status: 'pending', success: false }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-pix-signature') ?? ''
  const secret = process.env.PIX_HMAC_SECRET ?? process.env.PIX_WEBHOOK_SECRET ?? ''

  // ── Signature verification ───────────────────────────────────────────
  // Dev-mode fallback when secret isn't configured. Production MUST set
  // PIX_HMAC_SECRET (HMAC path) OR terminate mTLS at the edge + forward
  // with an internal-only header (the mTLS path skips HMAC entirely).
  let sigValid: boolean
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      // mTLS path: if PIX_MTLS_TERMINATED is set, the edge (Caddy) has
      // already authenticated the caller via mutual TLS — we trust the
      // forwarded request. Otherwise reject.
      if (process.env.PIX_MTLS_TERMINATED === 'true') {
        sigValid = true
      } else {
        await safeAudit(
          'webhook.pix.no_secret',
          'Webhook',
          'PIX_HMAC_SECRET missing in production and PIX_MTLS_TERMINATED not set',
        )
        return NextResponse.json(
          { error: 'Webhook secret not configured' },
          { status: 500 },
        )
      }
    } else {
      log.warn('PIX_HMAC_SECRET not set — skipping verification in dev mode')
      sigValid = signature.length > 0
    }
  } else {
    sigValid = verifyHmacSha256(rawBody, signature, secret)
  }

  if (!sigValid) {
    await safeAudit('webhook.pix.invalid_sig', 'Webhook', rawBody.slice(0, 1000))
    return NextResponse.json({ received: true, status: 'invalid_signature' })
  }

  // ── Idempotency (in-memory + DB) ─────────────────────────────────────
  const webhookId = generateWebhookId(rawBody, signature)
  if (isDuplicateWebhook(webhookId)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }
  if (await isDuplicateWebhookDB('webhook.pix.', webhookId)) {
    isDuplicateWebhook(webhookId) // warm the in-memory cache
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  // ── Parse + dispatch ─────────────────────────────────────────────────
  let body: Record<string, unknown> = {}
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    body = {}
  }

  // PIX payload (Pix Copia e Cola webhook format):
  //   { txid, status, valor: { original: "99.90" }, pagador: { ... } }
  // Some PSPs nest under `data` or `pix` — handle both shapes.
  const data = (body.data ?? body.pix ?? body) as Record<string, unknown>
  const txid = String(data.txid ?? body.txid ?? '')
  const status = String(data.status ?? body.status ?? 'ATIVA')
  const amount = Number(
    (data.valor as { original?: string } | undefined)?.original ??
    (body.valor as { original?: string } | undefined)?.original ??
    0,
  )

  try {
    if (txid) {
      const mapped = mapPixStatus(status)
      // `applyPaymentUpdate` will look up the Order by paymentRef === txid
      // (or by `number` when externalReference matches). On transition to
      // `paid` it auto-fires the CAPI Purchase event per active pixel —
      // closing the attribution loop (study §14.4) for PIX-driven orders.
      await applyPaymentUpdate({
        gateway: 'pix',
        paymentId: txid,
        externalReference: txid,
        status: mapped.status,
        success: mapped.success,
      })
    }
    await safeAudit(
      'webhook.pix.inbound',
      'Webhook',
      JSON.stringify({ txid, status, amount }).slice(0, 1000),
      webhookId,
    )
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'PIX webhook processing failed',
    )
    await safeAudit(
      'webhook.pix.error',
      'Webhook',
      err instanceof Error ? err.message : 'unknown error',
      webhookId,
    )
  }

  // Always ACK 200 — PIX retries on non-200.
  return NextResponse.json({ received: true })
}
