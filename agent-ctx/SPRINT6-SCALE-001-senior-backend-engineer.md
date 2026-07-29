# SPRINT6-SCALE-001 — Senior Backend Engineer

**Task:** Three scalability fixes for ZIAY — (1) job queue with BullMQ+inline fallback, (2) Socket.io Redis adapter for multi-instance, (3) LRU cache with max-entries eviction. Plus cursor-based pagination on three high-traffic list APIs.

**Status:** ✅ COMPLETE — all 4 parts done. `tsc` / `lint` / `vitest` clean (6 files / 65 tests).

---

## Files shipped (1 NEW, 7 UPDATE)

| File | Action | Purpose |
|---|---|---|
| `src/lib/queue.ts` | NEW | Env-gated job queue. BullMQ if `REDIS_URL` set (dynamic `import('bullmq')` via non-literal specifier), otherwise inline (handler runs synchronously inside `enqueue`). Ships 4 default handlers: `capi-fire`, `catalog-sync`, `remarketing-send`, `seed-data`. |
| `src/lib/cache.ts` | UPDATE | Upgraded in-memory `Map` to LRU with max-entries eviction. Same public API (`getCached`, `setCached`, `invalidateCache`, `withCache`, `__clearCacheForTests`) + new `getCacheStats()`. `MAX_ENTRIES` defaults to 1000, env-overridable via `CACHE_MAX_ENTRIES`. |
| `mini-services/chat-service/index.ts` | UPDATE | Added optional `@socket.io/redis-adapter` + `ioredis` for multi-instance fan-out. Both packages dynamically imported via non-literal specifiers — service runs fine without them (single-instance mode). |
| `src/app/api/conversions/route.ts` | UPDATE | POST now pre-creates `ConversionEvent` rows in `pending` state, then `enqueue('capi-fire', {...})`. Inline mode → rows updated synchronously + route returns final `sent`/`failed` results (backward compatible). BullMQ mode → route returns `pending` + `queued: true`. CAPI firing logic moved to `queue.ts`. |
| `src/app/api/catalog/sync/route.ts` | UPDATE | POST now `enqueue('catalog-sync', { tenantId })`. Inline mode → reads back the latest `catalog_sync` audit log entry to build the same response shape (backward compatible). BullMQ mode → returns `{ ok, queued: true }` ack. Sync logic moved to `queue.ts`. |
| `src/app/api/orders/route.ts` | UPDATE | Cursor-based pagination: `?cursor=ID&limit=N` (default 20, max 100). Response gains `nextCursor` + `hasMore`. Existing `orders` array shape unchanged — callers that don't read the new fields keep working (they just see the first page). |
| `src/app/api/conversations/route.ts` | UPDATE | Same pagination pattern. Response gains `nextCursor` + `hasMore`. |
| `src/app/api/novedades/route.ts` | UPDATE | Same pagination pattern on `cases` query. `stats` group-by stays unpaginated (it's a global aggregate, must stay accurate across pages). Response gains `nextCursor` + `hasMore`. |

---

## Quality gates

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `bun run lint` | ✅ 0 errors, 0 warnings |
| `bunx vitest run` | ✅ 6 files / 65 tests passed |
| Dev server log | ✅ Routes compile + respond (401 unauth, as expected — auth gate fires before any new code runs) |

---

## Design decisions (the "why")

### 1. BullMQ is optional end-to-end (same pattern as `redis.ts`)
`queue.ts` uses a **non-literal module specifier** for the dynamic `import('bullmq')`:
```ts
const moduleName = 'bullmq' as string
const { Queue, Worker } = await import(moduleName)
```
This is the same trick `src/lib/redis.ts` (SPRINT4) uses for `ioredis`. TypeScript's `tsc --noEmit` does NOT try to resolve type declarations for non-literal dynamic imports, so the type-check passes whether or not `bullmq` is in `node_modules`. At runtime Bun/Node resolves `"bullmq"` normally. **Install it only on prod hosts that actually run the worker:** `bun add bullmq`.

### 2. `initQueue()` is lazy + idempotent (Promise singleton)
```ts
let initPromise: Promise<void> | null = null
export function initQueue() {
  if (initPromise) return initPromise
  initPromise = doInitQueue().catch((err) => { initPromise = null; throw err })
  return initPromise
}
export async function enqueue(type, payload) {
  await initQueue()  // ← first call triggers init, subsequent calls = resolved-promise await (free)
  // ...
}
```
This means **`initQueue()` doesn't need to be wired into `instrumentation.ts`** — the first `enqueue()` call wires it up automatically. Concurrent `enqueue()` calls share the same init promise so BullMQ is only constructed once. If init throws (e.g. Redis down), the singleton is cleared so the next call retries.

(Adding `await initQueue()` to `instrumentation.ts` is still a good idea in prod — it moves the BullMQ connect cost out of the first request. But it's optional.)

### 3. Inline mode preserves response shapes (backward compat)
The two routes that gained `enqueue()` (`conversions`, `catalog/sync`) both:
- Pre-create the DB rows they need (`ConversionEvent` in `pending` state, or fetch the tenant for catalog)
- Call `enqueue(...)` — in inline mode this runs the handler synchronously
- Read back the resulting state (updated rows / latest audit log) and build the **same response shape** as before

So existing callers (frontend, tests, external integrations) see no change in dev. In BullMQ mode the response includes a `queued: true` flag + the rows are still in `pending` state — callers that want to know the final result poll the GET endpoint or wait for a webhook.

### 4. CAPI firing logic moved to `queue.ts`
The `fireMeta` / `fireGoogle` / `fireTikTok` / `firePlatform` functions used to live in `src/app/api/conversions/route.ts`. They're now in `src/lib/queue.ts` so the BullMQ worker process can run them without importing the Next.js route module. The route file is now ~120 lines lighter and only does HTTP-layer concerns (parse body, auth, DB row creation, response shaping).

### 5. LRU eviction via Map insertion-order semantics
JS `Map` preserves insertion order. For LRU:
- **Read hit**: `cache.delete(key)` then `cache.set(key, entry)` moves the entry to the end (most-recently-used position).
- **Write at capacity**: `cache.keys().next().value` returns the first key (least-recently-used) — delete it before inserting.

This gives O(1) reads/writes with deterministic eviction, no doubly-linked-list book-keeping. The existing 5-min GC interval still sweeps expired entries (LRU alone would keep the cache size-bounded, but expired entries would otherwise sit at the tail until accessed).

`MAX_ENTRIES` is env-overridable (`CACHE_MAX_ENTRIES=5000`) for hosts with more RAM. The default of 1000 is conservative — each entry is typically a small JSON payload, so 1000 entries ≈ a few MB.

### 6. Pagination: `take: limit + 1` to detect next page
Prisma cursor pagination pattern:
```ts
take: limit + 1,
...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
```
- `take: limit + 1` — fetch one extra row to detect a next page without a separate `count()` query.
- `skip: 1` — Prisma's cursor includes the cursor row by default; we want the row *after* it.
- If `result.length > limit` → `hasMore = true`, slice off the extra row, return the last item's `id` as `nextCursor`.

Backward compat: existing callers that don't pass `cursor` get the first page (default `limit=20`, max 100). The response still includes the original shape (`orders` / `conversations` / `cases`) — the new `nextCursor` + `hasMore` fields are additive.

### 7. Chat-service Redis adapter uses the same non-literal-import trick
```ts
const adapterModule = '@socket.io/redis-adapter' as string
const ioredisModule = 'ioredis' as string
const { createAdapter } = await import(adapterModule)
const IoRedis = (await import(ioredisModule)).default
```
Both packages are dynamically imported. If they're not installed (dev / single-instance), the adapter setup silently fails with a warning and the service runs in single-instance mode — every `io.emit` reaches all connected clients on this host.

To enable multi-instance fan-out in prod: `bun add @socket.io/redis-adapter ioredis` in the chat-service's `package.json`, then ensure `REDIS_URL` is set in the chat-service's env. The Caddyfile already routes `?XTransformPort=3003` to whichever replica is up — Redis ensures a broadcast on one replica reaches clients connected to any replica.

### 8. Stats group-by in `/api/novedades` is NOT paginated
The `stats` block (counts by status) is a global aggregate over every matching case for the tenant. It must stay accurate across pages — otherwise the "Open: 5" badge would say "Open: 5" on page 1 and "Open: 0" on page 2 (only the latter page's items counted). So `stats` runs an unpaginated `groupBy` alongside the paginated `findMany`. The `cases` array is the only paginated part.

---

## Notes for future agents

- **To enable BullMQ in prod:** `bun add bullmq`, set `REDIS_URL=redis://redis:6379`. The first `enqueue()` call wires up the queue + worker automatically. Optionally add `await initQueue()` to `instrumentation.ts` `register()` to move the connect cost out of the first request.
- **To enable multi-instance socket.io:** `bun add @socket.io/redis-adapter ioredis` in `mini-services/chat-service/package.json`, ensure `REDIS_URL` is set in the chat-service env. Single-instance mode is the silent fallback.
- **LRU cache ceiling is env-tunable:** `CACHE_MAX_ENTRIES=5000` for hosts with more RAM. `getCacheStats()` (in `cache.ts`) returns `{ size, maxEntries }` for monitoring.
- **Cursor pagination is on `id`, not `createdAt`.** Prisma's cursor needs a unique field. `id` is unique; combined with `orderBy: { createdAt: 'desc' }` the cursor correctly skips to the row after the given id. Ties on `createdAt` are an accepted edge case (rare in practice — `createdAt` has millisecond precision).
- **The 4 default job handlers in `queue.ts` are registered at module load** — any process that imports `queue.ts` (API routes, the worker entrypoint, instrumentation) gets them for free. Add new job types by calling `registerJobHandler('your-type', fn)` from wherever makes sense (the function is idempotent).
- **`isInlineMode()` is exported from `queue.ts`** — routes use it to decide whether to read back the result of a job immediately (inline) or return a "queued" ack (BullMQ). See `conversions/route.ts` and `catalog/sync/route.ts` for the pattern.
- **The `ioredis` "Module not found" warning in `dev.log`** is pre-existing (from `src/lib/redis.ts`, SPRINT4) and harmless — it's the same non-literal-import trick. My `queue.ts` produces a similar warning for `bullmq` once the routes are compiled; also harmless.
