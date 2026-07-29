// ZIAY — LRU cache with TTL + max-entries eviction.
//
// SPRINT2-RESILIENCE-001 (original) → SPRINT6-SCALE-001 (LRU upgrade)
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
// ── LRU semantics ───────────────────────────────────────────────────────────
// JS `Map` preserves insertion order. We exploit this for LRU:
//   - On read hit: `delete()` then `set()` moves the entry to the end
//     (most-recently-used position).
//   - On write at capacity: delete the first key returned by
//     `cache.keys().next()` (least-recently-used).
// This gives O(1) reads/writes with deterministic eviction, no extra
// doubly-linked-list book-keeping.
//
// ── Memory bounds ───────────────────────────────────────────────────────────
// `MAX_ENTRIES` defaults to 1000. Override with `CACHE_MAX_ENTRIES` env var.
// A periodic GC sweeps expired entries every 5 minutes so the cache can't
// grow unbounded for long-running server processes (the LRU eviction alone
// would keep it bounded, but expired entries would otherwise sit at the
// tail until accessed).

interface CacheEntry<T> {
  data: T
  expiresAt: number
  lastAccessed: number
}

const MAX_ENTRIES = parseInt(process.env.CACHE_MAX_ENTRIES || '1000', 10)

const cache = new Map<string, CacheEntry<unknown>>()

// GC: clean expired entries every 5 minutes so the Map doesn't grow
// unbounded for long-running server processes.
//
// `setInterval` is fine here — this module is imported only on the
// server (API routes / server components), never in the Edge runtime.
let gcStarted = false
function ensureGcStarted(): void {
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
 * LRU: a hit moves the entry to the most-recently-used position (end of the
 * Map) so it survives longer under eviction pressure.
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
  // LRU: move to end (most-recently-used) by delete + re-insert.
  cache.delete(key)
  entry.lastAccessed = Date.now()
  cache.set(key, entry)
  return entry.data as T
}

/**
 * Write a value to the cache with a TTL (default 60s).
 *
 * LRU: if the cache is at capacity, the least-recently-used entry (first key
 * in the Map) is evicted before the new entry is inserted.
 */
export function setCached<T>(key: string, data: T, ttlMs: number = 60_000): void {
  ensureGcStarted()
  // LRU eviction: if at capacity AND the key isn't already present (an
  // existing key just gets overwritten in place), remove the LRU entry.
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    lastAccessed: Date.now(),
  })
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

/**
 * Snapshot of the cache state — used by `/api/health` and admin endpoints.
 * `maxEntries` is the configured ceiling (env-overridable), `size` is the
 * current number of live entries (including unexpired but not-yet-evicted).
 */
export function getCacheStats(): { size: number; maxEntries: number } {
  return { size: cache.size, maxEntries: MAX_ENTRIES }
}

// Exposed for tests / admin endpoints — not part of the public API.
export function __clearCacheForTests(): void {
  cache.clear()
}
