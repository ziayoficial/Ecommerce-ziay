// ZIAY — Webhook idempotency middleware
//
// SPRINT4-INFRA-001
//
// Payment platforms (Stripe, MercadoPago, Wompi, PayU) and messaging platforms
// (WhatsApp, Meta) retry webhooks when they don't receive a 2xx ACK within their
// timeout window — typically 3-5 retries over ~24h. Without deduplication, a
// single delayed ACK can cause:
//   - double-processed payments (e.g. applyPaymentUpdate fires twice)
//   - duplicated audit-log rows
//   - duplicated customer replies in the messenger
//
// This module provides a process-local dedup Map with a 5-minute TTL. The TTL
// is intentionally short: legitimate retries from these platforms arrive within
// seconds of each other (Stripe: immediate, 30s, 2m, 5m, 10m, 30m, 1h, 2h, 6h,
// 12h, 24h). 5 minutes is enough to swallow the burst; downstream
// `applyPaymentUpdate` is itself idempotent on `externalReference` (it upserts
// by `(tenantId, externalReference, gateway)`).
//
// For multi-instance production, swap the Map for `redisSet('idem:'+id, 1, 300)`
// — the API of `isDuplicateWebhook()` stays the same.
//
// Usage in a webhook route (after HMAC verification, before any DB write):
//
//   const webhookId = generateWebhookId(rawBody, signature)
//   if (isDuplicateWebhook(webhookId)) {
//     return NextResponse.json({ received: true, status: 'duplicate' })
//   }

const processedWebhooks = new Map<string, number>() // hash → timestamp (ms)
const TTL_MS = 5 * 60 * 1000 // 5 minutes

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
 * NOTE: this is a simple djb2-style hash (fast, 32-bit). For production with
 * a Redis backend, swap to `crypto.createHash('sha256').update(body+sig).digest('hex')`
 * — the function signature stays the same.
 */
export function generateWebhookId(body: string, signature: string): string {
  let hash = 0
  const str = body + signature
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // force 32-bit
  }
  return `wh_${Math.abs(hash)}`
}

/**
 * Exposed for tests / admin endpoints — not part of the public API.
 * Clears the in-memory dedup map. Useful for unit tests that need to assert
 * "first call processes, second call is deduped" without waiting 5 minutes.
 */
export function __clearIdempotencyForTests(): void {
  processedWebhooks.clear()
}
