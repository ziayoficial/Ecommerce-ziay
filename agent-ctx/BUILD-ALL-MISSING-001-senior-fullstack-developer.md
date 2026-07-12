# BUILD-ALL-MISSING-001 — Senior Full-Stack Developer

## Task
Create 16+ missing features across 5 groups: Ads Platform Adapters, Logger + Security + Sentry, Health endpoints, Missing API routes, Infra files.

## Outcome
**24 files created, 0 modifications to existing code.**

### Verification
- `npx tsc --noEmit` — clean for all new files (2 pre-existing errors in `e2e/api.spec.ts` and `playwright.config.ts`, verified via git stash to predate this task).
- `bun run lint` — 0 errors, 0 warnings.
- Dev server (Next.js 16.1.3 Turbopack) healthy after adding `instrumentation.ts` + Sentry configs.

### Files created

**GROUP 1 — Ads Platform Adapters (4):**
- `src/lib/adapters/ad-platform-adapter.ts` — interface (CampaignPerformance, AdPerformance, AdPlatformAdapter)
- `src/lib/adapters/google-ads.ts` — GoogleAdsAdapter (GAQL, cost_micros/1M)
- `src/lib/adapters/tiktok-ads.ts` — TikTokAdsAdapter (v1.3 report/integrated/get, paginated)
- `src/lib/adapters/ads-registry.ts` — getAdPlatformAdapter(platform, tenantId) + isAdPlatform guard

**GROUP 2 — Logger + Security + Sentry (6):**
- `src/lib/logger.ts` — pino with redaction + isoTime + pretty in dev, getLogger(component)
- `src/lib/middleware/security-headers.ts` — addSecurityHeaders (X-Frame, HSTS, CSP for JSON)
- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` — lazy Sentry.init only if SENTRY_DSN
- `instrumentation.ts` — register() dynamically imports sentry.{server,edge}.config per runtime

**GROUP 3 — Health endpoints (2):**
- `src/app/api/health/ready/route.ts` — DB SELECT 1 → 200/503
- `src/app/api/health/live/route.ts` — 200 {status:'alive', timestamp}

**GROUP 4 — Missing API routes (9):**
- `src/app/api/ads/import/route.ts` — POST imports ad spend from Google/TikTok, upserts AdSpend
- `src/app/api/buyer-behavior/route.ts` — GET+POST, upserts BuyerBehavior + BehaviorAlert if high_risk/blacklist
- `src/app/api/product-enrichment/route.ts` — GET+POST, calls VLM (enrichProductImage) → upsert ProductEnrichment
- `src/app/api/remarketing/route.ts` — GET+POST+PATCH, actions: create_campaign/schedule/auto_generate/toggle_active/mark_message
- `src/app/api/guide-movements/route.ts` — GET+POST, creates movement + best-effort Shipment.estado update
- `src/app/api/payments/create-link/route.ts` — POST uses getPaymentAdapter().createPaymentLink, updates Order
- `src/app/api/public/tenants/route.ts` — GET (NO AUTH) active tenants directory
- `src/app/api/public/catalog/route.ts` — GET ?slug (NO AUTH) tenant + products for SSR
- `src/app/api/trafficker/route.ts` — GET+POST, actions: register/create_campaign/register_sale/confirm_sale (atomic wallet credit)/fail_sale/withdraw (pending_2fa)

**GROUP 5 — Infra files (3):**
- `.env.example` — full env template (DB, Auth, LLM, Ecommerce, Logistics, Payments, Webhooks, Ads, Monitoring, Chat)
- `scripts/backup.sh` — sqlite3 .backup → gzip → 30-day retention
- `scripts/restore.sh` — snapshot current DB, gunzip backup into place

### Dependencies installed
- `pino` 10.3.1 + `pino-pretty` 13.1.3
- `@sentry/nextjs` 10.65.0

### Design decisions
- Ads adapter credentials: read from env (GOOGLE_ADS_*, TIKTOK_ACCESS_TOKEN) with constructor override. Multi-tenant per-tenant creds would need a Tenant schema extension.
- Ads import: stores aggregated range metrics with date=dateStart (simplification; per-day would require adapter interface change).
- Sentry: lazy-initialized only when SENTRY_DSN is set — dev/local works with zero config.
- Trafficker confirm_sale: atomic Prisma transaction (sale.status + TraffickerTransaction inbound + walletBalance update).
- Trafficker withdraw: creates WithdrawalRequest (pending_2fa) + TraffickerTransaction (outbound, pending). Funds NOT deducted until TOTP verified via separate 2FA endpoint.
- All new API routes use existing `requireAuth` / `requireTenantAccess` from `@/lib/auth-helpers` and `rateLimit` from `@/lib/middleware/rate-limit`.
- Public routes (tenants, catalog) are rate-limited even when unauthenticated, to prevent abuse.

### What's still missing (out of scope)
- Per-day ads import (requires adapter interface extension)
- Multi-tenant ad platform credentials (requires Tenant schema extension)
- TOTP verification endpoint to complete withdrawals
