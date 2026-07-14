// ZIAY — Webhook idempotency middleware
//
// SPRINT4-INFRA-001 — initial in-memory dedup (5-min TTL).
// FIX-REALTIME-WEBHOOKS-001 — sha256 hash (replaces collision-prone djb2)
//   + DB-backed `isDuplicateWebhookDB` helper for multi-instance safety.
//
// Payment platforms (Stripe, MercadoPago, Wompi, PayU) and messaging platforms
// (WhatsApp, Meta) retry webhooks when they don't receive a 2xx ACK within their
// timeout window — typically 3-5 retries over ~24h. Without deduplication, a
// single delayed ACK can cause:
//   - double-processed payments (e.g. applyPaymentUpdate fires twice)
//   - duplicated audit-log rows
//   - duplicated customer replies in the messenger
//
// Two layers of dedup:
//
// 1. In-memory Map (fast path) — 5-minute TTL. Catches the burst of immediate
//    retries (Stripe: 0s, 30s, 2m, 5m). Single-instance only.
//
// 2. DB-backed check (multi-instance safety) — queries `AuditLog` for a row
//    with `entityId = webhookId` and `action` starting with `webhook.`
//    within the last 10 minutes. Works across instances because all of them
//    share the same DB. The webhooks already call `safeAudit(...)` with the
//    webhookId as `entityId` (see payment-webhook-utils.ts), so this query
//    is cheap (indexed on `action` + `createdAt`).
//
// For TRUE production multi-instance with high throughput, swap layer 1 for
// `redisSet('idem:'+id, 1, 300)` — the API of `isDuplicateWebhook()` stays
// the same. Layer 2 (DB) remains as a durable fallback.

import crypto from 'crypto'
import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'

const log = getLogger('idempotency')

const processedWebhooks = new Map<string, number>() // hash → timestamp (ms)
const TTL_MS = 5 * 60 * 1000 // 5 minutes (in-memory fast path)
const DB_TTL_MS = 10 * 60 * 1000 // 10 minutes (DB-backed cross-instance)

// GC: sweep expired entries every 5 minutes so the Map doesn't grow unbounded.
// `unref()` so the timer never keeps the process alive on shutdown.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [hash, ts] of processedWebhooks) {
      if (now - ts > TTL_MS) processedWebhooks.delete(hash)
    }
  }, 5 * 60 * 1000).unref?.()
}

/**
 * Returns `true` if `id` was seen within the TTL window, otherwise records
 * `id` and returns `false`. The function is deliberately NOT async — the
 * in-memory Map is synchronous, and the Redis-backed variant can wrap this
 * behind a feature flag later without changing call sites.
 *
 * NOTE: this is the FAST PATH (single-instance). For multi-instance safety,
 * also call `isDuplicateWebhookDB()` before processing — that one IS async
 * and queries the shared AuditLog table.
 */
export function isDuplicateWebhook(id: string): boolean {
  const now = Date.now()
  const existing = processedWebhooks.get(id)
  if (existing && now - existing < TTL_MS) {
    return true // duplicate within the TTL window
  }
  processedWebhooks.set(id, now)
  return false
}

/**
 * Generate a stable webhook ID from the raw body + signature.
 *
 * The signature is included deliberately: a body that legitimately has the
 * same content but a different signature (e.g. two different senders, or the
 * same sender whose secret has rotated) should be processed as two events,
 * not deduplicated.
 *
 * FIX-REALTIME-WEBHOOKS-001 — switched from djb2 (32-bit, collision-prone)
 * to SHA-256. The djb2 hash had ~4 billion possible values; with high webhook
 * volume a birthday collision was plausible. SHA-256 makes accidental
 * collisions effectively impossible.
 *
 * The output is `wh_<hex>` (64 hex chars), suitable for storing in
 * `AuditLog.entityId` (a String column) for cross-instance dedup queries.
 */
export function generateWebhookId(body: string, signature: string): string {
  const hash = crypto.createHash('sha256').update(body + signature).digest('hex')
  return `wh_${hash}`
}

/**
 * DB-backed dedup check — queries `AuditLog` for a row matching the given
 * `webhookId` (stored as `entityId`) within the last 10 minutes. Works
 * across instances because all of them share the same DB.
 *
 * The `actionPrefix` narrows the scan to webhook actions (e.g.
 * `'webhook.stripe.'`) so unrelated audit rows don't match. The webhooks
 * already call `safeAudit(action, 'Webhook', meta, webhookId)` with the
 * webhookId as `entityId`, so the lookup is indexed and cheap.
 *
 * Returns `false` on any DB error — the in-memory Map (checked separately
 * by the caller) is the fallback. Webhooks must NEVER 500 just because the
 * dedup DB check failed.
 *
 * Usage:
 *   const webhookId = generateWebhookId(rawBody, signature)
 *   if (isDuplicateWebhook(webhookId)) return ack('duplicate')         // fast path
 *   if (await isDuplicateWebhookDB('webhook.stripe.', webhookId)) {    // durable
 *     // Record in memory so the next in-process retry is also fast-pathed.
 *     isDuplicateWebhook(webhookId)
 *     return ack('duplicate')
 *   }
 */
export async function isDuplicateWebhookDB(
  actionPrefix: string,
  webhookId: string,
): Promise<boolean> {
  try {
    const existing = await db.auditLog.findFirst({
      where: {
        entityId: webhookId,
        action: { startsWith: actionPrefix },
        createdAt: { gte: new Date(Date.now() - DB_TTL_MS) },
      },
      select: { id: true },
    })
    return !!existing
  } catch (err) {
    // DB unavailable — fall back to in-memory only. Don't fail the webhook.
    log.warn(
      { actionPrefix, err: err instanceof Error ? err.message : String(err) },
      'isDuplicateWebhookDB query failed — falling back to in-memory only',
    )
    return false
  }
}

/**
 * Exposed for tests / admin endpoints — not part of the public API.
 * Clears the in-memory dedup map. Useful for unit tests that need to assert
 * "first call processes, second call is deduped" without waiting 5 minutes.
 */
export function __clearIdempotencyForTests(): void {
  processedWebhooks.clear()
}
