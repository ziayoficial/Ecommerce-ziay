# E2E-RATELIMIT-FIX-001 — Fix failing CI e2e-tests job (PR #47 follow-up)

**Agent:** senior-fullstack-developer (CI/test infra)
**Task ID:** E2E-RATELIMIT-FIX-001
**Date:** 2026-07-23 to 2026-07-25
**Scope:** Close the 2 failed + 1 flaky tests in the `e2e-tests` CI job that
PR #47 (commit `82dfa85`) failed to resolve. Root cause: hardcoded in-memory
rate limits in `src/middleware.ts` exhausted by 68 Playwright tests running
from a single CI runner IP.
**Status:** ✅ MERGED — PR #49, CI 6/6 jobs green.

## Context loaded before working

- `AGENTS.md` — engineering rules (fixes cosméticos prohibidos, verificación
  no-negociable, trazabilitad con Task ID, fix mecánico-patrón para
  non-Critical).
- `upload/LECCIONES-APRENDIDAS.md` — L1 (worklog puede mentie, validar
  contra disco), L8 (webhooks sin HMAC = vuln crítica), L13
  (`ignoreBuildErrors: true` es deuda técnica silenciosa).
- `src/middleware.ts` — two in-memory rate limiters (global 60/min, auth
  5/min), both hardcoded `const`, keyed by IP.
- `e2e/critical-flows.spec.ts`, `e2e/llm-costs.spec.ts`, `e2e/dashboard.spec.ts`,
  `e2e/governance.spec.ts` — 4 spec files with byte-for-byte identical copies
  of a `signIn()` helper (15 total call sites).
- `.github/workflows/ci.yml` — `e2e-tests` job runs `bunx playwright test`
  with 1 worker + 1 retry, all requests from `localhost` (single IP bucket).
- `playwright.config.ts` — `workers: 1, retries: 1` in CI.

## Root cause analysis

### Symptom (from CI log)
```
2 failed, 1 flaky, 65 passed of 68 tests in 3.7m

1) e2e/critical-flows.spec.ts:187 — Circuit breaker dashboard › shape
   Expected: 403
   Received: 429
   (retry #1: signIn():31 toBeGreaterThan(0) timed out at 30s)

2) e2e/llm-costs.spec.ts:50 — LLM Costs Dashboard › shows budget cards
   signIn():125 toBeGreaterThan(0) timed out at 30s
   (retry #1: toBeTruthy() timed out at 25s)

3) e2e/dashboard.spec.ts:54 — Dashboard — 16 views › marketplace nav  [flaky]
   signIn():215 toBeGreaterThan(0) timed out at 30s
```

### Why PR #47 (commit `82dfa85`) did NOT fix it
PR #47 only added `429` and `405` to the accept-lists of 3 test cases that
validate **unauthenticated** endpoints:
- `GET /api/orders/[id]`: accept 405
- `POST handoff missing action`: accept 429
- `GET circuit-breaker without auth`: accept 429

The 3 tests that kept failing **requiere authentication** — they call
signIn()` which POSTs to `/api/auth/callback/credentials`. Adding 429 to
the accept-list of a test that doesn't authenticate doesn't help a test
that NEEDS to authenticate and can't because the auth endpoint itself is
returning 429. This is a **fix cosmético** exactly of the type `AGENTS.md`
§"Contra los fixes cosméticos" prohibits.

### Actual root cause
`src/middleware.ts` lines 194-235 define two in-memory rate limiters:

```typescript
const RATE_LIMIT_MAX = 60       // hardcoded — all protected /api/** routes
const AUTH_RATE_LIMIT_MAX = 5   // hardcoded — /api/auth/callback/credentials + signin + signup
```

Both are `const` (not env-configurable), both use in-memory `Map`s keyed by
client IP. In CI, all 68 Playwright tests run from `127.0.0.1` (single IP
bucket). The suite makes:
- ~15 `signIn()` calls (each = 1 POST to ``/api/auth/callback/credentials`)`)
- ~15-30 retries on those (Playwright `retries: 1` in CI)
- ~30-60 polls to `/api/tenants` (the `signIn` helper polls until non-empty)
- dozens of authenticated API calls from the 65 passing tests

Total: well over 5 auth requests/min and over 60 API requests/min from the
same IP. By the time the suite reaches the later tests, both buckets are
exhausted → 429 → `signIn()` never authenticates → `/api/tenants` returns
401/302 → `res.ok()` is false → poll returns 0 → `toBeGreaterThan(0)`
times out at 30s.

## Changes applied

### Change 1 — `src/middleware.ts` (env-configurable rate limits)
Made both rate limit constants env-configurable with defaults preserved:

```typescript
// Before:
const RATE_LIMIT_MAX = 60
const AUTH_RATE_LIMIT_MAX = 5

// After:
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? '60', 10)
const AUTH_RATE_LIMIT_MAX = parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '5', 10)
```

**Production impact:** NONE. Defaults unchanged. Only overridable via env
vars that production deploys don't set.

### Change 2 — `.github/workflows/ci.yml` (CI env vars)
Added 2 env vars to the `e2e-tests` job's `env:` block (scoped to that job
only):

```yaml
      RATE_LIMIT_MAX: '10000'
      AUTH_RATE_LIMIT_MAX: '1000'
```

**Production impact:** NONE. These env vars only exist in the CI runner
for the `e2e-tests` job.

### Change 3 — `e2e/helpers.ts` (new) + DRY refactor
Created `e2e/helpers.ts` as the single source of truth for `signIn()` +
`TEST_EMAIL` + `TEST_PASSWORD`. Removed 4 byte-for-byte identical copies
of `signIn()` from:
- `e2e/critical-flows.spec.ts` (11 call sites preserved)
- `e2e/llm-costs.spec.ts` (1 call site preserved)
- `e2e/dashboard.spec.ts` (1 call site preserved)
- `e2e/governance.spec.ts` (1 call site preserved)

`e2e/auth.spec.ts` NOT touched — it uses a different helper
(`signInViaForm`) without the `/api/tenants` poll.

Net: -117 lines of duplication, +46 lines of documented helper.

### Change 4 — `package.json` + `scripts/post-build.mjs` (cross-platform build)
The original `package.json` build script used Unix-only `cp -r`:
```json
"build": "next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/"
```
This fails on Windows (`cp` not recognized). Replaced with:
```json
"build": "next build && node scripts/post-build.mjs"
```
Where `scripts/post-build.mjs` is a new ESM script that uses `fs` module
to do the two copies cross-platform. Uses `.mjs` extension (not `.js`)
because the project's ESLint config has `@typescript-eslint/no-require-imports`
which forbids `require()` in `.js` files — `.mjs` is always ESM so `import`
works.

## Documentation updated (4 files)

1. **`upload/LECCIONES-APRENDIDAS.md`** — added 5 new lessons:
   - **L59** — Rate limits hardcoded + E2E tests from a single IP = false negatives in CI
   - **L60** — Next.js middleware inlines `process.env` at build time, not runtime
   - **L61** — Windows + Git + files with `"` in name = corrupt index without `core.protectNTFS false`
   - **L62** — `Set-Content -Encoding UTF8` in Windows PowerShell 5.x adds BOM, breaks JSON
   - **L63** — Unix-only build scripts (`cp -r`) silently break Windows development

2. **`CHANGELOG.md`** — full entry under `[Unreleased]` → `### Fixed — E2E CI suite unblocked (E2E-RATELIMIT-FIX-001)`.

3. **`CONTRIBUTING.md`** —�]��X�[ۜ΂�H�L�H\��
��]H[Z]Ȉ
[��]�\�]\��X��\[\�[�K\]\������\
B�H��[����]�[�Y[��ZY]�\�H�Z[][YH[�[�[���]
���[[�[Y\���\��[��Kܛ���\]�ܛH�Z[
B�H��[��[��L�H\����[Hۈ�[���Ȉ
��\]H�[�]\�˜�X�ܚ\
B���
��\��[J��
Y�[�X��L�KT�USSRUQ�VLK\�[�[܋Y�[�X��Y]�[�\��Y
B�8�%�[���X�]\�H
��^
��\�Y�X�][ۈ�X�ܙ������\�Y�X�][ۂ�������[
�[����B�H���K[��[Z]�\��ܜH�H�[�[��\��ܜ�
��Y�X�H�\��[����KY^\�[��B�H�^]ܚY�\��
���͎\��Y
��[�K�[B�H�][���\�Έ�UW�SRU�PVLLUUԐUW�SRU�PVLL�H�]�YYY�S]H�
�H�[����YY
B�H�Z[ۙH�][���\���]
��ZY]�\�H[�[�Y[JB������H
�]X�X�[ۜ�B�H
����N��͈�؜�ܙY[���8�!B�H[�8�!B�H\X�X��8�!B�H[�]]\��8�!B�H�[�\K\�X�8�!B�H�Z[8�!B�HL�K]\��8�!B����\��Y\�[���[�\�Y\�[��]�[�Y[�
[�Z\��^\�B�����\��YHH8�%�][�][��XYو�]�ۙX�H\�\��[��][�][�[�[\H��\�[��XYو�]�ۙX�B���\�YۛH��]�
H[�\��[�[\�H�]���ڙX��[\ˈ�^���[[ݙKR][HT�X�\��HQ�ܘ�HX��[Y\��K^�X^N��]�ۙH΋���]X����KޚX^[ٚX�X[�X��[Y\��K^�X^K��]�����\��YH�8�%�\�[��Z[�ܚ\�Z[�ۈ�[���X��Y�K���ۘY��Z[����^�Z[	���\���^��]X���^��[�[ۙK˛�^�	���\�X�X���^��[�[ۙKȘ�ۈ�[������\ۉ�^\���^�ܙX]Y�ܚ\����X�Z[�Z��
T�K\�\���[�[JH[��[��YX��Y�K���ۘ���Z[����^�Z[	����H�ܚ\����X�Z[�Z�Ș��YH�˂�����\��YH�8�%��\��[�]P�۝[�Q[���[��U�Y���B��[�Y][��X��Y�K���ۘ�]�]P�۝[�Q[���[��U����H�[�����\��[K�H��H
Q�����
H�\�YY]H�\���^����Z[��Z[Y�]�[�^\��܎�[�^X�Y��[�	������������[H����\����[Y��Ә���^�\�H��\�[K�Sˑ�[WN��ܚ]P[^
	]	�۝[���\�[K�^�U�[���[��N���]�	�[�JJX
H	�[�XYX[����]�]��H�K��YH��������\��YH8�%�][�^�ܜ�\���H�[\��]�[��[Y\H�\�\�L���[\�[�\�Y��]�[�Z\��[Y\�
K�˂�\�Y�]Y]LKH��\�[Y[�����
K�����\ۉ�[���[��[[�[Y\���]�ۙXۈ�[�����Z[YH�X���]��ܜ�K��H�[\����X�[�H�][�^\��[]Y�[����]��[X[���[[��Y�H[B��]�\�]PQ�]�\�ܙHK\�Y�Y�]�\�]PQKH�\�YȘ�[�Z[Y�]\��܎�[��[Y]	�\�Y�]Y]LKH��\�[Y[������
K���^��]�ۙ�Y��ܙK���X�����[�X[��]�\�]
�X�Z[�B�[�^�]�]�[Y][�����Z[Y�[�[Y\�K��YH�K������\��YHH8�%�^���ZY]�\�H[�[�\����\�˙[��]�Z[[YB�Y�\�\Z[��H�]K[[Z]�^\���[�Z[Y��[H]�[��]�[���\���][�H�[�����]\�N��^�Z[
�]�]]�	��[�[ۙI�
B�[�[�\����\�˙[����Y�\�[��\�[�ZY]�\�H]�RS[YK���[�[YK��H�Z[Y�Y[�ۙH�U�U[���\����HZY]�\�H�[�HY��\���Y��^��][���\���Q�ԑH�H�[��Z[��Y�\���YH�������\��YH�8�%T�[���\�\]Z\�KZ[\ܝ�ۈ��X�Z[����H�\���\��[ۈو�ܚ\����X�Z[���\�Y�\]Z\�J
X
��[[ے��K��H�ڙX�	��T�[��ۙ�Y�\�\\�ܚ\Y\�[�ۛ�\�\]Z\�KZ[\ܝ��X���ܘ�Y��\]Z\�J
X]�[�[�����[\ˈ�H[��؈�Z[Y��^��[�[YY���ܚ\����X�Z[�Z��
[�^\�T�JH[���]�Y�\]Z\�J
X[\ܝ�][Y[�˂�����\��YH�8�%[\H]X�\�H
�YY�]�\��[�B�Y�\�[HX�ݙH�^\�\���[�Z[Y�X�]\�HH�S]H��\[\H8�%��\�\����[�[�ˈH�YYY�]�\��[��X��\�ٝ[H
�\�XB�[��[�\���[��[�Z[Y\�[���H[��[YH�P�ӓ��T�U
K���^��H�[����YY��[]H[[�]H
H[�[����\�\����X����۝�\��][ۜ�ܙ\��K������Y�H�[[X\�B��H��H�[��\�\YY
�]K[[Z][��X�ۙ�Y�
��H[���\��
��H[\�
ܛ���\]�ܛH�Z[
K��H��[Y[�][ۈ\�Y�X��ܙX]Y�\]Y
H\��ۜ�NKS��
��S��S��
�ӕ�P�US��
�\��[JK��H�[\��X�Y
��JN�ܘ��ZY]�\�K����]X���ܚٛ�����K�[[�L�K�[\�˝�
�]�KL�K�ܚ]X�[Y���˜�X˝��L�K�\���\���X˝�L�K��ݙ\��[��K��X˝�L�K�KX���˜�X˝��X��Y�K���ۘ�ܚ\����X�Z[�Z��
�]�K��H�[\��X�Y
���N�\�Y�P��SӑT�PT�S�QT˛Y�S��S�˛Y��ӕ�P�US�˛YY�[�X��L�KT�USSRUQ�VLK\�[�[܋Y�[�X��Y]�[�\��Y��H��X�[ۈ[\X���ӑH8�%�]K[[Z]Y�][�[��[��YۛB�ݙ\��YX�H�XH[���\��]��X�[ۈ�\ۉ��]��H�H[\X��L�K]\���؈�[����H��Z[Y�H�Z�H8����͎\�˂�[��H�؜�ܙY[�ۈ��K��HQ�S�˛Y��\X[��N��^YX��[�X��\]��ۈ
[��X�ۙ�Y�
��H
�ܛ���\]�ܛB��Z[
K���Y\�YۈوH�]K[[Z]\��]X�\�K�H[�[Y[[ܞHX\\�[�[��KZ[��[��H
][KZ[��[��H��[�YY�Y\��\�\�[�XYB���[Y[�Y[�ܘ��ZY]�\�K����[Y[��\�Hۛ�ۈ����]\
K�