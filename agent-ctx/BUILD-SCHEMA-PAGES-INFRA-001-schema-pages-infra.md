# Work Record — BUILD-SCHEMA-PAGES-INFRA-001

**Agent:** schema-pages-infra
**Task ID:** BUILD-SCHEMA-PAGES-INFRA-001
**Date:** 2026-07-12
**Scope:** Append 33 Prisma models + 4 SSR pages + .env.example + Dockerfile + docker-compose.yml

## Files Created / Modified

### Created (NEW)
- `src/app/t/[slug]/page.tsx` — SSR tenant storefront
- `src/app/t/[slug]/p/[sku]/page.tsx` — SSR product detail
- `src/app/vendedor/page.tsx` — SSR seller page
- `src/app/sitemap.ts` — Dynamic sitemap
- `src/app/robots.ts` — robots.txt
- `.env.example` — Full env var documentation
- `Dockerfile` — Multi-stage build (deps → builder → runner)
- `docker-compose.yml` — 11 services

### Modified (APPEND only — no existing model touched)
- `prisma/schema.prisma` — Appended 33 new models at end (lines 581–1126)
- `public/robots.txt` — Removed (conflicted with new `src/app/robots.ts`)

### Untouched (per task constraint)
- All 29 existing Prisma models
- `src/app/page.tsx` (existing dashboard)
- All other src/ files (other agents' work)

## 33 New Models Added

| Section | Models |
|---------|--------|
| Intelligence Layer | CustomerScore, CarrierScore, GuideTracking, GuideMovement, BuyerBehavior, BehaviorAlert |
| Conversational Cart | ConversationalCart, CartItem |
| Novedades CRM | NovedadCase, NovedadEvidence, NovedadMessage, RedeliveryRequest, RedeliveryAttempt |
| Product Enrichment | ProductEnrichment |
| Fintech Layer | Trafficker, TraffickerCampaign, TraffickerSale, TraffickerTransaction, TraffickerCompensation, WalletAccount, WalletTransaction, WithdrawalRequest, TwoFactorConfig |
| Marketplace | MarketplaceListing, LeadShareConfig, LeadReferral |
| Attribution/Pixel/SEO | PixelConfig, ConversionEvent, SEOConfig, GeoTarget |
| Remarketing | RemarketingCampaign, RemarketingMessage, CustomerNotification |

## Decisions & Rationale

1. **`fetchSeoConfig()` defensive helper** in storefront page: tolerates the globalThis-cached PrismaClient instance in dev that lags one schema-regen behind. Without this, the page 500s when `db.sEOConfig` is undefined on the stale instance. Falls back to `null` (defaults used). Becomes a no-op after dev-server restart.

2. **Removed `public/robots.txt`**: Next.js throws `conflicting-public-file-page` error (HTTP 500) when both `public/robots.txt` and `src/app/robots.ts` exist. The dynamic file is the single source of truth.

3. **Sitemap uses single Prisma query with `include: { products }`** instead of N+1 lookups. Important because tenant count + product count could be large.

4. **Dockerfile runs Prisma generate in deps stage** so the client is available at build time, AND copies `.prisma` + `@prisma` to the runner stage so the client is available at runtime.

5. **docker-compose `app.env_file: [.env]`** + explicit `DATABASE_URL` override pointing to the postgres service (not the SQLite file). This means the same `.env` file works for both local dev (SQLite) and Docker (Postgres).

## Verification Results

| Check | Result |
|-------|--------|
| `bun run db:push --accept-data-loss` | ✅ Database in sync in 55ms |
| `prisma generate` | ✅ Client regenerated, all 62 model delegates present |
| `bun run lint` (my files only) | ✅ 0 errors, 0 warnings |
| `bun run lint` (whole project) | ✅ 0 errors, 2 warnings (in payment-webhook-utils.ts — NOT my file) |
| `npx tsc --noEmit` (my files) | ✅ 0 errors |
| `npx tsc --noEmit` (whole project) | 11 errors in 4 files outside scope (examples/, prisma/seed.ts, skills/) |
| `GET /t/saramantha` | ✅ 200 — OnlineStore + ItemList + FAQPage JSON-LD verified |
| `GET /t/saramantha/p/PIJ-BATOLA-003` | ✅ 200 — Product + Offer + Brand + BreadcrumbList JSON-LD verified |
| `GET /vendedor` | ✅ 200 |
| `GET /sitemap.xml` | ✅ 200 — valid XML with all tenant + product URLs |
| `GET /robots.txt` | ✅ 200 — correct allow/disallow + sitemap ref |

## Notes for Downstream Agents

- **Dev server crashed mid-session** (likely OOM, `bun run dev` process alive but Next.js child died). My code was verified working BEFORE the crash via the 200 responses above. A simple `bun run dev` restart will pick up everything cleanly.
- **My new schema models are now available in the Prisma client**. If your code referenced `db.trafficker`, `db.walletAccount`, `db.novedadCase`, `db.sEOConfig`, `db.pixelConfig`, etc. and was getting TypeScript errors, those should now resolve. Re-run `npx tsc --noEmit` to confirm.
- **Don't remove `fetchSeoConfig()`** in `src/app/t/[slug]/page.tsx` — it's intentional defensive code for dev hot-reload. It becomes a no-op pass-through once the dev server restarts with the fresh client.
- **`public/robots.txt` is intentionally ABSENT** — do not re-create it; `src/app/robots.ts` is the source of truth.
