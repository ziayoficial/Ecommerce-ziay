# IF-1 · full-stack-developer (p0-blockers)

**Task:** Fix 3 CRITICAL P0 issues that made the ZIAY site broken/inaccessible
- **P0-1** — Dashboard `/` broken: `TypeError: NAV_ITEMS.find is not a function`
- **SEO-1** — `/robots.txt` returns HTTP 500 (public/robots.txt vs src/app/robots.ts conflict)
- **SEO-2** — `/og-default.svg`, `/icon.svg`, `/manifest.json`, `/sw.js` redirect 307 → /login

## Context loaded
- `worklog.md` (last 500 lines) — reviewed recent agent activity (I2-R3 anti-fraud, I2-R8/R11/R12 DIAN/refund, I2-R9/R10 crypto/RLS, I3-P0/P1 fixers).
- `public/presentaciones/AUDITORIA-FULL-UX-SEO-DOCS-DEPLOY.md` — read full audit; located exact error trace + recommended fixes (lines 49, 56, 664-666, 686-688).

## Work Log

### FIX P0-1 — Dashboard NAV_ITEMS TypeError
**Root cause:** `src/app/page.tsx` (Server Component) imported `NAV_ITEMS` from
`src/components/dashboard/sidebar.tsx` (`'use client'` module). Turbopack RSC
returns a *client reference proxy* for non-serializable exports from client
modules, so `NAV_ITEMS.find(...)` threw `TypeError: NAV_ITEMS.find is not a
function`. The root ErrorBoundary caught it and rendered "Algo salió mal".

**Fix:**
1. Created `src/components/dashboard/nav-items.ts` — a plain TypeScript module
   (NO `'use client'` directive) that exports `ViewId`, `NavItem`, and
   `NAV_ITEMS`. The Lucide icons (`LayoutDashboard`, `MessagesSquare`, etc.)
   are imported directly here; they remain usable from any client component
   that imports this module. Includes a detailed header comment explaining
   the IF-1 / P0-1 backstory so future maintainers don't undo the fix.
2. Updated `src/components/dashboard/sidebar.tsx`:
   - Removed the inline `ViewId` type + `NAV_ITEMS` constant
   - Imported them from `./nav-items` instead
   - Re-exports them (`export type { ViewId }`, `export { NAV_ITEMS }`) for
     backwards compatibility with any callers that still import from
     `./sidebar` (defense-in-depth; new code should import from `./nav-items`)
3. Updated `src/app/page.tsx` — changed import from `@/components/dashboard/sidebar`
   to `@/components/dashboard/nav-items` (with explanatory comment).
4. Updated `src/components/dashboard/topbar.tsx` — changed import from
   `./sidebar` to `./nav-items`.
5. Updated `src/components/dashboard/dashboard-client.tsx` — split import:
   `Sidebar` (client component) stays from `./sidebar`; `NAV_ITEMS` + `ViewId`
   come from `./nav-items`.

### FIX SEO-1 — robots.txt HTTP 500
**Root cause:** Both `public/robots.txt` (static file) and `src/app/robots.ts`
(Metadata Route API) existed. Next.js couldn't decide which to serve → 500.

**Fix:**
1. Deleted `public/robots.txt` (160 bytes, static).
2. Kept `src/app/robots.ts` (Metadata Route API — more flexible, can read
   `NEXT_PUBLIC_BASE_URL` / `NEXT_PUBLIC_APP_URL` env vars).
3. Verified the existing `src/app/robots.ts` returns a valid
   `MetadataRoute.Robots` object with `rules` (User-Agent, Allow, Disallow),
   `sitemap`, and `host` fields.

### FIX SEO-2 — OG/icon/manifest/sw.js 307 → /login
**Root cause:** The middleware `PUBLIC_PATTERNS` array in `src/middleware.ts`
excluded `_next`, `favicon.ico`, `logo.svg`, `sitemap.xml`, `robots.txt`,
`presentaciones`, etc., but NOT `og-default.svg`, `icon.svg`, `manifest.json`,
`sw.js`. So these public assets hit the auth check, got 307-redirected to
`/login?callbackUrl=…`, and broke social sharing previews, PWA install,
Service Worker registration, and favicon.

**Fix:** Added the missing public asset paths to `PUBLIC_PATTERNS` in
`src/middleware.ts`:
- `/og-default.svg` (current OG image)
- `/og-default.png` (forward-compat for SEO-3 fix, if a PNG version is added)
- `/icon.svg`, `/icon.png`, `/apple-icon.png` (favicon variants)
- `/manifest.json` (PWA manifest)
- `/sw.js` (Service Worker)

Each entry has an inline comment explaining why it must be public. Also
verified `/api/webhooks/*` was already excluded (line 78 of middleware.ts).

## Verification Results

### TypeScript + Lint
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0 errors**
- `bun run lint` → **0 errors, 38 warnings** (all pre-existing, unrelated to
  these fixes — caught unused vars in `tests/unit/agent-rules.test.ts` etc.)

### Agent Browser verification (logged in as valentina@saramantha.co via demo button)

**Dashboard `/` renders correctly** (was: ErrorBoundary "Algo salió mal"):
- URL after login: `http://localhost:3000/` ✓
- `<h1>Resumen</h1>` SSR-rendered (proves `NAV_ITEMS.find(n => n.id === 'overview')?.label` works) ✓
- Full Sidebar visible with all 16 navigation items:
  Resumen, Mensajería, Catálogo Visual, Pedidos & Pagos, Kanban operativo,
  Orquestador, Costos de IA, Atribución de Pauta, Monetización, Wallet,
  Intelencia Logística, Marketplace, Novedades, Gobernanza, Catálogo e
  Integraciones, Configuración ✓
- Topbar with breadcrumb "Dashboard / Resumen", tenant selector, search
  (Cmd+K), notifications, theme toggle, user menu "VR · Valentina Restrepo
  · Admin · Saramantha" ✓
- Footer with "ZIAY · Comercio Conversacional + Atribución Inteligente" ✓
- Body text scan: 0 error markers ("Algo salió mal", "TypeError",
  "NAV_ITEMS.find is not a function"), 10 dashboard markers, 8 nav-item markers ✓
- Screenshot saved: `/tmp/dashboard-verified.png` (56821 bytes)

**SEO endpoints** (curl, before vs after):
- `robots.txt` → HTTP 200 (was 500) — content-type `text/plain`, 257 bytes,
  served from `src/app/robots.ts` with valid User-Agent/Allow/Disallow/Host/Sitemap rules ✓
- `og-default.svg` → HTTP 200 (was 307) — content-type `image/svg+xml` ✓
- `icon.svg` → HTTP 200 (was 307) — content-type `image/svg+xml` ✓
- `manifest.json` → HTTP 200 (was 307) — content-type `application/json` ✓
- `sw.js` → HTTP 200 (was 307) — content-type `application/javascript` ✓
- `/` (unauthenticated) → HTTP 307 → `/login?callbackUrl=%2F` (unchanged,
  correct behavior — middleware still protects the dashboard)

## Stage Summary

3 CRITICAL P0 fixes applied + verified:

1. **P0-1 (dashboard broken)** — `NAV_ITEMS` + `ViewId` moved to shared
   non-`'use client'` module `src/components/dashboard/nav-items.ts`. All 4
   callers (page.tsx, sidebar.tsx, topbar.tsx, dashboard-client.tsx) updated.
   Sidebar re-exports them for backwards compat. Dashboard renders, all 16
   views accessible.
2. **SEO-1 (robots.txt 500)** — Deleted `public/robots.txt`. The dynamic
   `src/app/robots.ts` (Metadata Route API) is now the sole source.
3. **SEO-2 (OG assets 307)** — Added `og-default.svg`, `og-default.png`,
   `icon.svg`, `icon.png`, `apple-icon.png`, `manifest.json`, `sw.js` to
   `PUBLIC_PATTERNS` in `src/middleware.ts`.

**Files created (1):** `src/components/dashboard/nav-items.ts`
**Files modified (4):** `src/app/page.tsx`, `src/components/dashboard/sidebar.tsx`,
`src/components/dashboard/topbar.tsx`, `src/components/dashboard/dashboard-client.tsx`,
`src/middleware.ts` (PUBLIC_PATTERNS array)
**Files deleted (1):** `public/robots.txt`

Verification:
- `npx tsc --noEmit` → 0 errors
- `bun run lint` → 0 errors (38 pre-existing warnings)
- Agent Browser: dashboard renders with all 16 nav items + topbar + footer
- curl: robots.txt 200, og-default.svg 200, icon.svg 200, manifest.json 200, sw.js 200

The 3 CRITICAL blockers are resolved. The site is now accessible.
