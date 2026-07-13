// ZIAY — In-memory rate limiter middleware
//
// Sliding-window rate limiter using an in-memory Map of IP → timestamps.
// Returns a 429 NextResponse if the limit is exceeded, null otherwise.
//
// Garbage collection runs every 5 minutes to evict expired entries.
//
// NOTE: This is a single-instance in-memory limiter. For multi-instance
// deployments, replace the Map with Redis (RATELIMIT_REDIS_URL) or Upstash.
//
// BUILD-AGENTS-LIB-001

import { NextRequest, NextResponse } from 'next/server'

interface RateLimitEntry {
  timestamps: number[]
}

interface RateLimitOptions {
  /** Max number of requests allowed within the window. */
  max: number
  /** Window size in milliseconds. */
  windowMs: number
  /** Optional namespace to scope limits (e.g. "whatsapp-webhook", "api:auth"). */
  namespace?: string
  /** Optional message returned in the 429 body. */
  message?: string
}

const store = new Map<string, RateLimitEntry>()
const GC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let lastGcAt = 0

/**
 * Apply a rate limit to an incoming request.
 *
 * @returns `null` if the request is allowed; a 429 NextResponse if exceeded.
 *
 * @example
 * ```ts
 * export async function POST(req: NextRequest) {
 *   const limited = rateLimit(req, { max: 60, windowMs: 60_000, namespace: 'wa-webhook' })
 *   if (limited) return limited
 *   // ...handle the request
 * }
 * ```
 */
export function rateLimit(
  req: NextRequest,
  opts: RateLimitOptions,
): NextResponse | null {
  const ip = getClientIp(req)
  const namespace = opts.namespace ?? 'global'
  const key = `${namespace}:${ip}`

  const now = Date.now()
  const windowStart = now - opts.windowMs

  // GC: prune expired entries periodically
  if (now - lastGcAt > GC_INTERVAL_MS) {
    gcExpiredEntries(opts.windowMs, now)
    lastGcAt = now
  }

  const entry = store.get(key)
  if (!entry) {
    store.set(key, { timestamps: [now] })
    return null
  }

  // Drop timestamps outside the sliding window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart)

  if (entry.timestamps.length >= opts.max) {
    const oldestInWindow = entry.timestamps[0] ?? now
    const retryAfterSec = Math.ceil((oldestInWindow + opts.windowMs - now) / 1000)
    const body = opts.message ?? 'Too Many Requests'
    return NextResponse.json(
      { error: body, retry_after: retryAfterSec },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(retryAfterSec, 1)),
          'X-RateLimit-Limit': String(opts.max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil((oldestInWindow + opts.windowMs) / 1000)),
        },
      },
    )
  }

  entry.timestamps.push(now)
  return null
}

/**
 * Extract the client IP from a NextRequest. Honors X-Forwarded-For and
 * X-Real-IP headers (typical behind Caddy / Vercel / Cloudflare).
 */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xReal = req.headers.get('x-real-ip')
  if (xReal) return xReal.trim()
  // Fallback to NextRequest.ip if available (deprecated in some Next versions)
  // @ts-expect-error — `ip` exists at runtime in some deployment targets
  if (typeof req.ip === 'string' && req.ip) return req.ip
  return 'unknown'
}

/**
 * Garbage-collect entries whose newest timestamp is older than the largest
 * plausible window (we use 1h as a safe upper bound).
 */
function gcExpiredEntries(_windowMs: number, now: number): void {
  const maxAgeMs = 60 * 60 * 1000 // 1 hour
  const cutoff = now - maxAgeMs
  for (const [k, v] of store) {
    const last = v.timestamps[v.timestamps.length - 1] ?? 0
    if (last < cutoff) store.delete(k)
  }
}

/**
 * Reset the rate limit state for a given key (useful for tests / admin).
 */
export function resetRateLimit(namespace: string, ip: string): void {
  store.delete(`${namespace}:${ip}`)
}

/**
 * Get the current count of requests in the window for inspection.
 */
export function getRateLimitCount(namespace: string, ip: string): number {
  return store.get(`${namespace}:${ip}`)?.timestamps.length ?? 0
}
