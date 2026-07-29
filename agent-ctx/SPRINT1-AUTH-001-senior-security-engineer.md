# SPRINT1-AUTH-001 — Senior Security Engineer · API Auth Lockdown + Error UI

## AGENT
- Role: Senior Security Engineer
- Task ID: SPRINT1-AUTH-001
- Scope: Lock down 14 still-unprotected private API routes + add App
  Router error / global-error / loading / not-found UI.

## CONTEXT READ
- Read last 30 lines of `/home/z/my-project/worklog.md`.
- Read prior `AUTH-001-senior-security-engineer.md` for the auth design
  (`requireAuth()` chosen over `requireTenantAccess()` to preserve the
  topbar tenant-switcher UX where admins read across all 5 tenants).
- Inspected `src/lib/auth-helpers.ts`: `requireAuth()` → 401 if no
  `session.user`; returns `{ session, error }`.
- Inspected `sentry.client.config.ts` + `instrumentation.ts`: Sentry
  is conditionally initialized on the client and always on the server.

## PART 1 — API route auth lockdown (14 routes, 24 handlers)

Ran the task's discovery grep — found **28** route files without any of
`requireAuth | requireTenant | getToken`. Categorized:

### PUBLIC — left untouched (14 files, correct)
- `api/auth/[...nextauth]/route.ts`
- `api/webhooks/{meta,payu,whatsapp,mercadopago,stripe,wompi}/route.ts` (6)
- `api/health/{,uptime,ready,live}/route.ts` (4)
- `api/public/{catalog,tenants}/route.ts` (2)
- `api/route.ts`

### PRIVATE — added `requireAuth()` (14 files, 24 handlers)

| # | File | Handlers |
|---|------|----------|
| 1 | `api/orchestrate/route.ts` | POST |
| 2 | `api/channels/route.ts` | GET, POST, PATCH, DELETE |
| 3 | `api/tenants/route.ts` | GET |
| 4 | `api/conversations/[id]/route.ts` | GET, PATCH |
| 5 | `api/ads/[id]/route.ts` | PATCH |
| 6 | `api/catalog/send-to-chat/route.ts` | POST |
| 7 | `api/catalog/sync/route.ts` | POST |
| 8 | `api/agents/route.ts` | GET |
| 9 | `api/agents/[agentName]/route.ts` | POST, GET |
| 10 | `api/shipping/guide/route.ts` | POST |
| 11 | `api/shipping/quote/route.ts` | POST |
| 12 | `api/ai-reply/route.ts` | POST |
| 13 | `api/orders/[id]/route.ts` | PATCH |
| 14 | `api/payments/config/route.ts` | GET, PATCH |

### Pattern applied (uniform)
```ts
import { requireAuth } from '@/lib/auth-helpers'
// …
export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error
  // … existing code unchanged …
}
```
- Import added at the top of the file (after `next/server`).
- Auth check is the FIRST statement in each handler (before `try`, before
  `await params`, before `req.json()` / DB calls).
- For handlers wrapped in `try/catch`, the auth check sits OUTSIDE the
  `try` block — a 401 must not be re-caught as a 500.
- Existing logic, status codes, response shapes, and audit log writes
  left 100% intact.
- Dropped unused `NextRequest` import in `tenants/route.ts` (its `GET()`
  takes no args) to keep lint clean.
- Did NOT use `requireTenantAccess(tenantId)` anywhere — preserves the
  topbar tenant switcher UX (admins read across all 5 tenants). The
  helper remains available for future per-route write-gating.

## PART 2 — Error / loading / 404 UI (4 files)

### `src/app/error.tsx` (OVERWROTE existing Sentry version)
- Client component per App Router contract.
- `AlertTriangle` icon in `bg-destructive/10` + `ring-1 ring-destructive/20`
  rounded container, "Algo salió mal" heading, `error.message` +
  optional `error.digest` (ID) display, "Reintentar" outline button
  calling `reset()`.
- Logs to `console.error` (per task spec).
- Trade-off: prior version called `Sentry.captureException(error)` for
  client-side render errors; this version drops that. Server-side
  Sentry instrumentation still active via `instrumentation.ts`. To
  restore client-side Sentry capture, re-add `Sentry.captureException`
  in the `useEffect`.

### `src/app/global-error.tsx` (NEW)
- Catches errors that escape `error.tsx` (e.g. errors in `layout.tsx`).
- Renders its own `<html>` + `<body>` (required by Next.js for
  global-error).
- Uses inline styles (no Tailwind) so it works even when global CSS
  fails to load.
- Dark emerald theme (`#0a0f0d` background, `#e8f0ec` text) matches the
  login page brand panel.
- "⚠️" emoji + "Error crítico del sistema" heading + "Reintentar" button.

### `src/app/loading.tsx` (NEW)
- App Router auto-streams this while any route segment's RSC payload
  is in flight.
- Dashboard-shaped skeleton: 64-unit sidebar with 10 nav skeletons,
  topbar skeleton, 4-card KPI grid skeleton, one large content card
  skeleton.
- Uses shadcn `Skeleton` component.
- Hidden sidebar on mobile (`hidden md:flex`) matches the dashboard's
  responsive layout.

### `src/app/not-found.tsx` (NEW)
- Renders for any unmatched URL under `/`.
- Big "404" in `text-primary`, "Página no encontrada" heading,
  explanation text, "Ir al inicio" outline button linking to `/` with
  a `Home` icon.

## VERIFICATION
- `bun run lint` → **0 errors, 0 warnings** ✅
- `npx tsc --noEmit` → **0 errors** ✅
- Dev server: `Ready in 92ms`, no errors in `dev.log` ✅

### Auth coverage audit (final)
- Routes with `requireAuth`: **27** (13 prior + 14 new)
- Routes with `requireTenant` (other agents, unchanged): **11**
- Routes with any auth guard: **38 / 52** (24 prior + 14 new)
- Routes with no auth (all public, by design): **14 / 52**
  - 1 NextAuth, 6 webhooks, 4 health probes, 2 public catalog/tenants,
    1 root hello
- All 52 API routes accounted for.

## FILE INVENTORY
- MODIFIED (14): all files in the table above.
- NEW (3): `src/app/global-error.tsx`, `src/app/loading.tsx`,
  `src/app/not-found.tsx`.
- OVERWRITTEN (1): `src/app/error.tsx` (replaced prior
  Sentry-instrumented version with task spec's `console.error` version).

## KNOWN LIMITATIONS / FOLLOW-UPS

1. **Tenant-scoped data filtering not enforced**: `requireAuth` blocks
   unauthenticated access (the #1 production blocker), but a logged-in
   tenant-A admin can still technically call
   `GET /api/orders?tenantId=ten-B` and get back tenant-B's orders
   (the underlying Prisma queries don't filter by `session.user.tenantId`).
   Defense-in-depth for v2: either (a) swap `requireAuth()` for
   `requireTenantAccess(tenantId)` on tenant-scoped routes (breaks the
   topbar switcher — needs UX rework), or (b) add a Prisma client
   extension that auto-filters by session tenantId.

2. **Client-side Sentry capture dropped**: `error.tsx` no longer calls
   `Sentry.captureException`. Server-side instrumentation still active.
   To restore client render-error capture, re-add the call in
   `error.tsx` + `global-error.tsx` `useEffect`s.

3. **`requireRole` helper unused**: defined in `auth-helpers.ts` but no
   route uses it yet. If role-gated routes are needed (e.g.
   `/api/monetization/*` restricted to `finance` role), wire
   `requireRole(['finance'])` at the top of those handlers.

4. **No 2FA / password reset / email verification**: out of scope for
   SPRINT1-AUTH-001. The `TwoFactorConfig` Prisma model + `totp.ts`
   helper exist for future wiring.

## STATUS: ✅ COMPLETE — production blocker resolved + 4 UI safety nets added
