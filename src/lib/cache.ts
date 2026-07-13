// ZIAY — Simple in-memory cache with TTL.
//
// Designed for dev / single-instance deployments. For multi-instance
// production, replace the `cache` Map with a Redis-backed store — the
// function signatures (`getCached`, `setCached`, `invalidateCache`,
// `withCache`) stay the same so callers don't need to change.
//
// CRITICAL: cache keys MUST include `tenantId` (or similar scope) so
// that one tenant never reads another tenant's cached data. Always
// prefer the `withCache()` wrapper — it forces you to construct the
// key explicitly.
//
// SPRINT2-RESILIENCE-001

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()

// GC: clean expired entries every 5 minutes so the Map doesn't grow
// unbounded for long-running server processes.
//
// `setInterval` is fine here — this module is imported only on the
// server (API routes / server components), never in the Edge runtime.
let gcStarted = false
function ensureGcStarted() {
  if (gcStarted) return
  gcStarted = true
  setInterval(
    () => {
      const now = Date.now()
      for (const [key, entry] of cache) {
        if (entry.expiresAt < now) cache.delete(key)
      }
    },
    5 * 60 * 1000,
  ).unref?.()
}

/**
 * Read a cached value. Returns `null` if missing or expired.
 *
 * NOTE: `null` is used as the sentinel for "no cache hit" — so caching
 * a literal `null` value is indistinguishable from a miss. That's
 * intentional for our use-cases (DB rows / JSON responses).
 */
export function getCached<T>(key: string): T | null {
  ensureGcStarted()
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

/**
 * Write a value to the cache with a TTL (default 60s).
 */
export function setCached<T>(key: string, data: T, ttlMs: number = 60_000): void {
  ensureGcStarted()
  cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

/**
 * Invalidate every cache key starting with `prefix`. Useful for cache
 * busting after a write (e.g. after `db.product.upsert` → invalidate
 * `catalog:${tenantId}:`).
 */
export function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/**
 * Cache-through wrapper for async functions.
 *
 * - If `key` is in the cache and not expired → returns cached value.
 * - Otherwise → calls `fn()`, stores the result with `ttlMs`, returns it.
 *
 * @example
 * ```ts
 * const products = await withCache(
 *   `catalog:${tenantId}:${q}`,
 *   5 * 60_000,
 *   () => db.product.findMany({ where: { tenantId, ... } }),
 * )
 * ```
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = getCached<T>(key)
  if (cached !== null) return cached
  const data = await fn()
  setCached(key, data, ttlMs)
  return data
}

// Exposed for tests / admin endpoints — not part of the public API.
export function __clearCacheForTests(): void {
  cache.clear()
}
