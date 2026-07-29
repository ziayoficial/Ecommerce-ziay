# SPRINT4-INFRA-001 — Senior DevOps + Backend Engineer

**Task:** Production-scale infrastructure for ZIAY: PostgreSQL migration support, optional Redis (cache/queue/socket), webhook idempotency, graceful shutdown, health-endpoint Redis check, env / docker-compose updates.

**Status:** ✅ COMPLETE — all 6 parts done, `tsc` / `lint` / `vitest` clean.

---

## Files shipped (3 NEW, 7 UPDATE)

| File | Action | Purpose |
|---|---|---|
| `prisma/schema.prisma` | UPDATE | Added Postgres migration comment block at the top. Provider unchanged (`sqlite`). |
| `src/lib/db.ts` | UPDATE | Added Postgres connection-pooling comment block. No code changes. |
| `src/lib/redis.ts` | NEW | Optional Redis client (env-gated by `REDIS_URL`). Falls back to in-memory cache silently. Dynamic `import('ioredis')` — never crashes if package not installed. |
| `src/lib/middleware/idempotency.ts` | NEW | In-memory dedup Map with 5-min TTL + GC. Used by all 6 webhooks. |
| `src/lib/graceful-shutdown.ts` | NEW | `setupGracefulShutdown(server?)` wired to SIGTERM/SIGINT/uncaughtException. Logs via pino. |
| `src/app/api/webhooks/{whatsapp,meta,mercadopago,wompi,stripe,payu}/route.ts` | UPDATE | Added `generateWebhookId` + `isDuplicateWebhook` after HMAC verification. Returns `{ received: true, status: 'duplicate' }` on dup (HTTP 200). |
| `mini-services/chat-service/graceful-shutdown.ts` | NEW | Self-contained graceful shutdown for the chat-service (separate bun project). |
| `mini-services/chat-service/index.ts` | UPDATE | Replaced inline SIGTERM/SIGINT handlers with `setupGracefulShutdown({ httpServer, io })`. |
| `src/app/api/health/route.ts` | UPDATE | Added `redis` check: `ok` / `error` / `not_configured`. |
| `src/app/api/health/ready/route.ts` | UPDATE | Readiness probe now also pings Redis if `REDIS_URL` is set. Soft-fails only when Redis is configured but unreachable. |
| `docker-compose.yml` | NO-CHANGE | Already had `REDIS_URL: "redis://redis:6379"` in both `app` and `chat-service` services (SPRINT1-INFRA-001). Confirmed. |
| `.env.example` | NEW | Documented all 50+ env vars + `REDIS_URL=` (didn't actually exist before). |

---

## Quality gates

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `bun run lint` | ✅ 0 errors, 0 warnings |
| `bunx vitest run` | ✅ 6 files / 65 tests passed |
| Dev server log | ✅ Ready in 7.4s, no errors |

---

## Design decisions (the "why")

### 1. Redis is OPTIONAL end-to-end
`getRedis()` returns `null` when `REDIS_URL` is unset OR `ioredis` isn't installed. Every helper (`redisGet` / `redisSet` / `redisDel` / `isRedisAvailable`) is a silent no-op in that case. The existing in-memory cache (`src/lib/cache.ts`) keeps working unchanged — no call site needed to change.

### 2. `ioredis` dynamically imported via non-literal module specifier
```ts
const moduleName = 'ioredis' as string
const IORedis = (await import(moduleName)).default as { new (url: string, opts: Record<string, unknown>): RedisLike }
```
TypeScript's `tsc --noEmit` does NOT try to resolve type declarations for non-literal dynamic imports, so the type-check passes whether or not `ioredis` is in `node_modules`. At runtime Bun/Node resolves `"ioredis"` normally. This means `ioredis` can be added in prod (`bun add ioredis`) or omitted in dev, without breaking the type-check.

### 3. Idempotency key = `body + signature` hash (djb2, 32-bit)
The signature is included deliberately: two senders with the same body (legitimate) but different signatures should NOT be deduplicated. The 5-minute TTL covers Stripe's immediate + 30s + 2m + 5m retry burst. The later 10m+ retries are absorbed by `applyPaymentUpdate`'s own upsert idempotency on `(tenantId, externalReference, gateway)`.

For multi-instance production, the in-memory Map can be swapped for `redisSet('idem:'+id, 1, 300)` — same function signature, same TTL.

### 4. Chat-service graceful shutdown is a separate file
The chat-service is mounted at `/app` in docker-compose, so relative imports back to `../../src/...` would NOT resolve at runtime. It also doesn't have pino / prisma in its `node_modules`. So `mini-services/chat-service/graceful-shutdown.ts` is self-contained — uses `console.log` and operates only on the socket.io + HTTP server.

Behaviour mirrors the main app's shutdown:
1. Close socket.io first (clean client disconnects — clients reconnect to another instance immediately).
2. Close HTTP server.
3. 5s force-exit safety net for `bun --hot` reload hangs.

### 5. Readiness probe is "soft" on Redis
If `REDIS_URL` is unset, the readiness probe still returns 200 (Redis is optional). If `REDIS_URL` is set but ping fails, the probe returns 503 with `reason: 'redis'` — the orchestrator should wait for Redis to come up before routing traffic.

---

## Notes for future agents

- **To enable Redis in prod:** `bun add ioredis`, set `REDIS_URL=redis://redis:6379`, restart. No code changes. Health endpoint will flip `redis` from `not_configured` to `ok`.
- **To migrate SQLite → PostgreSQL:** see the comment block at the top of `prisma/schema.prisma`. The existing `0_init` migration SQL is SQLite-dialect and will NOT apply to PostgreSQL as-is — use `pgloader` or `prisma migrate diff` to re-baseline.
- **`isGracefulShuttingDown()` is exported from both shutdown modules** — long-running handlers (queue workers, webhook processors) can poll it and bail early instead of starting work that won't get to finish.
- **Idempotency Map is process-local.** For multi-instance prod, swap the in-memory Map for `redisSet('idem:'+id, 1, 300)`. The `isDuplicateWebhook()` function signature stays the same — only its body changes.
- **`.env.example` was created from scratch** — prior worklog mentioned it but it didn't actually exist on disk. Documented all 50+ env vars read by the codebase (LLM providers, payment gateways, ad platforms, logistics adapters, webhooks, etc.) plus `REDIS_URL=` in its own section under the Core block.
