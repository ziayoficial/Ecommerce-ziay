# Work Record — IF-2 · full-stack-developer (security-bypass-fixer)

**Task ID:** IF-2
**Agent:** full-stack-developer (security-bypass-fixer)
**Started:** 2026-07-22
**Scope:** Critical security fixes from `public/presentaciones/AUDITORIA-FULL-SECURITY-CODE-TEST.md` — 9 cross-tenant bypass routes (S-1..S-8) + `nocodb-out` missing auth (S-9) + hardcoded webhook secret fallbacks (S-11/S-12) + `Math.random()` for TOTP backup codes (S-13). S-10 (`ENCRYPTION_KEY` fail-closed) was also folded in as part of the secret-hardening pattern.

## Context loaded
- Read `/home/z/my-project/worklog.md` (last ~500 lines via tail) — established the prior SPRINT work, the auth-helpers API, the audit history.
- Read `/home/z/my-project/public/presentaciones/AUDITORIA-FULL-SECURITY-CODE-TEST.md` (full file) — established the exact failing line numbers and the prescribed fixes for S-1..S-20.
- Read `/home/z/my-project/src/lib/auth-helpers.ts` — confirmed `requireTenantAccess(tenantId)` returns `Promise<{ session, error: NextResponse | null }>` and the established usage pattern `const { error } = await requireTenantAccess(tenantId); if (error) return error`. Also confirmed `requireRole(roles[])` exists for S-7/S-8.
- Read `src/lib/middleware/hmac.ts` — confirmed `verifyHmacSha256(rawBody, signature, secret)` uses `timingSafeEqual` (safe for the S-9 fix).
- Read existing fixed routes (`src/app/api/conciliation/route.ts` referenced in the task) and `src/lib/auth.ts:25-30` (the fail-closed-at-boot pattern for `NEXTAUTH_SECRET`) to mirror conventions.

## Files modified (13)

### Cross-tenant bypass fixes (S-1..S-8)

| # | File | Fix |
|---|------|-----|
| S-1 | `src/app/api/conversations/search/route.ts` | Added `requireTenantAccess(tenantId)` after the `if (!tenantId || !q)` 400-check, before `searchSimilar`. |
| S-2 | `src/app/api/image-identifications/route.ts` | Added `requireTenantAccess(tenantId)` after `if (!tenantId)`, before `db.imageIdentification.findMany`. |
| S-3 | `src/app/api/conversational-cart/route.ts` | Added `requireTenantAccess(tenantId)` to BOTH `GET` (before `findFirst`) and `POST` (top of handler — covers all 3 actions: add_items, confirm_all, convert_to_order). |
| S-4 | `src/app/api/vision-pipeline/route.ts` | Added `requireTenantAccess(tenantId)` BEFORE `identifyImage()` (closes LLM-cost abuse) + before `db.imageIdentification.create` + `db.auditLog.create` (closes audit-log injection). |
| S-5 | `src/app/api/address-analysis/route.ts` | Added `requireTenantAccess(tenantId)` AFTER the IP rate-limit + body destructuring, BEFORE `buildAgentPrompt` + ZAI chat completion. Rate-limit stays as defense-in-depth. |
| S-6 | `src/app/api/attribution/route.ts` | Added `requireTenantAccess(tenantId)` to BOTH `GET` (before `getCreditedRevenueByAd`) and `POST` (before `recomputeAttributionWeights` + AuditLog insert). |
| S-7 | `src/app/api/llm-providers/route.ts` | `GET`: added `requireTenantAccess(tenantId)` (closes leak of `credencialesIaRef`). `PATCH`: added `requireRole(['admin'])` (only tenant admins may change AI provider — was open to ANY authed user including `agent`/`marketing`) AND `requireTenantAccess(tenantId)` (closes cross-tenant write). |
| S-8 | `src/app/api/onboarding/route.ts` | This route CREATES a new tenant so `requireTenantAccess` doesn't apply. Added `requireRole(['admin'])` + Zod schema (`ONBOARDING_SCHEMA` with `slug: /^[a-z0-9-]{3,40}$/`, enums for plataformaCatalogo/bdCatalogo/proveedorIa/proveedorLogistico/planMonetizacion, length caps, `feeBaseMensual` int≤10M) + rate-limit 5/hour/IP. Replaced bare `await req.json()` + ad-hoc `if (!slug)` with `safeParse`. |

### Webhook auth + hardcoded-secret fixes (S-9, S-11, S-12)

| # | File | Fix |
|---|------|-----|
| NEW | `src/lib/middleware/webhook-secrets.ts` | Shared fail-closed env-var resolver. In prod, returns `null` if env var missing (caller rejects request with 500). In dev, `console.warn` + deterministic insecure default. Three resolvers: `resolveNocodbSecret()`, `resolveWaVerifyToken()`, `resolveMetaVerifyToken()`. |
| S-9 | `src/app/api/webhooks/nocodb-out/route.ts` | REWROTE. Now requires `x-nocodb-signature: <hex HMAC-SHA256(rawBody, secret)>`. Reads raw body via `req.text()`, computes HMAC via `verifyHmacSha256` (timing-safe), returns 401 on mismatch. Audit-logs the rejection. Validates body schema (`event, orderId, tenantId` required) before writing AuditLog. Uses `resolveNocodbSecret()` (no hardcoded fallback). |
| S-11 | `src/app/api/webhooks/nocodb-in/route.ts` | Replaced `process.env.NOCODB_WEBHOOK_SECRET || 'commerceflow_nocodb'` with `resolveNocodbSecret()`. If null (prod + missing env var), returns 500. |
| S-12 (a) | `src/app/api/webhooks/whatsapp/route.ts` GET | Replaced `process.env.WA_VERIFY_TOKEN || 'commerceflow_verify'` with `resolveWaVerifyToken()`. If null (prod + missing), returns 500. |
| S-12 (b) | `src/app/api/webhooks/meta/route.ts` GET | Replaced `process.env.META_VERIFY_TOKEN || 'commerceflow_verify'` with `resolveMetaVerifyToken()`. If null (prod + missing), returns 500. |

### TOTP fixes (S-10, S-13)

| # | File | Fix |
|---|------|-----|
| S-10 | `src/lib/totp.ts` (line 20) | Replaced `const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'ziay-dev-encryption-key-change-in-prod-32b!'` with fail-closed pattern matching `src/lib/auth.ts:25-30`. In prod without `ENCRYPTION_KEY`, throws at boot with `captureError` (Sentry + pino log, best-effort try/catch). In dev, `console.warn` + uses the dev fallback. NOTE: another concurrent agent (likely IF-3) had inserted a `require()`-based `captureError` call with an unused eslint-disable — converted it to a clean ES `import { captureError } from '@/lib/capture-error'` (no circular import risk — `capture-error` imports only `@sentry/nextjs` and `./logger`, neither of which imports `totp`). This also fixed a lint error (`@typescript-eslint/no-require-imports`) introduced by the parallel edit. |
| S-13 | `src/lib/totp.ts` (line ~135, `generateBackupCodes`) | Replaced `Math.floor(Math.random() * 100_000_000)` with `crypto.randomInt(0, 100_000_000)` (CSPRNG from `node:crypto`). Same 8-digit padded format (`####-####`) preserved. No import change needed (file already imports `crypto from 'node:crypto'`). |

## Verification
- `npx tsc --noEmit` → **0 errors** (grep `error TS` count = 0).
- `bun run lint` → **0 errors, 38 pre-existing warnings** (warnings are all in scripts/ and unrelated lib files — not introduced by this task).
- `rg "commerceflow_" src/ | grep -v node_modules | grep -v .test.` → **4 matches, all in comments** explaining what was removed. No runtime code uses the literal.
- `rg "NOCODB_WEBHOOK_SECRET \|\||WA_VERIFY_TOKEN \|\||META_VERIFY_TOKEN \|\||ENCRYPTION_KEY \|\|" src/` → **0 matches**.

## Decisions / deviations from task spec
- **S-9 implementation choice**: The audit suggested EITHER `X-Nocodb-Token` (matching `nocodb-in`'s plain-equality check) OR moving the route out of `PUBLIC_PATTERNS` and using `CRON_SECRET`. The user's task spec explicitly asked for HMAC-SHA256 with `crypto.timingSafeEqual` over the raw body using `NOCODB_WEBHOOK_SECRET`. I followed the user's spec — stronger than the audit's first option (HMAC + timing-safe compare beats plain `===` token check) and more ergonomic than the second (no middleware change needed, route stays webhook-public but cryptographically gated). I also added `tenantId` to the required body fields (was missing in the original route — only `event`, `orderId`, `newStatus` were destructured, but `tenantId` was needed by `db.auditLog.create` and would have crashed on undefined).
- **S-8 rate-limit**: The audit recommended "rate-limit 5/hora/IP" as part of the fix. I implemented it via the existing `rateLimit(req, { max: 5, windowMs: 3_600_000 })` helper from `@/lib/middleware/rate-limit` (in-memory Map, same caveat as S-15 — fails in multi-instance, but that's a separate audit finding).
- **S-10 captureError block**: The file had been edited concurrently by another agent (likely IF-3) which added a `require()`-style call to `captureError` for Sentry reporting. I preserved the intent (reporting the misconfig to Sentry) but converted the `require()` to a clean ES import to fix a lint error it introduced. The throw at boot is still the authoritative signal.
- **No Zod validation added to S-3/S-4/S-5/S-6/S-7**: The audit's S-14 recommends Zod validation for 6 routes (the ones I just touched + onboarding). S-14 was explicitly OUT of scope for IF-2 (the task only asked for tenant-bypass fixes + secret hardening + Math.random). I limited the Zod work to `onboarding` because the audit specifically called it out as part of S-8. S-14 should be a follow-up task.

## Files NOT modified (intentional)
- `src/lib/auth.ts` — already had the fail-closed-at-boot pattern for `NEXTAUTH_SECRET` (lines 25-30). No change needed.
- `src/middleware.ts` — already had the fail-closed pattern for `AUTH_SECRET` (lines 13-21). No change needed.
- `src/app/api/webhooks/whatsapp/route.ts` POST and `src/app/api/webhooks/meta/route.ts` POST — these already use `verifyMetaSignature` (HMAC-SHA256 over raw body with `META_APP_SECRET`) and already had the fail-closed-at-prod pattern (lines 96-110 in whatsapp, 66-80 in meta). I only touched the GET handshake (which used the hardcoded `WA_VERIFY_TOKEN`/`META_VERIFY_TOKEN` fallback).
- All other `Math.random()` usages found in `src/` (wallet/route.ts:583, payments/local/route.ts:283, novedades.service.ts:126, local-payments.ts:200/315/575, 99envios.ts:200, dropi.ts:270, aveonline.ts:198, sidebar.tsx:611) — none are security-sensitive (order numbers, guide IDs, UI placeholders). S-13 was scoped specifically to TOTP backup codes per the audit. A follow-up task could sweep the rest.

## Hand-off notes for next agent
- The `webhook-secrets.ts` helper is the single source of truth for the fail-closed secret pattern. Any new webhook that needs a shared secret should add a resolver there rather than inlining `process.env.X || 'default'`.
- The 9 tenant-bypass routes now follow the SAME pattern: extract `tenantId` → 400 if missing → `requireTenantAccess(tenantId)` → `if (error) return error` → rest of handler. If you add a new tenant-scoped route, follow that pattern. A lint rule / codemod could enforce this.
- S-14 (Zod validation for the 6 routes) is still open. The `wallet/route.ts:41-80` schema is the reference pattern.
- S-15 (rate-limit in-memory Map fails multi-instance) is still open — needs `@upstash/ratelimit` or Redis-backed limiter.
- S-17 (CSRF bypass when Origin header absent) is still open.
- S-18/S-19/S-20 (TOTP per-code salt, decrypt fail-closed, console.warn → logger) are still open.
- Multi-tenant isolation tests (audit recommendation #7, 1 day) are still missing — the 9 bypass fixes have no regression test yet.
