# Task IF-3 — full-stack-developer (env-og-fixer)

**Date:** 2026-07-18
**Scope:** 3 audit fixes from `AUDITORIA-FULL-SECURITY-CODE-TEST.md` and `AUDITORIA-FULL-UX-SEO-DOCS-DEPLOY.md`:
1. **S-10** — `ENCRYPTION_KEY` TOTP fallback insecure in production
2. **DOC-1** — `.env.example` missing (referenced by README/CONTRIBUTING/SECURITY.md)
3. **SEO-3** — OG image is SVG (not supported by social platforms)

---

## FIX S-10 — ENCRYPTION_KEY fail-closed in production

**File:** `src/lib/totp.ts` (lines 19–59)

**Pre-existing state:** A prior agent (IF-2, per the in-code comment) had already
applied the core fail-closed pattern — throw at module-load in production when
`ENCRYPTION_KEY` is missing; `console.warn` in dev; fall back to the public
literal only outside production.

**What this task added (incremental hardening — parity with `secret-encryption.ts`):**
- Wrapped the production throw in a `try { require('@/lib/capture-error').captureError(err, {...}) } catch {}`
  block so the misconfiguration is forwarded to Sentry + the structured pino
  logger (matching the pattern in `src/lib/crypto/secret-encryption.ts:114-122`).
- The `require()` is lazy (not a top-level `import`) to avoid a circular
  dependency at module load time — `capture-error.ts` imports the logger which
  imports env-aware modules which could transitively import `totp.ts`.
- Expanded the dev-mode `console.warn` message to include the `openssl rand
  -hex 32` generation hint (was previously just "set this env var before
  deploying to production" with no command).
- Expanded the doc-comment block to reference both `auth.ts:25-30`
  (NEXTAUTH_SECRET pattern) and `crypto/secret-encryption.ts` (R-9 fail-closed
  gate) so future readers see the full provenance.
- **Backward-compat preserved:** the key derivation stays
  `Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32), 'utf8')` so existing
  TOTP secrets in the DB (encrypted with the legacy UTF-8 padded key) remain
  decryptable. Switching to the hex-decode path in `secret-encryption.ts`
  would break decryption for already-stored rows. Documented this constraint
  in the comment block.

**Did NOT do (out of scope):** Did NOT extract a shared `getEncryptionKey()`
helper into `secret-encryption.ts`. The two modules use different key
derivation paths (UTF-8 padded vs hex-or-UTF-8) for backward-compat reasons.
A shared helper would either (a) break TOTP decryption of existing rows, or
(b) need a "mode" flag that defeats the dedup goal. Leaving them separate
with a doc cross-reference is the correct trade-off.

---

## FIX DOC-1 — `.env.example` created

**File:** `/home/z/my-project/.env.example` (new, 313 lines)

**Method:**
1. Ran `grep -rohP "process\.env\.[A-Z_]+" src/ scripts/ prisma/ next.config.ts sentry.*.config.ts | sort -u`
   → 124 unique env-var references.
2. Inspected `prisma/schema.prisma` for `env()` calls → `DATABASE_URL` (not
   referenced via `process.env` so missed by grep).
3. Inspected existing `.env` to confirm the SQLite dev default for `DATABASE_URL`.
4. Cross-referenced the audit reports + the task description's example
   template to make sure OAuth provider placeholders + the `NEXTAUTH_URL`
   convention (used by NextAuth but not directly `process.env`-read in src)
   were included.

**Result:** 128 active env-var entries + 7 commented-out optional ones
(NEXT_RUNTIME + 6 OAuth/FB-Pixel placeholders for providers not yet wired) =
**135 total env vars documented**, grouped into 14 categories:

| # | Category | Var count (approx) |
|---|---|---|
| 1 | Core (NODE_ENV, NEXTAUTH_*, ENCRYPTION_KEY, DATABASE_URL, …) | 9 |
| 2 | CORS / Cache / Rate Limit | 4 |
| 3 | Auth (OAuth providers — commented out) | 6 (commented) |
| 4 | Chat / WebSocket Mini-Service | 2 |
| 5 | Payment Gateways (MP, Stripe, WOMPI, PayU) | ~25 |
| 6 | Local Payment Methods (PSE, PIX, SPEI, chargeback) | ~16 |
| 7 | WhatsApp / Meta | ~10 |
| 8 | NocoDB Integration | 2 |
| 9 | ERP / Fulfillment (Alegra, Dropi, 99Envios, Aveonline) | ~9 |
| 10 | E-commerce Platform Integrations (Shopify, Woo, Supabase) | ~9 |
| 11 | DIAN | 1 |
| 12 | Ad Platforms (Google Ads, TikTok, FB Pixel, GA, FX) | ~9 |
| 13 | Anti-Fraud (OFAC + 10 velocity/threshold vars) | ~11 |
| 14 | LLM Providers (OpenAI, xAI, Ollama) | ~6 |
| 15 | Monitoring / Observability (Sentry, Pino, Alertmanager) | ~8 |
| 16 | Build / Bundle Analyser | 1 |

**Required-in-prod vars marked with `# REQUIRED in production` (or similar):** 11
(NEXT_PUBLIC_BASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY,
DATABASE_URL, CORS_ALLOWED_ORIGINS [conditional], REDIS_URL [conditional],
CRON_SECRET, WA_VERIFY_TOKEN, META_VERIFY_TOKEN, NOCODB_WEBHOOK_SECRET,
META_APP_SECRET [conditional], SENTRY_DSN [conditional]).

**No real secret values** — every var is either empty (`VAR=`) or set to a
clearly-marked dev default (`DATABASE_URL=file:./db/custom.db`,
`PAYU_TEST_MODE=true`, `LOG_LEVEL=info`, …).

**Header block** documents:
- How to use the file (`cp .env.example .env`)
- The `openssl rand -base64 32` and `openssl rand -hex 32` commands for the
  two main secrets
- The convention for the `# REQUIRED in production` / `# Optional` / `# Dev only`
  tags
- A reminder to never commit the real `.env`

---

## FIX SEO-3 — Dynamic PNG OG image route

**New file:** `src/app/og/route.tsx` (173 lines)
**Modified files:**
- `src/app/layout.tsx` (lines 62–91) — `openGraph.images[0].url` and
  `twitter.images[0]` changed from `/og-default.svg` to `/og`, with
  `type: "image/png"` added to the OG image entry.
- `src/middleware.ts` (line 157) — added `'/og'` to `PUBLIC_PATTERNS` so the
  route is reachable by social crawlers (no session cookie). Without this,
  the auth middleware was returning a 307 redirect to `/login?callbackUrl=%2Fog`,
  which made the OG card appear broken to Twitter/Facebook/LinkedIn/Slack.

**Implementation details:**
- Uses Next.js 16's built-in `next/og` `ImageResponse` (re-exports
  `@vercel/og` which is bundled inside `next` — verified via
  `node_modules/next/og.js` and `node_modules/next/og.d.ts`).
- `export const runtime = 'edge'` → runs on the Edge runtime (close to user,
  cached at the CDN).
- `export const revalidate = 3600` → ISR, regenerates at most once per hour.
- `export const size = { width: 1200, height: 630 }` → canonical OG image
  size for Twitter (`summary_large_image`) + Facebook.
- `export const contentType = 'image/png'` → advertises PNG to crawlers.
- Route handler signature: `export async function GET(req: NextRequest):
  Promise<ImageResponse>` (proper Next.js route handler — first attempt used
  a default-export function which failed tsc with
  `RouteHandlerConfig<"/og"> has no properties in common`).
- **Dynamic per-page overrides:** accepts `?title=` and `?subtitle=` query
  params so product / blog / tenant pages can request a branded PNG with
  contextual copy (`/og?title=Mi%20Producto`).
- Design matches the brand palette already in use across the app:
  - Background `#0a0f0d` (dark theme body color)
  - Accent `#10b981` (emerald-500, ZIAY brand color — same as `og-default.svg`)
  - Off-white `#e8f0ec` for secondary text
  - Radial gradients for depth (mirrors the SVG's flat dark background but
    adds visual interest)
  - Decorative emerald-30% border ring (1:1 port of the SVG's
    `stroke="#10b981" opacity="0.3"` ring)
  - Footer chips: LATAM, WhatsApp, Messenger, Instagram, IA (positioning the
    multi-channel + IA value prop)
- The legacy `/public/og-default.svg` is kept on disk for backward compat
  with any social-graph crawlers that may have cached the old URL.

**Verification:**
```
$ curl -s -o /tmp/og.png -w "HTTP %{http_code}\nCT: %{content_type}\nSize: %{size_download}\n" http://localhost:3000/og
HTTP 200
CT: image/png
Size: 147611 bytes

$ file /tmp/og.png
PNG image data, 1200 x 630, 8-bit/color RGBA, non-interlaced

$ curl -s "http://localhost:3000/og?title=Test&subtitle=Hello" -o /tmp/og2.png -w "HTTP %{http_code} | CT: %{content_type} | Size: %{size_download}\n"
HTTP 200 | CT: image/png | Size: 135508
PNG image data, 1200 x 630, 8-bit/color RGBA, non-interlaced
```

Dev server log:
```
○ Compiling /og ...
 GET /og 200 in 7.3s (proxy.ts: 3ms)
 GET /og?title=Test&subtitle=Hello 200 in 736ms (proxy.ts: 3ms)
```

---

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit 2>&1 \| grep -c "error TS"` | **0** |
| `bun run lint 2>&1 \| tail -3` | **0 errors, 38 warnings** (all pre-existing in scripts/tests/legacy adapters — none in my modified files) |
| `test -f .env.example && echo "exists"` | `.env.example exists (313 lines, 128 active vars, 7 commented vars)` |
| `curl http://localhost:3000/og` | **HTTP 200, Content-Type: image/png, 147 KB, valid 1200×630 PNG** |
| `/og` reachable without auth | ✅ (after adding `/og` to `PUBLIC_PATTERNS` in `src/middleware.ts`) |
| `layout.tsx` OG images use `/og` | ✅ (both `openGraph.images[0].url` and `twitter.images[0]`) |
| `totp.ts` throws in prod if `ENCRYPTION_KEY` missing | ✅ (verified by reading the code — `process.env.NODE_ENV === 'production'` gate + `throw err`) |
| `totp.ts` warns in dev if `ENCRYPTION_KEY` missing | ✅ (`console.warn` with `openssl rand -hex 32` hint) |
| `totp.ts` captureError parity with `secret-encryption.ts` | ✅ (lazy `require('@/lib/capture-error').captureError(...)`) |

---

## Files changed

| File | Change |
|---|---|
| `src/lib/totp.ts` | Added `captureError` to production throw + expanded doc-comment + dev warning hint. |
| `.env.example` | NEW — 313 lines, 135 env vars (128 active + 7 commented), grouped by 14 categories. |
| `src/app/og/route.tsx` | NEW — Edge runtime OG image route returning 1200×630 PNG via `next/og` `ImageResponse`. |
| `src/app/layout.tsx` | `openGraph.images[0].url` and `twitter.images[0]` → `/og` (with `type: "image/png"`). |
| `src/middleware.ts` | Added `'/og'` to `PUBLIC_PATTERNS` so social crawlers can fetch the OG image without a session. |

---

## Notes for future agents

1. **Don't refactor `totp.ts` to share `getEncryptionKey()` with
   `secret-encryption.ts`** — the two modules intentionally use different key
   derivation paths (UTF-8 padded vs hex-or-UTF-8) for backward-compat with
   stored TOTP secrets. A shared helper would either break decryption or need
   a mode flag that defeats the dedup. The doc-comment in `totp.ts` explains
   this.

2. **The `.env.example` should be regenerated** whenever a new env var is
   added to `src/` or `scripts/`. The grep command is:
   `grep -rohP "process\.env\.[A-Z_]+" src/ scripts/ prisma/ next.config.ts sentry.*.config.ts | sort -u`
   Don't forget to also check `prisma/schema.prisma` for `env()` calls.

3. **The OG route supports `?title=` and `?subtitle=`** — per-page metadata
   can pass these to get a contextual branded PNG. To wire this up on a
   product page, add to the page's `generateMetadata`:
   ```ts
   openGraph: { images: [`/og?title=${encodeURIComponent(product.name)}`] }
   ```
