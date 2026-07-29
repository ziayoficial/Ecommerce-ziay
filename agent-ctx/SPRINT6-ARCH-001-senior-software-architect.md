# SPRINT6-ARCH-001 — Senior Software Architect

**Task**: Service layer + try/catch rollout for the 52-route API surface.

## Scope owned

- **NEW** `src/lib/services/` (9 files): `order.service.ts`,
  `conversation.service.ts`, `catalog.service.ts`,
  `novedades.service.ts`, `ads.service.ts`, `monetization.service.ts`,
  `logistics.service.ts`, `marketplace.service.ts`,
  `overview.service.ts`, `index.ts` (barrel).
- **UPDATED** 18 API route files (added try/catch + `captureError`
  import; NO logic changes):
  - `src/app/api/route.ts`
  - `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`
  - `src/app/api/conversations/route.ts`, `src/app/api/conversations/[id]/route.ts`
  - `src/app/api/channels/route.ts` (all 4 verbs)
  - `src/app/api/ads/route.ts`, `src/app/api/ads/[id]/route.ts`
  - `src/app/api/payments/config/route.ts`
  - `src/app/api/catalog/products/route.ts`, `src/app/api/catalog/send-to-chat/route.ts`
  - `src/app/api/overview/route.ts`
  - `src/app/api/agents/route.ts`
  - `src/app/api/tenants/route.ts`
  - `src/app/api/monetization/{gmv,commission,generate-invoice}/route.ts`
  - `src/app/api/logistics-intelligence/route.ts`

## What was NOT touched (per task contract)

- Webhooks, health, auth, public, api-docs routes.
- API route business logic — only the try/catch wrapper was added.
- Migration of routes to call the new services — that's a follow-up sprint.

## Design contract for services

Every service method:
1. `try` / `catch` on every DB call.
2. `captureError(err as Error, { service, method, ...identifiers })` on catch.
3. `getLogger('service:xxx').info(...)` for state-changing ops.
4. Throws a uniform `new Error('Failed to <action>')` — callers never see Prisma internals.
5. Uses `unknown` (not `any`) for complex types.
6. Audit-log writes are best-effort (nested try/catch) — a bad audit table must never roll back a real state change.

## Verification (all green)

| Check | Result |
|-------|--------|
| `bun run lint` | clean (exit 0) |
| `npx tsc --noEmit -p tsconfig.json` | clean (exit 0) |
| `bunx vitest run` | 65 tests pass (6 files), 0 failures |
| Dev server log | still running; pre-existing `ioredis` warning unrelated |

## Notes for future agents

- **Migrating routes to services**: next architectural sprint should
  migrate the 18 try/catch'd routes from `db.*` to `xxxService.*`. Error
  contract is already uniform, so the migration is mostly mechanical.
  Start with the simplest (orders, conversations) — they already match
  the service signatures 1:1.
- **`getTramo(gmv)` is exported from `monetization.service.ts`** — single
  source of truth for the 4.5% / 3.0% / 1.75% commission tiers. Any new
  code that needs the tramo should import it.
- **Service layer is server-only** — every file imports `@/lib/db`
  (Prisma). They MUST NOT be imported from client components. The barrel
  `index.ts` makes this obvious (one import site to audit).
- **Audit-log best-effort pattern**: `monetization.service.ts` and
  `ads.service.ts` wrap their audit-log writes in a nested try/catch
  (capture but don't surface). Replicate in future services.
- The task brief said "21 APIs without try/catch" — actual count was 18
  (zero try/catch). The gap is approximate; some routes had try/catch on
  one verb but not another, but we treated "zero try/catch in the file"
  as the bar.
