# Contributing to ZIAY

## Development Workflow

1. **Branch:** `feat/description` or `fix/description`
2. **Commit:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`)
3. **PR:** Squash-merge to `main`

## Pre-commit Hook (Sprint 5C)

The repository ships a git hook at `.githooks/pre-commit` that runs before
every commit is created. It is wired up via `core.hooksPath` (run once per
clone — see `git config core.hooksPath .githooks`).

What the hook does:

1. **Type check** — `npx tsc --noEmit --incremental` (uses the TS build cache,
   so the first commit is slow but subsequent commits are fast). Fails the
   commit on type errors.
2. **Lint staged files** — `bunx eslint <staged .ts/.tsx files>` with the
   `no-unused-vars` rule promoted to `error`. Lint warnings are
   **non-blocking** (the hook prints a `⚠️` but the commit still succeeds).

To bypass the hook for a one-off commit (e.g. WIP snapshot):

```bash
git commit --no-verify -m "chore: WIP snapshot"
```

To re-enable the hook on a fresh clone:

```bash
git config core.hooksPath .githooks
```

If lint/tsc results ever look stale (false positives after a branch switch or
schema change), run `scripts/clean-cache.sh` to wipe `tsconfig.tsbuildinfo`,
`.eslintcache`, `.next/cache` and `node_modules/.vite`.

## Before Submitting a PR

- [ ] `bun run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `bun run test` passes — **986 unit tests** (was 964 before v0.4.0 audit cycle)
- [ ] `bun run test:e2e` passes — 52 Playwright E2E tests
- [ ] No new `any` types
- [ ] No `console.log` in server code (use `logger`)
- [ ] Zod validation on new API endpoints
- [ ] `requireTenantAccess` on tenant-scoped routes

## Continuous Integration

Every push and pull request runs the **6-job CI pipeline** defined in
`.github/workflows/ci.yml`. All 6 jobs must be green before a PR can merge:

1. **lint** — `bun run lint` (ESLint, 0 errors allowed)
2. **typecheck** — `npx tsc --noEmit` (0 errors allowed; was 58 before remediation)
3. **unit-tests** — `bun run test` (986 tests)
4. **openapi** — `bun run openapi:validate` (verifies `docs/openapi.yaml` against the spec)
5. **build** — `bun run build` (Next.js production build, PostgreSQL provider)
6. **e2e** — `bun run test:e2e` (Playwright, 52 tests)

Local pre-flight before pushing:

```bash
bun run lint && npx tsc --noEmit && bun run test && bun run test:e2e
```

## Database Scripts

The repo ships two smart DB scripts under `scripts/` that auto-detect the
Prisma provider (`sqlite` for dev / `postgresql` for staging+prod) and route
accordingly — no manual edits to `schema.prisma` needed:

- **`scripts/db-push.ts`** (`bun run db:push`) — pushes the current schema to
  the configured database. Picks the right provider block automatically.
- **`scripts/db-seed.ts`** (`bun run db:seed`) — seeds reference + demo data
  (tenants, products, AI agent catalog — currently **27 agents**, was 26).
  Reads `prisma.seed` from `package.json` for the runner command.

Both scripts are idempotent and safe to re-run.

## Code Style

- TypeScript strict mode
- `'use client'` / `'use server'` directives where needed
- shadcn/ui components over custom
- Spanish UI text (LATAM market)
- JSDoc on exported functions

## Adding New Features

### New API route
1. Create `src/app/api/<path>/route.ts`
2. Use `requireTenantAccess(tenantId)` for auth
3. Validate input with Zod
4. Wrap in `withErrorHandling()`
5. Add to `/api-docs` if user-facing

### New AI agent
1. Add prompt to `src/lib/agents/prompts/`
2. Register in `AGENT_NAMES` + `AGENT_LABELS`
3. Add output Zod schema to `src/lib/agents/schemas.ts`
4. Add fallback message in `FALLBACKS`

### New payment adapter
1. Create `src/lib/adapters/<gateway>.ts`
2. Implement `PaymentAdapter` interface
3. Register in `payment-registry.ts`
4. Add webhook route `src/app/api/webhooks/<gateway>/route.ts`
5. Verify HMAC signature with `timingSafeEqual`
