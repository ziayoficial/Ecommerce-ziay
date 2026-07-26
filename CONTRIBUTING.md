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

## Windows development (E2E-RATELIMIT-FIX-001)

The project was originally developed on Linux/macOS and some patterns
needed adjustment to work on Windows. This section documents the traps
and their fixes so future Windows devs don't redescovers them.

### Next.js middleware inlines `process.env` at build time
In Next.js middleware (Edge Runtime), `process.env.X` references are
**inlined at build time**, not read at runtime. This means:

```powershell
# WRONG — build without env vars, then set them: middleware keeps default
npm run build
$env:RATE_LIMIT_MAX = "10000"
npx playwright test  # middleware still uses 60 (default)

# RIGHT — set env vars BEFORE build, then build, then test
$env:RATE_LIMIT_MAX = "10000"
$env:AUTH_RATE_LIMIT_MAX = "1000"
npm run build         # middleware inlines 10000/1000 into the bundle
npx playwright test   # middleware uses 10000/1000 ✅
```

This only applies to middleware + Edge Runtime code. API routes in
Node.js runtime read `process.env` at runtime normally.

### Git + files with `"` in the name
The repo contains 10 PNG files in `upload/` with double-quotes in their
names (e.g. `upload/audit-1-"Resumen".png`). NTFS doesn't allow `"` in
filenames, so `git clone` on Windows fails the checkout step with:
```
error: invalid path 'upload/audit-1-"Resumen".png'
fatal: unable to checkout working tree
```

The objects download fine, but the working tree stays empty. To recover:

```powershell
git config core.protectNTFS false
git checkout -f HEAD -- .
```

This will checkout every file EXCEPT the 10 with `"` in the name (they
stay as "deleted" in `git status`, which is fine — they're not needed
for development). You can then work normally.

### PowerShell + UTF-8 BOM
Windows PowerShell 5.x (the default `powershell.exe`) adds a BOM
(`EF BB BF`) when you use `Set-Content -Encoding UTF8`. This breaks
JSON parsers and some TypeScript compilers. **Never use
`Set-Content -Encoding UTF8` for code or JSON files.**

Use this pattern instead (writes UTF-8 without BOM):

```powershell
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
```

PowerShell Core 7+ (`pwsh.exe`) does NOT add BOM with
`Set-Content -Encoding UTF8`, so if you have `pwsh` installed, you can
use the simple form. But for scripts that must work on both, use the
`[System.IO.File]::WriteAllText` pattern.

### Cross-platform build script
The `package.json` `build` script uses `node scripts/post-build.mjs`
(not `cp -r`) to copy `.next/static` and `public` into the standalone
output. This makes the build work on Windows, macOS, and Linux without
OS-specific commands. When adding new build steps, use Node.js scripts
(`.mjs` extension for ESM) instead of shell commands.

## Running E2E tests locally on Windows

A complete script that sets env vars + builds + runs tests:

```powershell
# Save as run-tests.ps1 and run with: .\run-tests.ps1
$env:RATE_LIMIT_MAX = "10000"
$env:AUTH_RATE_LIMIT_MAX = "1000"
$env:DATABASE_URL = "file:./db/custom.db"
$env:NEXTAUTH_SECRET = "dev-secret-change-me"
$env:ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
$env:WA_VERIFY_TOKEN = "dev-wa-verify"
$env:META_VERIFY_TOKEN = "dev-meta-verify"
$env:NOCODB_WEBHOOK_SECRET = "dev-nocodb-secret"
$env:NEXTAUTH_URL = "http://localhost:3000"

# Kill any existing server on port 3000
$conn = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }

# Build (env vars MUST be set before build for middleware to pick them up)
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "BUILD FAILED" -ForegroundColor Red; exit 1 }

# Run tests
npx playwright test
```

**Important:** set env vars BEFORE `npm run build`, not after. See
"Next.js middleware inlines `process.env` at build time" above.
## Database Scripts

The repo ships two smart DB scripts under `scripts/` that auto-detect the
Prisma provider (`sqlite` for dev / `postgresql` for staging+prod) and route
accordingly — no manual edits to `schema.prisma` needed:

- **`scripts/db-push.ts`** (`bun run db:push`) — pushes the current schema to
  the configured database. Picks the right provider block automatically.
- **`scripts/db-seed.ts`** (`bun run db:seed`) — seeds reference + demo data
  (tenants, products, AI agent catalog — currently **24 agents** = 20 consolidated base + 4 control-plane, was 26 in v0.4.0).
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
