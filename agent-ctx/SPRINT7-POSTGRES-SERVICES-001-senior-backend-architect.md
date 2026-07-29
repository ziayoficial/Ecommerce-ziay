# SPRINT7-POSTGRES-SERVICES-001 — senior-backend-architect

## TL;DR
- ✅ PostgreSQL migration setup complete (schema, env, docs, migrations)
- ✅ All 10 API routes migrated from `db.*` to `xxxService.*` — response shapes unchanged
- ✅ `bun run lint`, `npx tsc --noEmit`, `bunx vitest run` — all clean (65 tests pass)
- ✅ `bunx prisma validate` — schema valid

## Files modified

### Part 1 — PostgreSQL migration setup (6 files)
1. `prisma/schema.prisma` — comments only (provider stays `sqlite` for dev)
2. `prisma/migrations/0_init/migration.sql` — regenerated from schema (1125 lines)
3. `prisma/migrations/1_postgres_indexes/migration.sql` — NEW (183 lines)
   - 71 idempotent `CREATE INDEX IF NOT EXISTS` statements
   - RLS policies from `src/lib/rls.ts` (verbatim)
   - pgvector commented out for future use
4. `src/lib/db.ts` — added `'query'` to dev logs, clearer pooling comment
5. `.env.example` — Database section rewritten with 3 variants
6. `PRODUCTION-CHECKLIST.md` — new "🐘 PostgreSQL Migration" section (10 steps)

### Part 2 — Service-layer migrations (3 service files + 10 API routes)

**Services updated:**
- `src/lib/services/order.service.ts` — added cursor/limit to `OrderFilters`
- `src/lib/services/conversation.service.ts` — added cursor/limit; `getConversationById(id, tenantId?)` switched to `findFirst`
- `src/lib/services/novedades.service.ts` — added cursor/limit

**API routes migrated (response shapes preserved):**
- 2a. `/api/orders` (GET) → `orderService.getOrders`
- 2b. `/api/orders/[id]` (PATCH) → `orderService.updateOrder`
- 2c. `/api/conversations` (GET) → `conversationService.getConversations`
- 2d. `/api/conversations/[id]` (GET+PATCH) → `conversationService.getConversationById` + `updateStatus`
- 2e. `/api/catalog/products` (GET) → `catalogService.getProducts`
- 2f. `/api/novedades` (GET+POST) → `novedadesService.getCases` + `createCase`
- 2g. `/api/ads` (GET) → `adsService.getAds`
- 2h. `/api/monetization/gmv` (GET) → `monetizationService.getGMV`
- 2i. `/api/monetization/commission` (GET) → `monetizationService.getCommissions`
- 2j. `/api/logistics-intelligence` (GET) → `logisticsService.getDashboardData`

## Out-of-scope items (left inline, documented in route comments)
- `/api/conversations` POST — sends a message; signature mismatch with `conversationService.sendMessage`
- `/api/novedades` PATCH action dispatch — multi-write transactions have no 1:1 service method
- `/api/monetization/commission` POST — two-moment recognition logic has no service equivalent
- `/api/ads` `db.setting.findMany` — no service for `Setting` reads
- `/api/novedades` POST `db.order.findUnique` — pure read for tenant validation

## Verification results
- `bunx prisma validate` → ✅ The schema at prisma/schema.prisma is valid 🚀
- `bun run lint` → ✅ exit 0
- `npx tsc --noEmit` → ✅ exit 0
- `bunx vitest run` → ✅ 6 files, 65 tests, all passing

## Notes for future agents
- The `0_init/migration.sql` is SQLite-flavoured. When flipping to PostgreSQL, Prisma will re-emit it in PG dialect. See PRODUCTION-CHECKLIST.md → "PostgreSQL Migration".
- `1_postgres_indexes/migration.sql` is fully idempotent (IF NOT EXISTS + CREATE OR REPLACE FUNCTION).
- Backward-compat safety: all updated services fall back to `take: 200` when `limit` is omitted.
- The `tenantId` parameter added to `getConversationById`, `updateStatus`, `updateOrder` is optional — for log/capture context, not injected into `where` clauses.
- `migration_lock.toml` left as `provider = "sqlite"` — flip to `"postgresql"` at deploy time.
