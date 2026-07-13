// ZIAY — Redis client (optional, env-gated)
//
// SPRINT4-INFRA-001
//
// In production with `REDIS_URL` set, this module provides:
//   - `redisGet / redisSet / redisDel`  — JSON-serialised cache helpers
//   - `isRedisAvailable()`              — used by `/api/health` + `/api/health/ready`
//   - `getRedis()`                      — raw ioredis client (for socket.io adapter,
//                                          BullMQ, etc.)
//
// In development (no `REDIS_URL`) or when `ioredis` isn't installed, every
// helper degrades gracefully:
//   - `getRedis()` returns `null`
//   - `redisGet` returns `null` (cache miss)
//   - `redisSet` / `redisDel` are no-ops
//   - `isRedisAvailable()` returns `false`
//
// This means the rest of the codebase never needs to know whether Redis is
// present — callers always call `redisGet(key)` and fall back to their own
// in-memory cache (see `src/lib/cache.ts`) on `null`.
//
// `ioredis` is dynamically imported so the app does NOT crash if the package
// isn't installed in dev. In production, install it with `bun add ioredis`.

// We type the client loosely (`any`) on purpose: importing the full ioredis
// type tree here would force a hard dependency at type-check time, which
// defeats the "optional" contract. The runtime contract is documented above.
type RedisLike = {
  get: (key: string) => Promise<string | null>
  setex: (key: string, ttl: number, value: string) => Promise<unknown>
  keys: (pattern: string) => Promise<string[]>
  del: (...keys: string[]) => Promise<number>
  ping: () => Promise<string>
  quit: () => Promise<string>
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

import { getLogger } from '@/lib/logger'
const log = getLogger('redis')

let redisClient: RedisLike | null = null
let isConnecting = false

/**
 * Lazily connect to Redis. Returns `null` if:
 *   - `REDIS_URL` is not set, OR
 *   - `ioredis` is not installed, OR
 *   - the dynamic import throws.
 *
 * The client is shared across the whole process (singleton on `redisClient`).
 */
export async function getRedis(): Promise<RedisLike | null> {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return null

  if (!redisClient && !isConnecting) {
    isConnecting = true
    try {
      // Dynamic import with a NON-literal module specifier so TypeScript
      // does NOT try to resolve the type declarations (ioredis is an
      // optional prod-only dep — see package.json comment in the README).
      // At runtime Bun/Node still resolves "ioredis" normally.
      const moduleName = 'ioredis' as string
      const IORedis = (await import(moduleName)).default as { new (url: string, opts: Record<string, unknown>): RedisLike }
      const client = new IORedis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy: (times: number) => Math.min(times * 500, 2000),
      })

      client.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        log.error({ err: msg }, 'redis connection error')
      })
      client.on('connect', () => {
        log.info('redis connected')
      })

      redisClient = client
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn({ err: msg }, 'ioredis not available — using in-memory cache only')
      redisClient = null
    }
    isConnecting = false
  }

  return redisClient
}

/**
 * Read a JSON-serialised value from Redis. Returns `null` on miss or on any
 * error (cache is best-effort — never throws).
 */
export async function redisGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis()
  if (!redis) return null
  try {
    const val = await redis.get(key)
    return val ? (JSON.parse(val) as T) : null
  } catch {
    return null
  }
}

/**
 * Write a JSON-serialised value to Redis with a TTL (default 60s).
 * Silent no-op on any error.
 */
export async function redisSet<T>(key: string, value: T, ttlSeconds: number = 60): Promise<void> {
  const redis = await getRedis()
  if (!redis) return
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value))
  } catch {
    // silent fail — cache is best-effort
  }
}

/**
 * Delete every key starting with `prefix`. Used for cache busting after
 * writes (e.g. invalidate `catalog:${tenantId}:*` after a product upsert).
 */
export async function redisDel(prefix: string): Promise<void> {
  const redis = await getRedis()
  if (!redis) return
  try {
    const keys = await redis.keys(`${prefix}*`)
    if (keys.length > 0) await redis.del(...keys)
  } catch {
    // silent fail
  }
}

/**
 * Pings Redis. Use this in `/api/health` to report `ok` vs `not_configured`.
 * Returns `false` if Redis is not configured OR the ping fails.
 */
export async function isRedisAvailable(): Promise<boolean> {
  const redis = await getRedis()
  if (!redis) return false
  try {
    await redis.ping()
    return true
  } catch {
    return false
  }
}
