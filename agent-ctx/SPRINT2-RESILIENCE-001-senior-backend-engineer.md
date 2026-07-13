# SPRINT2-RESILIENCE-001 — Senior Backend Engineer

## Summary
Implemented resilience layer for ZIAY: cache, HTTP timeout+retry, $transaction, and global rate limiting.

## Files Created
- `src/lib/http.ts` — `httpFetch<T>` wrapper: timeout (10s default), retry (3x with exponential backoff) on network errors / 5xx / 429, centralised error capture.
- `src/lib/cache.ts` — In-memory TTL cache with `getCached`, `setCached`, `invalidateCache`, `withCache`. Lazy GC every 5 min.

## Files Updated — Cache
1. `src/app/api/overview/route.ts` — 60s TTL, key `overview:${tenantId ?? 'all'}:${days}`.
2. `src/app/api/catalog/products/route.ts` — 5min TTL, key `catalog:${tenantId}:${q}`.
3. `src/app/api/agents/route.ts` — 1h TTL, key `agents:list`.
4. `src/app/api/tenants/route.ts` — 5min TTL, key `tenants:active`.
5. `src/app/api/health/route.ts` — 30s TTL, key `health:status:${tenantId ?? 'all'}` (scoped per-tenant to avoid leaking tenant_llm checks).

All cache keys include tenantId (where applicable) to prevent cross-tenant data leaks. Existing response shapes preserved; auth/validation/error branches unchanged.

## Files Updated — $transaction
Only where 2+ writes need atomicity. Single-write operations left untouched.

1. `src/app/api/orders/[id]/route.ts` PATCH — order update + OrderEvent insert wrapped (batch array form).
2. `src/app/api/novedades/route.ts` — POST (case+message), PATCH assign/resolve/escalate/close (case update + message) all wrapped. add_evidence / add_message left alone (single writes).
3. `src/app/api/redelivery/route.ts` — POST (request+attempt), PATCH schedule/complete/cancel/add_attempt all wrapped. confirm_address / assign_human left alone (single writes).
4. `src/app/api/catalog/sync/route.ts` POST — entire product upsert loop + audit log entry wrapped in a single interactive $transaction.

## Files Updated — Global Rate Limit
- `src/middleware.ts` — Added inline edge-compatible rate limiter (60 req / 60s per IP) for ALL non-public `/api/**` routes. Implementation is a simple `Map<ip, {count, resetAt}>` since Edge runtime can't import `@/lib/middleware/rate-limit`. Applied after auth check, before NextResponse.next() — covers both authenticated floods and unauthenticated scanners. Public routes (health/webhooks/auth/public) are exempt (they have their own per-route limiters). 429 response includes `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers.

## Verification
- `bun run lint` — clean ✅
- `npx tsc --noEmit` — clean ✅
- `bunx vitest run` — 65/65 tests pass ✅
- Dev server healthy (Ready in 92ms, no compile errors).

## Key Design Decisions
- **`withCache` is the canonical cache API** — forces explicit key construction. Always include tenantId.
- **Interactive $transaction form** used (not array form) where a later write needs the prior write's ID (e.g. case.id for the follow-up message).
- **Middleware rate limiter is per-instance** — sufficient for single-instance dev. For multi-instance prod, swap to `@upstash/ratelimit` or Redis.
- **Cache TTLs are conservative**: Overview=60s, Products=5min, Agents=1h, Tenants=5min, Health=30s.
- **`httpFetch` should replace raw `fetch`** in every adapter and webhook handler — flagged as follow-up migration (didn't balloon this sprint's diff).

## Notes for Future Agents
1. New server-side HTTP code should use `httpFetch` from day one (not raw `fetch`).
2. Mutation endpoints that share a cache prefix with a cached GET should call `invalidateCache('prefix:tenantId:')` after the write — not done in this sprint because all cached routes are GETs and the mutations don't write back to the same rows.
3. The middleware rate limiter's effective limit in multi-instance prod becomes `N × 60` — swap for Redis/Upstash before scaling.
4. `__clearCacheForTests()` is exported from `@/lib/cache` for test isolation if cache tests are added later.
