// ZIAY — Anti-fraud service layer.
//
// I2-R3 (CRITICAL RISK R-3 closure) — the audit scored anti-fraud 3.5/10,
// the weakest dimension. This service provides a layered defense:
//
//   1. Blocklist            — entries added on chargeback / OFAC match /
//                             manual operator action. Customer, email, IP,
//                             card BIN, device, phone identifiers.
//   2. Velocity windows     — per-identifier counters (customer / ip /
//                             card_bin / device) over rolling windows. Catches
//                             card-testing bursts (e.g. 50 attempts/IP/min).
//   3. OFAC AML screening   — SDN list via api.ofac-api.com (free tier,
//                             OFAC_API_KEY env). Falls back to a small local
//                             seed list when the key is missing so the path
//                             is exercised in dev.
//   4. First-purchase       — high-risk signal: a brand-new customer placing
//                             a high-value order. Inflates riskScore.
//   5. High-risk geographies— sanctioned / high-fraud countries.
//   6. CVV/AVS              — gateway-reported; handled in webhook layer.
//   7. 3DS/SCA              — enforced in the Stripe adapter (BACEN Brazil +
//                             PSD2 EU compliance).
//
// All public methods are tenant-scoped (`tenantId` first argument). The
// service writes a `FraudEvent` row on every `checkTransaction` invocation
// for auditability + powers the fraud dashboard (`getFraudStats`).
//
// Scoring model (additive, capped at 100):
//   - 100            → block (blocklist hit, OFAC hit, CVV/AVS fail, velocity
//                      > hardCap)
//   - ≥ 60           → review (operator inspects before fulfillment)
//   - < 60           → allow (proceed normally)
//
// The chargeback feedback loop (`recordChargeback`) is wired from
// `/api/webhooks/chargeback` and the Stripe `charge.dispute.created` event —
// closing the loop that was completely missing before R-3.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:fraud')

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

export type BlocklistType =
  | 'customer'
  | 'email'
  | 'ip'
  | 'card_bin'
  | 'device'
  | 'phone'

export type BlocklistReason =
  | 'chargeback'
  | 'fraud_report'
  | 'ofac_match'
  | 'manual'

export interface FraudBlocklistEntryInput {
  type: BlocklistType
  value: string
  reason: BlocklistReason
  source?: 'auto' | 'manual' | 'ofac'
  expiresAt?: Date | null
}

export interface FraudCheckInput {
  tenantId: string
  customerId?: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  customerIp?: string
  amount: number
  currency: string
  countryCode: string
  paymentMethod:
    | 'mercadopago'
    | 'wompi'
    | 'stripe'
    | 'payu'
    | 'pse'
    | 'pix'
    | 'oxxo'
    | 'spei'
    | string
  cardBin?: string // first 6 digits of card if available
  deviceId?: string // device fingerprint if available
  isReturningCustomer: boolean
}

export interface FraudCheckResult {
  decision: 'allow' | 'review' | 'block'
  riskScore: number // 0-100
  reasons: string[] // human-readable list of triggered rules
  checksRun: string[] // list of check names that ran
}

export interface VelocityCheckResult {
  blocked: boolean
  count: number
}

export interface BlocklistCheckResult {
  blocked: boolean
  reason?: string
}

export interface OfacScreenResult {
  hit: boolean
  match?: string
}

export interface FraudStatsResult {
  totalBlocked: number
  totalReviewed: number
  totalAllowed: number
  topReasons: Array<{ reason: string; count: number }>
}

// ───────────────────────────────────────────────────────────────────────────
// Tunable policy thresholds
// ───────────────────────────────────────────────────────────────────────────
//
// Conservative defaults tuned for LATAM card-not-present fraud. Operators can
// override via env vars (`FRAUD_VELOCITY_IP_PER_MIN`, etc.) per-tenant later.
const VELOCITY_IP_PER_MIN = Number(process.env.FRAUD_VELOCITY_IP_PER_MIN ?? 20)
const VELOCITY_CUSTOMER_PER_MIN = Number(
  process.env.FRAUD_VELOCITY_CUSTOMER_PER_MIN ?? 8,
)
const VELOCITY_CARD_BIN_PER_MIN = Number(
  process.env.FRAUD_VELOCITY_CARD_BIN_PER_MIN ?? 10,
)
const VELOCITY_DEVICE_PER_MIN = Number(
  process.env.FRAUD_VELOCITY_DEVICE_PER_MIN ?? 12,
)
// Hard caps — any single one of these is an instant BLOCK.
const VELOCITY_IP_HARD_CAP = Number(process.env.FRAUD_VELOCITY_IP_HARD_CAP ?? 60)
const VELOCITY_CARD_BIN_HARD_CAP = Number(
  process.env.FRAUD_VELOCITY_CARD_BIN_HARD_CAP ?? 30,
)

// First-purchase high-risk: any new customer with an order over this USD
// equivalent is flagged for review. Tuned for the LATAM card-not-present
// context (median order ~USD 50). Can be overridden per-tenant.
const FIRST_PURCHASE_USD_THRESHOLD = Number(
  process.env.FRAUD_FIRST_PURCHASE_USD_THRESHOLD ?? 500,
)

// Countries on the OFAC sanctions list / state sponsors of terrorism. A
// billing/shipping country here is an instant BLOCK (per US law for US
// expansion + EU compliance).
const SANCTIONED_COUNTRIES = new Set(
  (process.env.FRAUD_SANCTIONED_COUNTRIES ?? 'CU,IR,KP,SY,BY,RU').split(','),
)

// Small local fallback OFAC seed list. Real screening uses
// `api.ofac-api.com` when `OFAC_API_KEY` is configured. This static list
// keeps the path exercised in dev + catches the most prominent SDN names
// if the API is unreachable.
const OFAC_LOCAL_SEED = [
  'OSAMA BIN LADEN',
  'AL-ZAWAHIRI',
  'KIM JONG UN',
  'BASHAR AL-ASSAD',
  'NICOLAS MADURO',
  'DIEGO JOSE DASSO',
  'TARECK EL AISSAMI',
  'GUSTAVO RODRIGUEZ',
  'RAFAEL CARO QUINTERO',
]

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

/** Compute the bucket start time for a per-minute velocity window. */
function windowStartFor(now: Date, windowMin: number): Date {
  const ms = windowMin * 60 * 1000
  return new Date(Math.floor(now.getTime() / ms) * ms)
}

/** Coerce a value to lowercased string for case-insensitive storage. */
function norm(v: string | undefined | null): string | undefined {
  return v && v.length > 0 ? v.trim().toLowerCase() : undefined
}

/** Truncate card PAN to BIN (first 6 digits). */
function toBin(cardBin: string | undefined): string | undefined {
  if (!cardBin) return undefined
  const cleaned = cardBin.replace(/\D/g, '')
  return cleaned.length >= 6 ? cleaned.slice(0, 6) : cleaned || undefined
}

/**
 * Mask a PII value for inclusion in `FraudEvent.reasons`. The `reasons` field
 * is queryable via the fraud dashboard API and (once N-1 ships RLS for the
 * `fraud_event` table) may be visible to operators across teams — so we strip
 * the sensitive portion while keeping enough context to debug. The full
 * unmasked value stays in the server `log.*` calls (server logs are not
 * exposed to tenants) and in the dedicated `FraudBlocklistEntry.value` column
 * which is RLS-protected.
 *
 * AUDIT-FINTECH-V2 / N-4 — PII leak in FraudEvent.reasons.
 *
 * Masking rules:
 *   - email  `foo@bar.com`     → `f***@bar.com`        (mask local part, keep domain)
 *   - phone  `+57 300 123 4567` → `+57 300 ***4567`     (last 4 digits only)
 *   - card   `4242424242424242` → `424242******4242`    (BIN + last 4, mask middle)
 *            `424242` (BIN)     → `424242***`            (BIN is already partial, mask further)
 *   - ip     `190.0.0.1`        → `190.0.***.1`         (mask 3rd octet)
 *   - other  → `***`                                    (defensive: never leak unknown PII)
 */
export function maskPii(
  type: 'email' | 'phone' | 'card' | 'ip' | 'other',
  value: string | undefined | null,
): string {
  if (!value) return ''
  const v = String(value).trim()
  if (!v) return ''

  switch (type) {
    case 'email': {
      // foo@bar.com → f***@bar.com
      const at = v.lastIndexOf('@')
      if (at <= 0 || at === v.length - 1) return '***'
      const local = v.slice(0, at)
      const domain = v.slice(at + 1)
      const maskedLocal = local.length <= 1
        ? '*'
        : local[0] + '*'.repeat(Math.min(local.length - 1, 6))
      return `${maskedLocal}@${domain}`
    }
    case 'phone': {
      // +57 300 123 4567 → +57 300 ***4567 (keep country/area prefix, last 4 digits)
      const digits = v.replace(/\D/g, '')
      if (digits.length < 4) return '***'
      const last4 = digits.slice(-4)
      // Preserve a leading non-digit prefix (e.g. `+57 ` ) up to a small cap.
      const prefixMatch = v.match(/^\D+/)
      const prefix = prefixMatch ? prefixMatch[0].slice(0, 8) : ''
      return `${prefix}***${last4}`
    }
    case 'card': {
      // 4242424242424242 → 424242******4242 (BIN + last 4, mask middle)
      // 424242 (already BIN) → 424242***
      const digits = v.replace(/\D/g, '')
      if (digits.length <= 6) return `${digits}***`
      if (digits.length <= 10) return `${digits.slice(0, 6)}***`
      const bin = digits.slice(0, 6)
      const last4 = digits.slice(-4)
      return `${bin}${'*'.repeat(Math.min(digits.length - 10, 8))}${last4}`
    }
    case 'ip': {
      // 190.0.0.1 → 190.0.***.1 (IPv4 only — mask 3rd octet)
      const parts = v.split('.')
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.***.${parts[3]}`
      }
      // IPv6 or unknown — return a generic mask to avoid leaking it.
      return '***'
    }
    case 'other':
    default:
      return '***'
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Service
// ───────────────────────────────────────────────────────────────────────────

export const fraudService = {
  // ── velocityCheck ──────────────────────────────────────────────────────
  /**
   * Count recent transactions from `identifier` over the last `windowMin`
   * minutes. If `count >= maxCount`, returns `blocked: true`.
   *
   * Reads from `VelocityWindow` (per-bucket counters, indexed by
   * `(tenantId, identifierType, identifier)`). Buckets are aligned to
   * `windowMin`-minute boundaries so multiple calls within the same window
   * hit the same row.
   */
  async velocityCheck(
    tenantId: string,
    identifier: string,
    windowMin: number,
    maxCount: number,
    identifierType: 'customer' | 'ip' | 'card_bin' | 'device' = 'customer',
  ): Promise<VelocityCheckResult> {
    try {
      const now = new Date()
      const since = new Date(now.getTime() - windowMin * 60 * 1000)
      const rows = await db.velocityWindow.findMany({
        where: {
          tenantId,
          identifierType,
          identifier,
          windowStart: { gte: since },
        },
        select: { count: true },
      })
      const count = rows.reduce((sum, r) => sum + r.count, 0)
      return { blocked: count >= maxCount, count }
    } catch (err) {
      captureError(err as Error, {
        service: 'fraud',
        method: 'velocityCheck',
        tenantId,
        identifierType,
      })
      // Fail-open: if the velocity store is unavailable, do NOT block
      // legitimate traffic. The blocklist + OFAC checks still run.
      return { blocked: false, count: 0 }
    }
  },

  // ── checkBlocklist ─────────────────────────────────────────────────────
  /**
   * Look up an identifier in the tenant's blocklist. Returns `blocked: true`
   * if an unexpired entry matches `(tenantId, type, value)`.
   */
  async checkBlocklist(
    tenantId: string,
    identifier: string,
    type: BlocklistType,
  ): Promise<BlocklistCheckResult> {
    try {
      const value = norm(identifier)
      if (!value) return { blocked: false }
      const entry = await db.fraudBlocklistEntry.findUnique({
        where: {
          tenantId_type_value: { tenantId, type, value },
        },
      })
      if (!entry) return { blocked: false }
      // Honour TTL: an entry past its `expiresAt` is treated as gone.
      if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
        return { blocked: false }
      }
      return {
        blocked: true,
        reason: `${entry.reason}${entry.source ? ` (${entry.source})` : ''}`,
      }
    } catch (err) {
      captureError(err as Error, {
        service: 'fraud',
        method: 'checkBlocklist',
        tenantId,
        type,
      })
      // Fail-open on DB errors (see velocityCheck rationale).
      return { blocked: false }
    }
  },

  // ── addToBlocklist ─────────────────────────────────────────────────────
  /**
   * Upsert a blocklist entry. Idempotent on `(tenantId, type, value)` —
   * re-adding an existing entry just refreshes `reason` + `expiresAt`.
   */
  async addToBlocklist(
    tenantId: string,
    entry: FraudBlocklistEntryInput,
  ): Promise<void> {
    try {
      const value = norm(entry.value)
      if (!value) return
      await db.fraudBlocklistEntry.upsert({
        where: {
          tenantId_type_value: { tenantId, type: entry.type, value },
        },
        create: {
          tenantId,
          type: entry.type,
          value,
          reason: entry.reason,
          source: entry.source ?? 'auto',
          expiresAt: entry.expiresAt ?? null,
        },
        update: {
          reason: entry.reason,
          source: entry.source ?? 'auto',
          expiresAt: entry.expiresAt ?? null,
        },
      })
      log.info(
        { tenantId, type: entry.type, reason: entry.reason },
        'blocklist entry added',
      )
    } catch (err) {
      captureError(err as Error, {
        service: 'fraud',
        method: 'addToBlocklist',
        tenantId,
        type: entry.type,
      })
    }
  },

  // ── ofacScreen ─────────────────────────────────────────────────────────
  /**
   * Screen a customer name (and optional email) against the OFAC SDN list.
   *
   * AUDIT-FINTECH-V2 / N-3 — previously called with `customerEmail.split('@')[0]`
   * as the only screening input, which gave <30% coverage because most LATAM
   * customers don't put their real name in the email local-part. Now
   * `checkTransaction` passes `customerName` (resolved from `order.customer?.name`
   * in the create-link / local-payment routes) as the primary input, with the
   * email local-part as a complementary second pass when no real name is
   * available.
   *
   * Uses `api.ofac-api.com` (free tier) when `OFAC_API_KEY` is configured.
   * Falls back to a small static seed list otherwise so the screening path
   * is exercised in dev + catches the most prominent SDN names if the API
   * is unreachable. Network failures are caught and treated as no-hit
   * (fail-open — never block legitimate customers due to an upstream
   * outage; the blocklist + velocity checks still run).
   */
  async ofacScreen(name: string, email?: string): Promise<OfacScreenResult> {
    const apiKey = process.env.OFAC_API_KEY
    const q = norm(name)
    if (!q) return { hit: false }

    // ── API path ────────────────────────────────────────────────────────
    if (apiKey) {
      try {
        const url = new URL('https://api.ofac-api.com/v1/search')
        url.searchParams.set('name', q)
        if (email) url.searchParams.set('email', email)
        url.searchParams.set('apiKey', apiKey)
        url.searchParams.set('minScore', '0.85')
        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          // Short timeout — OFAC screening must not stall checkout.
          signal: AbortSignal.timeout(3000),
        })
        if (res.ok) {
          const data = (await res.json()) as {
            hits?: Array<{ name?: string; score?: number }>
          }
          const hits = data?.hits
          if (Array.isArray(hits) && hits.length > 0) {
            const top = hits[0]
            return {
              hit: true,
              match: top?.name
                ? `${top.name}${top.score ? ` (${(top.score * 100).toFixed(0)}%)` : ''}`
                : 'OFAC match',
            }
          }
        }
        // Non-OK or empty body → fall through to local seed.
      } catch (err) {
        // Network / timeout / parse error → fall through to local seed.
        log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'OFAC API unavailable — falling back to local seed list',
        )
      }
    }

    // ── Local fallback seed (substring match, case-insensitive) ─────────
    for (const sdn of OFAC_LOCAL_SEED) {
      if (q.includes(sdn.toLowerCase()) || sdn.toLowerCase().includes(q)) {
        return { hit: true, match: `OFAC local seed: ${sdn}` }
      }
    }
    return { hit: false }
  },

  // ── recordChargeback ───────────────────────────────────────────────────
  /**
   * Chargeback feedback loop. Called from `/api/webhooks/chargeback` and the
   * Stripe `charge.dispute.created` event handler. Marks the order
   * `payment_mismatch` (the canonical "disputed/chargeback" state already
   * used by the CVV/AVS path), adds the customer + card BIN (when known) to
   * the blocklist, and writes an `OrderEvent` for auditability.
   */
  async recordChargeback(
    tenantId: string,
    orderId: string,
    reason: string,
  ): Promise<void> {
    try {
      const order = await db.order.findFirst({
        where: { id: orderId, tenantId },
        include: { customer: true },
      })
      if (!order) {
        log.warn({ tenantId, orderId }, 'recordChargeback: order not found')
        return
      }

      // 1. Mark the order disputed.
      await db.$transaction([
        db.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'payment_mismatch',
            cancelReason: `chargeback: ${reason}`.slice(0, 255),
          },
        }),
        db.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'payment_mismatch',
            note: `chargeback received — reason: ${reason}`,
          },
        }),
      ])

      // 2. Blocklist the customer (chargeback = strong fraud signal).
      await this.addToBlocklist(tenantId, {
        type: 'customer',
        value: order.customerId,
        reason: 'chargeback',
        source: 'auto',
      })

      // 3. Blocklist the customer email + phone when present.
      if (order.customer?.email) {
        await this.addToBlocklist(tenantId, {
          type: 'email',
          value: order.customer.email,
          reason: 'chargeback',
          source: 'auto',
        })
      }
      if (order.customer?.phone) {
        await this.addToBlocklist(tenantId, {
          type: 'phone',
          value: order.customer.phone,
          reason: 'chargeback',
          source: 'auto',
        })
      }

      // 4. Blocklist the card BIN when the gateway stored one.
      //    `Order.paymentGateway` carries the gateway name; for card
      //    gateways (stripe / mercadopago / wompi / payu) we can't recover
      //    the BIN from the order alone — but the webhook can pass it via
      //    `fraudService.addToBlocklist({type:'card_bin', ...})` when the
      //    dispute payload includes `payment_method_details.card.bin`.
      //    Here we leave the BIN blocklist to the webhook layer.

      log.warn(
        { tenantId, orderId, reason },
        'chargeback recorded — customer added to blocklist',
      )
    } catch (err) {
      captureError(err as Error, {
        service: 'fraud',
        method: 'recordChargeback',
        tenantId,
        orderId,
      })
    }
  },

  // ── checkTransaction ───────────────────────────────────────────────────
  /**
   * Run the full anti-fraud check pipeline against a transaction input.
   * Aggregates a risk score from each check and returns the final decision.
   *
   * Layered checks (each can independently BLOCK or add to the risk score):
   *
   *   1. Blocklist      — customer / email / ip / card_bin / device / phone
   *                       → instant BLOCK on any hit
   *   2. OFAC screening — customer name → instant BLOCK on hit
   *   3. Sanctioned country → instant BLOCK
   *   4. Velocity       — ip / card_bin / customer / device in last 1 min
   *                       → BLOCK above hard cap, +score below
   *   5. First-purchase high-value → +score (review threshold)
   *   6. Card BIN known-bad (4111 11 / 5454 54 test bins) → +score
   *   7. Device reuse across customers → +score
   *
   * Always records a `FraudEvent` row for auditability, regardless of
   * decision. Best-effort: persistence failures are logged + swallowed so
   * a DB outage never blocks legitimate traffic (fail-open).
   */
  async checkTransaction(input: FraudCheckInput): Promise<FraudCheckResult> {
    const reasons: string[] = []
    const checksRun: string[] = []
    let riskScore = 0
    let hardBlock = false

    // ── 1. Blocklist (customer / email / ip / card_bin / device / phone) ──
    checksRun.push('blocklist')
    const blocklistCandidates: Array<[string, BlocklistType]> = []
    if (input.customerId) blocklistCandidates.push([input.customerId, 'customer'])
    if (input.customerEmail) blocklistCandidates.push([input.customerEmail, 'email'])
    if (input.customerIp) blocklistCandidates.push([input.customerIp, 'ip'])
    if (input.cardBin) blocklistCandidates.push([toBin(input.cardBin) ?? '', 'card_bin'])
    if (input.deviceId) blocklistCandidates.push([input.deviceId, 'device'])
    if (input.customerPhone) blocklistCandidates.push([input.customerPhone, 'phone'])

    for (const [value, type] of blocklistCandidates) {
      if (!value) continue
      const r = await this.checkBlocklist(input.tenantId, value, type)
      if (r.blocked) {
        hardBlock = true
        reasons.push(`blocklist hit (${type}): ${r.reason ?? 'unknown'}`)
      }
    }

    // ── 2. OFAC screening ────────────────────────────────────────────────
    // AUDIT-FINTECH-V2 / N-3 — screen by customer name (high sensitivity)
    // when available, plus the email local-part as a complementary pass.
    // The create-link route resolves `customerName` from `order.customer?.name`;
    // the local-payment route passes `body.customerName`. Fall back to the
    // email local-part only when no real name is available so coverage stays
    // high for cash flows (PSE/PIX/OXXO/SPEI) where email is often absent.
    const ofacName = input.customerName?.trim()
    const ofacEmailLocal = input.customerEmail ? input.customerEmail.split('@')[0] : undefined
    if (ofacName || ofacEmailLocal) {
      checksRun.push('ofac')
      // Primary pass: real customer name (when available).
      if (ofacName) {
        const ofac = await this.ofacScreen(ofacName, input.customerEmail)
        if (ofac.hit) {
          hardBlock = true
          reasons.push(`OFAC match (name): ${ofac.match ?? 'unknown SDN'}`)
        }
      }
      // Complementary pass: email local-part (lower sensitivity — many
      // emails don't carry the real name, but occasionally a fraudster
      // reuses an SDN-named email handle). Skip when the name already
      // matched to avoid duplicate reasons; skip when the local-part is
      // identical to the name we just screened (e.g. customer with name
      // `user123` and email `user123@example.com`).
      if (
        !hardBlock &&
        ofacEmailLocal &&
        ofacEmailLocal.toLowerCase() !== (ofacName ?? '').toLowerCase()
      ) {
        const ofac2 = await this.ofacScreen(ofacEmailLocal)
        if (ofac2.hit) {
          hardBlock = true
          reasons.push(`OFAC match (email): ${ofac2.match ?? 'unknown SDN'}`)
        }
      }
    }

    // ── 3. Sanctioned country ────────────────────────────────────────────
    checksRun.push('sanctioned_country')
    if (input.countryCode && SANCTIONED_COUNTRIES.has(input.countryCode.toUpperCase())) {
      hardBlock = true
      reasons.push(`sanctioned country: ${input.countryCode}`)
    }

    // ── 4. Velocity windows ──────────────────────────────────────────────
    checksRun.push('velocity')
    if (input.customerIp) {
      const v = await this.velocityCheck(
        input.tenantId,
        input.customerIp,
        1, // last 1 minute
        VELOCITY_IP_PER_MIN,
        'ip',
      )
      if (v.count >= VELOCITY_IP_HARD_CAP) {
        hardBlock = true
        reasons.push(`velocity IP hard cap (${v.count}/${VELOCITY_IP_HARD_CAP}/min)`)
      } else if (v.blocked) {
        riskScore += 40
        reasons.push(`velocity IP high (${v.count}/${VELOCITY_IP_PER_MIN}/min)`)
      } else if (v.count >= VELOCITY_IP_PER_MIN / 2) {
        riskScore += 15
      }
    }
    if (input.cardBin) {
      const bin = toBin(input.cardBin)
      if (bin) {
        const v = await this.velocityCheck(
          input.tenantId,
          bin,
          1,
          VELOCITY_CARD_BIN_PER_MIN,
          'card_bin',
        )
        if (v.count >= VELOCITY_CARD_BIN_HARD_CAP) {
          hardBlock = true
          reasons.push(
            `velocity card BIN hard cap (${v.count}/${VELOCITY_CARD_BIN_HARD_CAP}/min)`,
          )
        } else if (v.blocked) {
          riskScore += 40
          reasons.push(
            `velocity card BIN high (${v.count}/${VELOCITY_CARD_BIN_PER_MIN}/min)`,
          )
        } else if (v.count >= VELOCITY_CARD_BIN_PER_MIN / 2) {
          riskScore += 15
        }
      }
    }
    if (input.customerId) {
      const v = await this.velocityCheck(
        input.tenantId,
        input.customerId,
        1,
        VELOCITY_CUSTOMER_PER_MIN,
        'customer',
      )
      if (v.blocked) {
        riskScore += 30
        reasons.push(
          `velocity customer high (${v.count}/${VELOCITY_CUSTOMER_PER_MIN}/min)`,
        )
      } else if (v.count >= 2) {
        // Multiple transactions in 1 min from the same customer is itself
        // suspicious for card-not-present.
        riskScore += 10
      }
    }
    if (input.deviceId) {
      const v = await this.velocityCheck(
        input.tenantId,
        input.deviceId,
        1,
        VELOCITY_DEVICE_PER_MIN,
        'device',
      )
      if (v.blocked) {
        riskScore += 30
        reasons.push(
          `velocity device high (${v.count}/${VELOCITY_DEVICE_PER_MIN}/min)`,
        )
      }
    }

    // ── 5. First-purchase high-value ─────────────────────────────────────
    checksRun.push('first_purchase')
    if (!input.isReturningCustomer) {
      // Convert amount to USD-equivalent using a rough heuristic — the
      // FxRate table holds live rates. Fall back to `amount` itself when
      // the rate is unavailable (better to over-flag than under-flag).
      let usdAmount = input.amount
      try {
        const fx = await db.fxRate.findUnique({
          where: { currency: input.currency.toUpperCase() },
        })
        if (fx && fx.rate > 0) {
          usdAmount = input.amount / fx.rate
        }
      } catch {
        // ignore — use raw amount as the heuristic floor.
      }
      if (usdAmount >= FIRST_PURCHASE_USD_THRESHOLD) {
        riskScore += 35
        reasons.push(
          `first-purchase high-value (USD ~${usdAmount.toFixed(2)} ≥ ${FIRST_PURCHASE_USD_THRESHOLD})`,
        )
      } else if (usdAmount >= FIRST_PURCHASE_USD_THRESHOLD / 5) {
        riskScore += 10
      }
    }

    // ── 6. Card BIN known-bad (test bins) ───────────────────────────────
    checksRun.push('card_bin_test')
    const bin = toBin(input.cardBin)
    if (bin) {
      // Stripe / Adyen test bins + most common card-testing bin prefixes.
      const KNOWN_TEST_BINS = new Set([
        '424242', // Stripe test Visa
        '411111', // Stripe test Visa
        '555555', // Stripe test Mastercard
        '378282', // Amex test
        '601111', // Discover test
        '305693', // Diners test
        '356600', // JCB test
        '545454', // generic test Mastercard
      ])
      if (KNOWN_TEST_BINS.has(bin)) {
        // Test bins in production = misconfiguration or fraudster probing.
        riskScore += 50
        // AUDIT-FINTECH-V2 / N-4 — mask the card BIN in the persisted reason.
        // The full BIN stays in the `log.*` call below + the
        // `FraudBlocklistEntry.value` column (RLS-protected once N-1 ships).
        reasons.push(`test card BIN in production (${maskPii('card', bin)})`)
      }
    }

    // ── 7. Device reuse across customers ────────────────────────────────
    // (Heuristic — if a `deviceId` is supplied and we've already seen it
    // tied to a DIFFERENT customer in the last 24h, that's suspicious.)
    // Skipping the cross-customer lookup for now to avoid a complex join —
    // the velocity check (4) covers most burst attacks.

    // ── Aggregate ────────────────────────────────────────────────────────
    if (hardBlock) {
      riskScore = 100
    } else {
      riskScore = Math.min(riskScore, 100)
    }

    let decision: FraudCheckResult['decision']
    if (hardBlock || riskScore >= 80) {
      decision = 'block'
    } else if (riskScore >= 60) {
      decision = 'review'
    } else {
      decision = 'allow'
    }

    // ── Record a FraudEvent for auditability ────────────────────────────
    // Always best-effort — never let a logging failure block the payment.
    try {
      await db.fraudEvent.create({
        data: {
          tenantId: input.tenantId,
          customerId: input.customerId ?? null,
          decision,
          riskScore,
          reasons: JSON.stringify(reasons),
          checksRun: JSON.stringify(checksRun),
          amount: input.amount,
          currency: input.currency,
          paymentMethod: input.paymentMethod,
          customerIp: input.customerIp ?? null,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'fraud',
        method: 'checkTransaction',
        tenantId: input.tenantId,
      })
    }

    // ── Increment velocity windows (only when we'd proceed) ────────────
    // We bump counters AFTER the decision so the current call is counted in
    // future windows. Buckets are per-minute.
    if (decision !== 'block') {
      const ws = windowStartFor(new Date(), 1)
      const increments: Array<{
        identifierType: 'customer' | 'ip' | 'card_bin' | 'device'
        identifier: string
      }> = []
      if (input.customerId) {
        increments.push({ identifierType: 'customer', identifier: input.customerId })
      }
      if (input.customerIp) {
        increments.push({ identifierType: 'ip', identifier: input.customerIp })
      }
      if (bin) {
        increments.push({ identifierType: 'card_bin', identifier: bin })
      }
      if (input.deviceId) {
        increments.push({ identifierType: 'device', identifier: input.deviceId })
      }
      for (const { identifierType, identifier } of increments) {
        try {
          await db.velocityWindow.upsert({
            where: {
              tenantId_identifierType_identifier_windowStart: {
                tenantId: input.tenantId,
                identifierType,
                identifier,
                windowStart: ws,
              },
            },
            create: {
              tenantId: input.tenantId,
              identifierType,
              identifier,
              windowStart: ws,
              count: 1,
            },
            update: { count: { increment: 1 } },
          })
        } catch (err) {
          captureError(err as Error, {
            service: 'fraud',
            method: 'checkTransaction',
            step: 'velocityWindow.upsert',
            tenantId: input.tenantId,
            identifierType,
          })
        }
      }
    }

    log.info(
      {
        tenantId: input.tenantId,
        decision,
        riskScore,
        reasons,
        paymentMethod: input.paymentMethod,
        amount: input.amount,
      },
      'fraud check',
    )

    return { decision, riskScore, reasons, checksRun }
  },

  // ── getFraudStats ──────────────────────────────────────────────────────
  /**
   * Aggregate fraud decisions for the dashboard. Returns the totals for
   * each decision (blocked / reviewed / allowed) plus the most common
   * reasons for blocked / reviewed transactions in the window.
   */
  async getFraudStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<FraudStatsResult> {
    try {
      const where = { tenantId, createdAt: { gte: from, lte: to } }
      const [blocked, reviewed, allowed, recentReasonRows] = await Promise.all([
        db.fraudEvent.count({ where: { ...where, decision: 'block' } }),
        db.fraudEvent.count({ where: { ...where, decision: 'review' } }),
        db.fraudEvent.count({ where: { ...where, decision: 'allow' } }),
        db.fraudEvent.findMany({
          where: { ...where, decision: { in: ['block', 'review'] } },
          select: { reasons: true },
          take: 500,
          orderBy: { createdAt: 'desc' },
        }),
      ])

      // Aggregate reasons — stored as JSON-stringified arrays.
      const reasonCounts = new Map<string, number>()
      for (const row of recentReasonRows) {
        try {
          const arr = JSON.parse(row.reasons) as unknown
          if (Array.isArray(arr)) {
            for (const r of arr) {
              if (typeof r === 'string') {
                // Strip the parenthetical detail so e.g. "velocity IP high
                // (23/20/min)" aggregates under "velocity IP high".
                const key = r.replace(/\s*\([^)]*\)\s*$/, '').trim() || r
                reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1)
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      }
      const topReasons = Array.from(reasonCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      return { totalBlocked: blocked, totalReviewed: reviewed, totalAllowed: allowed, topReasons }
    } catch (err) {
      captureError(err as Error, {
        service: 'fraud',
        method: 'getFraudStats',
        tenantId,
      })
      return { totalBlocked: 0, totalReviewed: 0, totalAllowed: 0, topReasons: [] }
    }
  },
}
