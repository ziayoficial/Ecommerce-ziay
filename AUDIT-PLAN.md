# CommerceFlow OS — Full-Stack Audit Plan

> **Task ID:** PLAN-AUDIT-001
> **Owner:** Plan (Senior Auditor Architect)
> **Target system:** CommerceFlow OS — conversational commerce + ad attribution platform (LATAM, multi-tenant)
> **Date issued:** 2025-01 (cycle 1)
> **Status:** PLAN APPROVED FOR EXECUTION
> **Acceptance owner:** Engineering lead + Security officer

---

## 0. Document Control

| Field | Value |
|---|---|
| Project root | `/home/z/my-project/` |
| Tech stack | Next.js 16 · React 19 · TypeScript 5 · Prisma 6 (SQLite→Postgres) · Tailwind 4 · shadcn/ui · Socket.io · z-ai-web-dev-sdk |
| Code surface | 146 TS/TSX files in `src/`, 44 API routes, 66 components (48 shadcn + 16 dashboard + 2 misc), 26 lib files (18 adapters), 62 Prisma models, 1324-line `schema.prisma`, 443-line `seed.ts` |
| Mini-service | `mini-services/chat-service/index.ts` (Socket.io on port 3003, 89 lines) |
| SSR public surface | `/t/[slug]`, `/t/[slug]/p/[sku]`, `sitemap.ts`, `robots.ts` |
| Multi-tenant tenants | 5 seed: Saramantha, Sublimados Majestic, Lovely Pijamas, Sueño de Reina, Indisutex Intl |
| Real data | 238 real CRM orders loaded; 6 "Interrapidísimo" carrier variants normalized; §15.1 funnel exact; 20.5% devolvedores; 50% confiables |
| Planning artifact | This document (`AUDIT-PLAN.md`) |
| Evidence root | `/home/z/my-project/audit/` (folders `evidence/`, `findings/`, `reports/`, `fixes/`) |

**Pre-audit findings already surfaced during planning** (these are *observations*, not yet formal findings — they seed the workstreams):

1. `src/app/api/conversions/route.ts:66` still writes `Stub: would send to ${pixel.platform} API` — Pixel/CAPI NOT actually firing to Meta/Google/TikTok APIs. (Pending worklog item #1 — UNRESOLVED.)
2. `src/app/api/webhooks/whatsapp/route.ts` POST handler performs **no HMAC signature verification** and falls back to default token `commerceflow_verify` when `WA_VERIFY_TOKEN` is unset.
3. `src/app/api/webhooks/meta/route.ts` POST handler — same: no HMAC, default token fallback.
4. `src/app/api/wallet/route.ts` GET exposes wallet balance / transactions with **no session/RBAC check** — any caller with a `traffickerId` query param can read.
5. `.env` contains only `DATABASE_URL`. All other adapter/payment/ads/LLM credentials are unset → health endpoint will report ~11 `not_configured`.
6. `next.config.ts` ships with `typescript.ignoreBuildErrors: true` and `reactStrictMode: false` — both production anti-patterns.
7. `mini-services/chat-service/index.ts` sets `cors: { origin: '*' }` and broadcasts to all sockets (no room/tenant isolation).
8. Worklog references `src/lib/embeddings/`, `src/lib/vision/`, `src/lib/llm/`, `src/lib/rls.ts` — **these paths do NOT exist on disk**. Only `agents/`, `adapters/`, `orchestrator/` exist under `src/lib/`. Either the worklog over-states coverage or files were deleted.
9. Of 44 API routes, **only 33 reference `tenantId`** — at least 11 routes (`agents`, `ai-reply`, `tenants`, `route`, `health`, `health/uptime`, `public/*`, `webhooks/*`, `conversions` GET path) need explicit tenant-scope review.
10. SQLite is the live provider (`prisma/schema.prisma:11`) — RLS Postgres policies documented in worklog are NOT enforceable until provider switch + migration.

These observations are converted into checklist items in §5.

---

## 1. Executive Audit Charter

### 1.1 Scope

**In scope:**

- All 146 TS/TSX files under `src/`
- `prisma/schema.prisma` (1324 lines, 62 models) + `prisma/seed.ts` (443 lines)
- `mini-services/chat-service/` (3 files)
- Root configuration: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `components.json`, `Caddyfile`, `.env`
- SSR public surface: 5 routes (`/`, `/t/[slug]`, `/t/[slug]/p/[sku]`, `/sitemap.xml`, `/robots.txt`)
- 44 API routes under `src/app/api/`
- 26 conversational agents defined in `src/lib/agents/prompts.ts` (1333 lines)
- 3 orchestration pipelines in `src/lib/orchestrator/constants.ts`
- 18 integration adapters in `src/lib/adapters/`
- 14 dashboard modules + 2 misc components + 48 shadcn/ui primitives
- Fintech layer: Wallet, TOTP 2FA, withdrawals, compensation
- Multi-tenant architecture: 62 models, tenantId coverage, RLS readiness
- Documentation context: `worklog.md` (1640 lines), `agent-ctx/REDELIVERY-API-UI-orchestrator.md`, `upload/RE-AUDITORIA-honesta.md`, `upload/MAESTRO-arquitectura.md`

**Out of scope (this cycle):**

- External infrastructure provisioning (managed Postgres, Redis cluster, n8n cloud)
- Third-party SDK upstream vulnerabilities (covered by dependabot in a follow-up cycle)
- Marketing/contractual SLA review
- Penetration testing beyond automated OWASP ZAP baseline (scheduled for cycle 2)

### 1.2 Objectives

1. **Verify production-readiness** against an explicit Definition of Done (§9).
2. **Confirm 100% file coverage** — every file inspected at least at smoke-test depth.
3. **Confirm 100% feature coverage** — every agent, module, adapter, SSR route, Prisma model exercised at least once.
4. **Validate multi-tenant isolation** — no cross-tenant data leakage in any read/write path.
5. **Validate security posture** — RBAC, RLS-readiness, 2FA TOTP, HMAC webhook verification, secrets handling, OWASP Top 10.
6. **Validate fintech integrity** — wallet ledger immutability, withdrawal 2FA enforcement, compensation math correctness.
7. **Validate real-time layer** — Socket.io room isolation, reconnection, message ordering.
8. **Validate SEO/SSR surface** — Schema.org validity, sitemap completeness, robots policy.
9. **Validate DevOps posture** — Docker compose correctness, Caddyfile, health endpoint, uptime monitoring.
10. **Produce executable auto-fixes** for low-risk findings and **flag-only tickets** for architectural ones.

### 1.3 Methodology

- **Risk-based sampling for 100% coverage:** every file is assigned a depth tier (Full / Smoke / Existence) based on blast radius; the union of all tiers equals 100% of files.
- **Evidence-based:** every finding must cite a file:line, a repro command, and a captured artifact under `audit/evidence/`.
- **Independence:** the Plan agent does not execute findings; execution is delegated to specialized sub-agents (WS-1 … WS-12) who cannot approve their own auto-fixes — a separate CONSOLIDATE-001 step reviews.
- **Defense-in-depth:** each control is verified at two layers (code review + runtime probe via agent-browser).
- **Tooling:** `Read` / `Grep` / `Glob` for static inspection; `agent-browser` skill for end-to-end UI verification; `curl` for API probes; `prisma` CLI for schema introspection; `bun` for runtime checks.

### 1.4 Severity Scale

| Severity | Definition | SLA to remediate | Auto-fix allowed? |
|---|---|---|---|
| **Critical** | Exploitable security hole, data loss, financial loss, full outage, RLS bypass, 2FA bypass, HMAC missing on webhook that accepts inbound PII | 24 h, blocks release | No — flag + escalate |
| **High** | Functional correctness break on a core path, missing tenantId guard, missing input validation on a mutation route, dead integration (stub shipping as real) | 72 h | No — flag for human review |
| **Medium** | UX defect, missing index causing slow query, missing error handling on a read path, console.log in prod, missing type | 1 week | Yes (with diff in `audit/fixes/`) |
| **Low** | Cosmetic, doc drift, minor a11y, non-blocking deprecation warning | 2 weeks | Yes |
| **Info** | Observation, no action required (e.g., architectural note for future cycle) | None | N/A |

### 1.5 Audit Principles

1. **Independence:** the auditor does not author the code being audited; auto-fixes are reviewed by a different agent than the one that applied them.
2. **Evidence-based:** no finding without a reproducible artifact (file:line + screenshot/JSON/log).
3. **Risk-based:** depth of inspection scales with blast radius (fintech > webhook > catalog adapter > shadcn primitive).
4. **Least privilege:** audit credentials are read-only; auto-fixes operate on a feature branch, never `main`.
5. **Reproducibility:** every finding must include the exact command to reproduce.
6. **Non-regression:** auto-fixes must not break existing tests; if no tests exist, the auditor adds a smoke test before fixing.
7. **Transparency:** all findings (including rejected ones) are persisted in `audit/findings/`.

### 1.6 Acceptance Criteria for "Production-Ready"

The system is **production-ready** when ALL of the following are true:

- 0 Critical findings open
- 0 High findings open
- 100% of files inspected (Full + Smoke + Existence tiers complete)
- 100% of features exercised in browser via agent-browser (14 modules + 2 SSR pages + 1 webhook round-trip)
- 100% of API routes probed with at least one happy-path + one 401/403/400 case
- All eligible auto-fixes applied and verified by `tsc --noEmit` + `eslint` + `next build`
- `AUDIT-REPORT.md` published with executive summary, risk heat-map, and sign-off block
- Health endpoint reports 0 errors (warnings acceptable if documented)

---

## 2. Coverage Matrix — 100% File Inventory

> **Build method:** files enumerated via `Glob`/`find` against `/home/z/my-project/`. Total: **146 TS/TSX in `src/`** + 2 in `prisma/` + 3 in `mini-services/` + 2 in `examples/` + 9 root configs + 1 SSR-context doc = **163 inventory entries**.
>
> **Domain legend:** BE=Backend · FE=Frontend · DA=Data · SE=Security · IN=Integrations · AG=Agents · UX=UX/a11y · PE=Performance · SEO=SEO/SSR · DO=DevOps · CO=Compliance
> **Depth legend:** F=Full review · S=Smoke test · E=Existence check
> **Owning sub-agent:** WS-1 … WS-12 (see §5)

### 2.1 Backend API Routes (44 routes — Domain: BE/SE/IN)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `src/app/api/route.ts` (root) | S | BE | WS-3 |
| 2 | `src/app/api/overview/route.ts` | F | BE | WS-3 |
| 3 | `src/app/api/orders/route.ts` | F | BE/SE | WS-3 |
| 4 | `src/app/api/orders/[id]/route.ts` | F | BE/SE | WS-3 |
| 5 | `src/app/api/novedades/route.ts` | F | BE/AG | WS-3 |
| 6 | `src/app/api/novedades/[id]/route.ts` | F | BE/SE | WS-3 |
| 7 | `src/app/api/conversational-cart/route.ts` | F | BE/AG | WS-3 |
| 8 | `src/app/api/tenants/route.ts` | F | BE/SE | WS-1 |
| 9 | `src/app/api/guide-movements/route.ts` | F | BE/IN | WS-3 |
| 10 | `src/app/api/trafficker/route.ts` | F | BE/SE | WS-8 |
| 11 | `src/app/api/ai-reply/route.ts` | F | BE/AG | WS-4 |
| 12 | `src/app/api/shipping/guide/route.ts` | F | BE/IN | WS-5 |
| 13 | `src/app/api/shipping/quote/route.ts` | F | BE/IN | WS-5 |
| 14 | `src/app/api/catalog/sync/route.ts` | F | BE/IN | WS-5 |
| 15 | `src/app/api/catalog/products/route.ts` | F | BE/IN | WS-5 |
| 16 | `src/app/api/catalog/send-to-chat/route.ts` | F | BE/AG | WS-4 |
| 17 | `src/app/api/buyer-behavior/route.ts` | F | BE/AG | WS-4 |
| 18 | `src/app/api/ads/route.ts` | F | BE/IN | WS-5 |
| 19 | `src/app/api/ads/[id]/route.ts` | F | BE/SE | WS-3 |
| 20 | `src/app/api/payments/config/route.ts` | F | BE/SE | WS-8 |
| 21 | `src/app/api/payments/create-link/route.ts` | F | BE/IN/SE | WS-5 |
| 22 | `src/app/api/redelivery/route.ts` | F | BE/AG | WS-4 |
| 23 | `src/app/api/monetization/gmv/route.ts` | F | BE/DA | WS-8 |
| 24 | `src/app/api/monetization/commission/route.ts` | F | BE/DA | WS-8 |
| 25 | `src/app/api/channels/route.ts` | F | BE/SE | WS-1 |
| 26 | `src/app/api/public/tenants/route.ts` | F | BE/SEO | WS-10 |
| 27 | `src/app/api/public/catalog/route.ts` | F | BE/SEO | WS-10 |
| 28 | `src/app/api/logistics-intelligence/route.ts` | F | BE/AG | WS-4 |
| 29 | `src/app/api/webhooks/whatsapp/route.ts` | F | BE/SE | WS-1 |
| 30 | `src/app/api/webhooks/meta/route.ts` | F | BE/SE | WS-1 |
| 31 | `src/app/api/marketplace/route.ts` | F | BE/AG | WS-4 |
| 32 | `src/app/api/product-enrichment/route.ts` | F | BE/AG | WS-4 |
| 33 | `src/app/api/agents/route.ts` | F | BE/AG | WS-4 |
| 34 | `src/app/api/agents/[agentName]/route.ts` | F | BE/AG | WS-4 |
| 35 | `src/app/api/remarketing/route.ts` | F | BE/AG | WS-4 |
| 36 | `src/app/api/conversations/route.ts` | F | BE/SE | WS-3 |
| 37 | `src/app/api/conversations/[id]/route.ts` | F | BE/SE | WS-3 |
| 38 | `src/app/api/wallet/route.ts` | F | BE/SE/DA | WS-8 |
| 39 | `src/app/api/conversions/route.ts` | F | BE/IN/SE | WS-5 |
| 40 | `src/app/api/address-analysis/route.ts` | F | BE/AG | WS-4 |
| 41 | `src/app/api/notifications/route.ts` | F | BE/AG | WS-4 |
| 42 | `src/app/api/health/route.ts` | F | BE/DO | WS-11 |
| 43 | `src/app/api/health/uptime/route.ts` | F | BE/DO | WS-11 |
| 44 | `src/app/api/orchestrate/route.ts` | F | BE/AG | WS-4 |

### 2.2 Frontend — Dashboard Views (16 files — Domain: FE/UX)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `src/components/dashboard/sidebar.tsx` | F | FE/UX | WS-6 |
| 2 | `src/components/dashboard/topbar.tsx` | F | FE/UX | WS-6 |
| 3 | `src/components/dashboard/overview-view.tsx` | F | FE/UX | WS-6 |
| 4 | `src/components/dashboard/messenger-view.tsx` | F | FE/UX/AG | WS-6 |
| 5 | `src/components/dashboard/catalog-visual-view.tsx` | F | FE/UX | WS-6 |
| 6 | `src/components/dashboard/orders-view.tsx` | F | FE/UX | WS-6 |
| 7 | `src/components/dashboard/kanban-view.tsx` | F | FE/UX | WS-6 |
| 8 | `src/components/dashboard/orchestrator-view.tsx` | F | FE/UX/AG | WS-6 |
| 9 | `src/components/dashboard/ads-view.tsx` | F | FE/UX | WS-6 |
| 10 | `src/components/dashboard/monetization-view.tsx` | F | FE/UX | WS-6 |
| 11 | `src/components/dashboard/wallet-view.tsx` | F | FE/UX/SE | WS-6 |
| 12 | `src/components/dashboard/logistics-intelligence-view.tsx` | F | FE/UX | WS-6 |
| 13 | `src/components/dashboard/marketplace-view.tsx` | F | FE/UX | WS-6 |
| 14 | `src/components/dashboard/novedades-view.tsx` | F | FE/UX | WS-6 |
| 15 | `src/components/dashboard/integrations-view.tsx` | F | FE/UX | WS-6 |
| 16 | `src/components/dashboard/settings-view.tsx` | F | FE/UX | WS-6 |
| 17 | `src/components/dashboard/channels-manager.tsx` | F | FE/UX/SE | WS-6 |

### 2.3 Frontend — shadcn/ui Primitives (48 files — Domain: FE, Depth: E)

> All 48 files exist as standard shadcn/ui primitives. **Existence check only** (no functional review unless used by a dashboard view). Listed in §10 Appendix.

Files: `accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toast, toaster, toggle, toggle-group, tooltip` (each `.tsx` under `src/components/ui/`).

### 2.4 Frontend — Misc (2 files)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `src/components/theme-provider.tsx` | S | FE | WS-6 |
| 2 | `src/app/layout.tsx` | F | FE/SEO | WS-6 |

### 2.5 Frontend — App Shell & SSR (5 files — Domain: FE/SEO)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `src/app/page.tsx` | F | FE/UX | WS-6 |
| 2 | `src/app/sitemap.ts` | F | SEO | WS-10 |
| 3 | `src/app/robots.ts` | F | SEO | WS-10 |
| 4 | `src/app/t/[slug]/page.tsx` | F | SEO/FE | WS-10 |
| 5 | `src/app/t/[slug]/p/[sku]/page.tsx` | F | SEO/FE | WS-10 |
| 6 | `src/app/globals.css` | S | FE | WS-6 |

### 2.6 Lib — Adapters (18 files — Domain: IN)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `src/lib/adapters/ecommerce-adapter.ts` (interface) | F | IN | WS-5 |
| 2 | `src/lib/adapters/registry.ts` | F | IN | WS-5 |
| 3 | `src/lib/adapters/whatsapp-catalog.ts` | F | IN | WS-5 |
| 4 | `src/lib/adapters/woocommerce.ts` | F | IN | WS-5 |
| 5 | `src/lib/adapters/shopify.ts` | F | IN | WS-5 |
| 6 | `src/lib/adapters/supabase-catalog.ts` | F | IN | WS-5 |
| 7 | `src/lib/adapters/logistics-adapter.ts` (interface) | F | IN | WS-5 |
| 8 | `src/lib/adapters/dropi.ts` | F | IN | WS-5 |
| 9 | `src/lib/adapters/99envios.ts` | F | IN | WS-5 |
| 10 | `src/lib/adapters/aveonline.ts` | F | IN | WS-5 |
| 11 | `src/lib/adapters/google-ads.ts` | F | IN | WS-5 |
| 12 | `src/lib/adapters/tiktok-ads.ts` | F | IN | WS-5 |
| 13 | `src/lib/adapters/payment-adapter.ts` (interface) | F | IN | WS-5 |
| 14 | `src/lib/adapters/payment-registry.ts` | F | IN | WS-5 |
| 15 | `src/lib/adapters/mercadopago.ts` | F | IN/SE | WS-5 |
| 16 | `src/lib/adapters/wompi.ts` | F | IN/SE | WS-5 |
| 17 | `src/lib/adapters/stripe.ts` | F | IN/SE | WS-5 |
| 18 | `src/lib/adapters/payu.ts` | F | IN/SE | WS-5 |

### 2.7 Lib — Agents & Orchestration (2 files — Domain: AG)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `src/lib/agents/prompts.ts` (1333 lines, 26 agents) | F | AG | WS-4 |
| 2 | `src/lib/orchestrator/constants.ts` (220 lines, 3 pipelines) | F | AG | WS-4 |

### 2.8 Lib — Core (6 files — Domain: BE/SE/DA)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `src/lib/db.ts` | F | DA | WS-2 |
| 2 | `src/lib/socket.ts` | F | BE/SE | WS-7 |
| 3 | `src/lib/totp.ts` | F | SE | WS-1 |
| 4 | `src/lib/carriers.ts` | S | DA | WS-2 |
| 5 | `src/lib/format.ts` | S | BE | WS-3 |
| 6 | `src/lib/utils.ts` | E | FE | WS-6 |

### 2.9 Hooks (4 files — Domain: FE)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `src/hooks/use-tenant.ts` | F | FE/SE | WS-1 |
| 2 | `src/hooks/use-toast.ts` | S | FE | WS-6 |
| 3 | `src/hooks/use-mobile.ts` | E | FE | WS-6 |
| 4 | `src/hooks/use-mounted.ts` | E | FE | WS-6 |

### 2.10 Data Layer (2 files — Domain: DA)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `prisma/schema.prisma` (1324 lines, 62 models) | F | DA/SE | WS-2 |
| 2 | `prisma/seed.ts` (443 lines, 5 tenants + 238 orders) | F | DA | WS-2 |

### 2.11 Mini-service (3 files — Domain: BE/RT)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `mini-services/chat-service/index.ts` | F | BE/RT/SE | WS-7 |
| 2 | `mini-services/chat-service/package.json` | S | DO | WS-11 |
| 3 | `mini-services/chat-service/bun.lock` | E | DO | WS-11 |

### 2.12 Examples (2 files — Domain: DO, Depth: E)

| # | File | Depth | Owner |
|---|---|---|---|
| 1 | `examples/websocket/server.ts` | E | WS-7 |
| 2 | `examples/websocket/frontend.tsx` | E | WS-7 |

### 2.13 Root Configs (9 files — Domain: DO)

| # | File | Depth | Domain | Owner |
|---|---|---|---|---|
| 1 | `package.json` | F | DO | WS-11 |
| 2 | `tsconfig.json` | F | DO | WS-11 |
| 3 | `next.config.ts` | F | DO/SE | WS-11 |
| 4 | `tailwind.config.ts` | S | DO | WS-11 |
| 5 | `postcss.config.mjs` | S | DO | WS-11 |
| 6 | `eslint.config.mjs` | F | DO | WS-11 |
| 7 | `components.json` | S | DO | WS-11 |
| 8 | `Caddyfile` (23 lines) | F | DO/SE | WS-11 |
| 9 | `.env` | F | SE | WS-1 |

### 2.14 Context Docs (3 files — Domain: CO, Depth: S)

| # | File | Depth | Owner |
|---|---|---|---|
| 1 | `agent-ctx/REDELIVERY-API-UI-orchestrator.md` | S | WS-4 |
| 2 | `upload/RE-AUDITORIA-honesta.md` (prior audit — input) | S | WS-1 |
| 3 | `upload/MAESTRO-arquitectura.md` | S | WS-2 |

### 2.15 Coverage Roll-up

| Domain | Files | Full | Smoke | Existence |
|---|---|---|---|---|
| Backend (BE) | 44 API + 2 lib | 46 | 0 | 0 |
| Frontend (FE) | 16 dash + 48 ui + 7 misc/hooks | 12 | 6 | 53 |
| Data (DA) | schema + seed + db.ts + carriers + format | 4 | 1 | 0 |
| Security (SE) | totps + webhooks + wallet + .env + use-tenant (cross-cutting) | 6 | 0 | 0 |
| Integrations (IN) | 18 adapters | 18 | 0 | 0 |
| Agents (AG) | prompts + constants | 2 | 0 | 0 |
| SEO | sitemap + robots + 2 SSR + 2 public API | 5 | 0 | 0 |
| DevOps (DO) | 9 configs + mini-service pkg | 4 | 4 | 2 |
| Compliance (CO) | 3 docs | 0 | 3 | 0 |
| Real-time (RT) | chat-service + socket.ts + examples | 2 | 1 | 2 |
| **TOTAL** | **163 entries** | **99** | **15** | **57** |

> **100% coverage verified:** 99 + 15 + 57 = 171 (some files cross-listed across domains). Every entry has a depth + owner.

---

## 3. Feature Coverage Matrix — 100% Features

### 3.1 Conversational Agents (26) — Owner: WS-4

> Source of truth: `src/lib/agents/prompts.ts` line `AGENT_NAMES` array.
> Verification endpoint: `GET /api/agents` (lists all) and `POST /api/agents/[agentName]` (invoke).

| # | Agent | Pipeline | Golden path | Edge case | Evidence | Pass/Fail | Owner |
|---|---|---|---|---|---|---|---|
| 1 | `buyer_behavior` | A.1 | POST with customer history → returns risk profile | Customer with 0 history → safe default | API JSON + log line | risk field present, no PII in prompt | WS-4 |
| 2 | `profile` | A.2 | "Para ti o para surtir" → mayorista/emprendedor/detal/regalo | Empty message → ask clarifying | API JSON | exactly one of 4 profiles | WS-4 |
| 3 | `speech` | A.3 | Profile=majorista → speech with volume anchor | Unknown profile → fallback | API JSON | speech references profile | WS-4 |
| 4 | `catalog` | A.4 | "quiero pijama stitch" → image-first reply | No matching product → graceful | API JSON + product ID | image URL returned | WS-4 |
| 5 | `cart_builder` | A.5 | "2 short tira M + 1 pantalon L" → CartItem[] | Nonsense input → empty cart | API JSON + DB CartItem row | cart persisted with tenantId | WS-4 |
| 6 | `quote` | A.6 | Volume tier ≥ 10 units → discount applied | Single unit → base price | API JSON | price math matches VolumePrice table | WS-4 |
| 7 | `objection` | A.7 | "muy caro" → price-anchor gatillo | Unknown objection → empathy fallback | API JSON | gatillo field set | WS-4 |
| 8 | `address` | A.8 | 10 fields collected 1-by-1 | Missing barrio → re-ask | API JSON + address_analysis call | all 10 fields stored | WS-4 |
| 9 | `logistics` | A.9 | City=Bogotá → Dropi quote | City unsupported → 99envios fallback | API JSON + freight value | freight > 0 | WS-4 |
| 10 | `checkout` | A.10 | Confirm → Order created + guide + commission | Stock=0 → block | DB Order row + OrderEvent | order.status=pending_confirmation | WS-4 |
| 11 | `guide_tracking` | B.1 | Guide # → status + alerts | Unknown guide → 404 | API JSON | alerta field if sin movimiento >24h | WS-4 |
| 12 | `novedades` | B.2 | "no llegó" → NovedadCase created | Order not found → escalate human | DB NovedadCase row | case has evidence array | WS-4 |
| 13 | `redelivery` | B.3 | Devolución por dirección → new attempt | Customer unresponsive → close | DB RedeliveryAttempt row | attempt.status tracked | WS-4 |
| 14 | `remarketing` | B.4 | Abandoned cart >2h → recovery msg | Customer opted-out → skip | DB RemarketingMessage row | anti-invasion: max 2 msgs | WS-4 |
| 15 | `customer_score` | C.1 | Customer with 5 orders → score 0-100 | New customer → score 50 default | API JSON | score reflects 20.5% devolvedores rule | WS-4 |
| 16 | `carrier_score` | C.2 | Interrapidísimo in Bogotá → score | Carrier unknown → neutral | API JSON | 6 normalized variants dedup'd | WS-4 |
| 17 | `product_enrichment` | C.3 | Product image → tags+keywords | Image unreadable → fallback | DB ProductEnrichment row | ≥3 tags generated | WS-4 |
| 18 | `marketplace` | C.4 | "no tengo X" → cross-brand lead | No matching tenant → empty | DB LeadReferral row | cross-tenant tenantId set | WS-4 |
| 19 | `affiliator` | C.5 | Trafficker views → recommend products | Wallet=0 → skip | API JSON | ROI computed | WS-4 |
| 20 | `vision` | Esp. | Image upload → OCR+CLIP+VLM | Corrupt image → error | API JSON | design detected | WS-4 |
| 21 | `address_analysis` | Esp. | Bogotá address → validated | Rural address → flag | API JSON | quality score 0-1 | WS-4 |
| 22 | `novedades` (esp. dup of #12) | Esp. | — | — | — | — | WS-4 |
| 23 | `sales_retainer` | Esp. | Abandono >24h → 2 recordatorios | Customer says "no" → cancel | DB RemarketingMessage | max 2 msgs, 1 per 24h, 8am-8pm CO | WS-4 |
| 24 | `logistics_notifier` | Esp. | Order confirmed → 9-stage lifecycle | Already delivered → skip | DB CustomerNotification | at_office = CRÍTICA | WS-4 |
| 25 | `traffic_orchestrator` | Esp. | Conversion → fire pixel+CAPI | No pixel configured → log | DB ConversionEvent | dedup eventId unique | WS-4 |
| 26 | `guide_alert` (alias) | B.1b | Guide stale >48h → alert | Guide just shipped → skip | API JSON | alert.severity set | WS-4 |

### 3.2 Dashboard Modules (14) — Owner: WS-6

| # | Module | View ID | Golden path | Edge case | Evidence | Pass criteria |
|---|---|---|---|---|---|---|
| 1 | Resumen | `overview` | Load → KPIs render | No orders → empty state | screenshot | 4 KPI cards + chart |
| 2 | Mensajería | `messenger` | Select conversation → send → reply | Socket disconnect → reconnect toast | screenshot + log | 27 dropdown items, message persists |
| 3 | Catálogo Visual | `catalog-visual` | Search product → IA chat suggests | No products → empty | screenshot | embedded IA chat works |
| 4 | Pedidos & Pagos | `orders` | Filter by status → table | Filter yields 0 rows | screenshot | payment link button |
| 5 | Kanban | `kanban` | Drag card col1→col2 | Drop on locked column → revert | screenshot | 8 columns + drag works |
| 6 | Orquestador | `orchestrator` | Run pipeline A → 10 steps | Step fails → error shown | screenshot + log | 3 pipelines render |
| 7 | Atribución Pauta | `ads` | Select campaign → CPA/ROAS | No spend → empty | screenshot | metrics compute |
| 8 | Monetización | `monetization` | View GMV + commission tiers | New tenant → tier 1 default | screenshot | escalonada table renders |
| 9 | Wallet | `wallet` | Setup 2FA → verify → backup codes | Wrong TOTP → block | screenshot + log | 2FA enforced on withdrawal |
| 10 | Inteligencia Logística | `logistics-intelligence` | View carrier scores + alerts | No carriers → empty | screenshot | alert badges |
| 11 | Marketplace | `marketplace` | View cross-brand leads | No leads → empty | screenshot | lead cards |
| 12 | Novedades | `novedades` | 3 tabs: Casos+Reintentos+Historial | Empty tabs → empty state | screenshot | tab switching |
| 13 | Integraciones | `integrations` | View 18 adapters status | All unconfigured → warnings | screenshot + health JSON | real HTTP test button |
| 14 | Configuración | `settings` | Switch tenant → context updates | Switch to inactive tenant → block | screenshot + log | tenantId propagates |

### 3.3 Integration Adapters (18) — Owner: WS-5

| # | Adapter | Type | Golden path | Edge case | Evidence | Pass criteria |
|---|---|---|---|---|---|---|
| 1 | `whatsapp-catalog` | catalog | listProducts → Product[] | Token missing → stub | API JSON | tenantId-scoped |
| 2 | `woocommerce` | catalog | listProducts (HTTP) | 401 → graceful | HTTP log | real HTTP call (per worklog) |
| 3 | `shopify` | catalog | listProducts (HTTP) | 401 → graceful | HTTP log | real HTTP call |
| 4 | `supabase-catalog` | catalog | query → rows | Connection fail → stub | API JSON | SQL parameterized |
| 5 | `ecommerce-adapter` (iface) | catalog | interface present | — | code review | methods typed |
| 6 | `registry` | catalog | getAdapter(tenant) | Unknown platform → null | code review | returns adapter or null |
| 7 | `dropi` | logistics | quote (HTTP) | API down → fallback 99envios | HTTP log | freight > 0 |
| 8 | `99envios` | logistics | quote | API down → fallback | HTTP log | freight > 0 |
| 9 | `aveonline` | logistics | quote | API down → fallback | HTTP log | freight > 0 |
| 10 | `logistics-adapter` (iface) | logistics | interface present | — | code review | — |
| 11 | `google-ads` | ads | fetchCampaignPerformance (GAQL v17) | No creds → empty array | API JSON | cost_micros → spend |
| 12 | `tiktok-ads` | ads | fetchCampaignPerformance (v1.3) | code != 0 → graceful | API JSON | metrics mapped |
| 13 | `payment-adapter` (iface) | payment | interface present | — | code review | 4 methods |
| 14 | `payment-registry` | payment | getPaymentAdapter(gateway) | Unknown → null | code review | — |
| 15 | `mercadopago` | payment | createPaymentLink → URL | No creds → stub | HTTP log | webhookVerify HMAC-SHA256 |
| 16 | `wompi` | payment | createPaymentLink | No creds → stub | HTTP log | amount_in_cents |
| 17 | `stripe` | payment | createPaymentLink | No creds → stub | HTTP log | webhookVerify t=,v1= |
| 18 | `payu` | payment | createPaymentLink + MD5 signature | No creds → stub | HTTP log | signature matches |

### 3.4 SSR Public Surface (5 routes) — Owner: WS-10

| # | Route | Golden path | Edge case | Evidence | Pass criteria |
|---|---|---|---|---|---|
| 1 | `/` (dashboard SPA shell) | Loads 200 | Server down → 500 | curl + screenshot | 200 OK |
| 2 | `/t/[slug]` e.g. `/t/saramantha` | Tenant page SSR | Inactive slug → 404 | curl HTML + schema.org validator | OnlineStore + ItemList + FAQPage JSON-LD valid |
| 3 | `/t/[slug]/p/[sku]` | Product page SSR | SKU not found → 404 | curl HTML | Product + BreadcrumbList JSON-LD valid |
| 4 | `/sitemap.xml` | Lists tenants + products | Empty DB → just root | curl XML | valid per schema |
| 5 | `/robots.txt` | Allows /t/, blocks /api/ | — | curl text | matches policy |

### 3.5 Prisma Models (62) — Owner: WS-2

> Grouped by domain. Each model: verify (a) `tenantId` field where appropriate (multi-tenant), (b) index on hot query paths, (c) relation integrity, (d) cascade policy, (e) seed coverage.

**Multi-tenant core (1):** Tenant
**Identity (1):** User
**Channels (1):** Channel
**Conversations (3):** Customer, Conversation, Message
**Catalog (5):** Product, VolumePrice, SalesSpeech, Objection, ThemeDesign, CategoryCombo
**Orders (3):** Order, OrderItem, OrderEvent
**Logistics history (2):** DeliveryHistory, ImageIdentification
**Ads & Attribution (5):** AdPlatform, Campaign, Ad, AdSpend, Attribution
**Logistics (3):** Carrier, Shipment, CommissionEntry
**Billing (2):** Invoice, AuditLog
**Config (2):** AutomationRule, Setting
**Intelligence (3):** CustomerScore, CarrierScore, GuideTracking
**Marketplace (3):** MarketplaceListing, LeadShareConfig, LeadReferral
**Remarketing (2):** RemarketingCampaign, RemarketingMessage
**Novedades & Redelivery (5):** NovedadCase, NovedadEvidence, NovedadMessage, GuideMovement, RedeliveryRequest, RedeliveryAttempt
**Behavior (2):** BuyerBehavior, BehaviorAlert
**Cart (2):** ConversationalCart, CartItem
**Enrichment (1):** ProductEnrichment
**Trafficker / Fintech (5):** Trafficker, TraffickerCampaign, TraffickerSale, TraffickerTransaction, TraffickerCompensation
**Wallet (4):** WalletAccount, WalletTransaction, WithdrawalRequest, TwoFactorConfig
**Traffic Intelligence (4):** PixelConfig, ConversionEvent, SEOConfig, GeoTarget
**Notifications (1):** CustomerNotification

**Per-model audit checklist (apply to all 62):**
- [ ] Field types correct (no `any`, no implicit `String` for enums that should be constants)
- [ ] `tenantId` present on all business-data models (exceptions: Tenant itself, AdPlatform if global)
- [ ] `@@index([tenantId, ...])` on hot query columns
- [ ] `@@unique` where business key requires it (e.g. Tenant.slug, User.email)
- [ ] Relations have explicit `onDelete` policy
- [ ] No `Json` blob without documented shape (Document exceptions noted)
- [ ] Seed covers at least one row per model (verify in `prisma/seed.ts`)

### 3.6 Fintech Features — Owner: WS-8

| Feature | Golden path | Edge case | Evidence | Pass criteria |
|---|---|---|---|---|
| Wallet balance | GET /api/wallet?traffickerId → balance | No transactions → 0 | API JSON | balance === last balanceAfter |
| Transaction ledger (15 categories) | Inbound: sale_commission, referral_bonus …; Outbound: withdrawal_request, withdrawal_fee … | Invalid category → reject | DB row | category in allowed set |
| 2FA setup | setup_2fa → QR → verify → backup codes | Re-setup overwrites secret | DB TwoFactorConfig | enabled=true only after verify |
| 2FA enforcement on withdrawal | request_withdrawal without TOTP → 403 | Wrong TOTP → 401 | API response | blocked without valid code |
| Withdrawal fee (2%) | amount=100 → fee=2, net=98 | amount=0 → reject | DB row | math exact |
| Compensation (vendedor fail) | Sale fails → trafficker compensated | Sale succeeds → no compensation | DB TraffickerCompensation | auto-trigger documented |
| Withdrawal accounts | register bank/nequi/daviplata/paypal/wise | Duplicate account → reject | DB WalletAccount | accountNumber masked in API response |
| Admin actions | Complete/Reject withdrawal | Withdrawal already complete → 409 | API response | state machine enforced |

### 3.7 Multi-Tenant Features — Owner: WS-1

| Feature | Golden path | Edge case | Evidence | Pass criteria |
|---|---|---|---|---|
| Tenant switcher UI | Switch Saramantha → Sublimados | Switch to inactive → block | screenshot + log | all subsequent queries scoped |
| tenantId in 62 models | Every business model has tenantId | — | schema grep | 100% coverage |
| RLS readiness | Postgres policies drafted | SQLite → no RLS (documented) | SQL file or schema annotation | policies exist for prod migration |
| Cross-tenant data leak test | Query orders with tenantA session, expect 0 rows from tenantB | — | API probe | 0 rows leaked |
| Public SSR scoped | /t/saramantha shows only Saramantha products | — | curl + DB grep | no cross-tenant Product in HTML |
| Seed tenants (5) | Saramantha, Sublimados Majestic, Lovely Pijamas, Sueño de Reina, Indisutex Intl | — | DB query | 5 rows, all activo=true |

### 3.8 Real-Time Features — Owner: WS-7

| Feature | Golden path | Edge case | Evidence | Pass criteria |
|---|---|---|---|---|
| Socket.io connect | Agent opens dashboard → socket connects | Service down → reconnect 10x | browser log | connected event |
| Message broadcast | Send → all dashboards receive | — | log | message:new emitted |
| Typing indicator | agent:typing → broadcast | — | log | socket.broadcast |
| Status change | status:change → broadcast | — | log | entity+id+status |
| Reconnection | Drop network → restore | 10 fails → give up | log | reconnectionAttempts=10 |
| Room isolation (TODO) | Tenant A cannot receive tenant B messages | — | probe | **currently NOT implemented** — flag Critical |

---

## 4. Role-Based Access Control (RBAC) Audit

### 4.1 Role Inventory (6 roles)

| Role ID | Label | Description | Default landing view |
|---|---|---|---|
| `admin` | Admin tenant | Full CRUD on own tenant; manages users, channels, settings | overview |
| `trafficker` | Trafficker (affiliate) | Manages own campaigns, wallet, withdrawals; read on attributed sales | wallet |
| `agent` | Vendedor / Agente IA | Handles conversations, orders, cart; no settings, no wallet | messenger |
| `operador` | Operador logístico | Read orders/shipments; create guide movements, novedades; nofinancial | logistics-intelligence |
| `ia` | Agente IA (system) | Non-human; invoke via /api/agents; scoped per agent | n/a (API only) |
| `customer` | Comprador público | Read-only on own order status via SSR + WhatsApp deeplink | /t/[slug] |

### 4.2 Permission Matrix (CRUD per resource)

| Resource | admin | trafficker | agent (vendedor) | operador | ia | customer |
|---|---|---|---|---|---|---|
| Tenant (own) | CRUD | R | R | R | — | R (public fields) |
| User (own tenant) | CRUD | — | R self | — | — | — |
| Channel | CRUD | — | R | R | — | — |
| Customer | CRUD | R (attributed) | CRUD | R | R | R self |
| Conversation | CRUD | R (attributed) | CRUD | R | RW (post as IA) | — |
| Message | CRUD | R | CRUD | R | W (outbound) | — |
| Product | CRUD | R | R | R | R | R (public) |
| Order | CRUD | R (attributed) | CRUD | R + status update | R | R self |
| OrderItem / OrderEvent | CRUD | R | CRUD | R | R | — |
| Cart / CartItem | CRUD | — | CRUD | — | RW | — |
| Shipment | CRUD | R | R | CRUD | R | R self |
| GuideMovement | CRUD | — | R | CRUD | R | — |
| NovedadCase | CRUD | R | CRUD | CRUD | R | — |
| RedeliveryRequest | CRUD | — | R | CRUD | R | — |
| Campaign (ads) | CRUD | CRUD (own) | R | — | — | — |
| Ad / AdSpend | CRUD | CRUD (own) | R | — | — | — |
| Attribution | R | R (own) | R | — | — | — |
| Trafficker profile | R all | R self / U self | — | — | — | — |
| WalletAccount | R all | CRUD self | — | — | — | — |
| WalletTransaction | R all | R self | — | — | — | — |
| WithdrawalRequest | R all / approve | CRUD self (with 2FA) | — | — | — | — |
| TwoFactorConfig | R all | CRUD self | — | — | — | — |
| CommissionEntry | R all | R self | — | — | — | — |
| Invoice | R all | R self | — | — | — | — |
| MarketplaceListing | CRUD | CRUD (own) | R | — | — | R |
| LeadReferral | R all | R self | R | — | — | — |
| PixelConfig / ConversionEvent | CRUD | R (own) | — | — | — | — |
| SEOConfig / GeoTarget | CRUD | — | — | — | — | — |
| CustomerNotification | CRUD | — | R | R | W (auto) | R self |
| AuditLog | R all | R self | — | — | — | — |
| Setting | CRUD | — | R | — | — | — |
| AutomationRule | CRUD | — | R | — | R | — |
| Public SSR views | — | — | — | — | — | R |

### 4.3 RBAC Audit Procedure

For **every** of the 44 API routes:

1. Enumerate the resources touched (read + write).
2. Check the route has an auth check (session token, role guard).
3. Verify the role is allowed per matrix above.
4. Verify tenantId scope is enforced (cross-tenant access blocked).
5. Verify the response payload does not leak fields outside the role's read scope.

**Documented gaps already detected:**

| Route | Gap | Severity |
|---|---|---|
| `GET /api/wallet` | No session check; any caller with `traffickerId` reads balance | **Critical** |
| `POST /api/wallet` (action=request_withdrawal) | No session check; only TOTP guards — an attacker with the TOTP secret could withdraw | **Critical** |
| `GET /api/agents` | No auth; lists all 26 agents (low risk — metadata only) | Medium |
| `POST /api/agents/[agentName]` | No auth; lets anyone invoke an LLM agent (cost/abuse risk) | High |
| `GET /api/conversions` | No auth; reads conversion events (PII: fbp/fbc/gclid/ttclid) | High |
| `POST /api/conversions` | No auth; can fire fake conversion events | High |
| `POST /api/webhooks/whatsapp` | No HMAC verification | **Critical** |
| `POST /api/webhooks/meta` | No HMAC verification | **Critical** |
| `GET /api/public/tenants`, `GET /api/public/catalog` | Intentionally public — verify only non-sensitive fields exposed | Info |

### 4.4 RBAC Enforcement Points to Audit

- [ ] `src/hooks/use-tenant.ts` — does it gate UI by role?
- [ ] `src/components/dashboard/sidebar.tsx` — does it filter nav items by role?
- [ ] Every `src/app/api/**/route.ts` — does it call a `requireRole()` helper? (No such helper found during planning → flag High, propose `src/lib/auth.ts` middleware)
- [ ] `src/components/dashboard/wallet-view.tsx` — does it hide admin actions for non-admins?
- [ ] `src/app/t/[slug]/page.tsx` — does it expose only `Tenant.activo=true` + only `Product.activo=true`?

---

## 5. Audit Workstreams (parallelizable)

> Each workstream is a self-contained assignment for a specialized sub-agent.
> All workstreams produce: (a) a checklist completion log, (b) findings under `audit/findings/WS-N-*.md`, (c) evidence under `audit/evidence/WS-N/`.
> **Parallelization:** WS-1, WS-2, WS-5, WS-9, WS-10, WS-11, WS-12 can run in parallel (no shared writes). WS-3, WS-4, WS-6, WS-7, WS-8 share the API surface — run after WS-1 baseline.

### WS-1: Security & AuthN/AuthZ

**Owner:** Security sub-agent
**Scope:** RBAC, RLS, 2FA, HMAC, secrets, OWASP Top 10
**Files in scope:** `src/lib/totp.ts`, `src/app/api/webhooks/*`, `src/app/api/wallet/route.ts`, `.env`, `src/hooks/use-tenant.ts`, all 44 API routes (auth posture), `next.config.ts`, `Caddyfile`, `mini-services/chat-service/index.ts`

**Checklist (28 items):**

1. [ ] Verify `.env` contains ONLY non-secret placeholder values committed; real secrets in `.env.local` (gitignored) — confirm `.gitignore`.
2. [ ] Enumerate all `process.env.*` references; map each to a documented env var in README.
3. [ ] Verify `WA_VERIFY_TOKEN` and `META_VERIFY_TOKEN` have NO default fallback (currently `'commerceflow_verify'` — Critical).
4. [ ] Verify WhatsApp webhook POST validates `X-Hub-Signature-256` HMAC-SHA256 with `APP_SECRET`.
5. [ ] Verify Meta webhook POST validates `X-Hub-Signature-256` HMAC-SHA256.
6. [ ] Verify NocoDB webhook (if present) validates a shared secret header.
7. [ ] Audit `src/lib/totp.ts`: TOTP period=30, digits=6, window=1 — confirm against RFC 6238.
8. [ ] Verify TOTP secret stored encrypted at rest (currently plaintext in `TwoFactorConfig.secret` — flag High).
9. [ ] Verify backup codes stored hashed (currently plaintext JSON — flag High).
10. [ ] Verify `POST /api/wallet` (action=request_withdrawal) enforces session + role + 2FA + tenant scope.
11. [ ] Verify no API route accepts a raw `traffickerId` from the client without ownership check.
12. [ ] Verify `next.config.ts` removes `typescript.ignoreBuildErrors: true` (currently true — flag High).
13. [ ] Verify `next.config.ts` sets `reactStrictMode: true` (currently false — flag Medium).
14. [ ] Verify `Caddyfile` enforces HTTPS redirect + HSTS header.
15. [ ] Verify `Caddyfile` sets security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
16. [ ] Verify `chat-service/index.ts` restricts CORS origin (currently `'*'` — flag High).
17. [ ] Verify socket.io auth: socket handshake must carry a session token.
18. [ ] Verify room isolation: tenant A sockets cannot join tenant B rooms (currently no rooms — flag Critical).
19. [ ] OWASP A01 — Broken Access Control: probe each API route without auth cookie, expect 401/403.
20. [ ] OWASP A02 — Cryptographic Failures: scan for plaintext secrets, weak hashes (MD5 in payu.ts is for signature spec — verify it's not used for passwords).
21. [ ] OWASP A03 — Injection: verify all Prisma queries use parameterized APIs (no `$queryRawUnsafe`).
22. [ ] OWASP A04 — Insecure Design: verify idempotency keys on payment create-link.
23. [ ] OWASP A05 — Security Misconfiguration: verify no `cors: '*'` on auth endpoints.
24. [ ] OWASP A07 — Identification & Auth Failures: verify no session fixation, logout invalidates token.
25. [ ] OWASP A08 — Software & Data Integrity: verify webhook payloads integrity-checked before persisting.
26. [ ] OWASP A09 — Logging: verify audit log captures actor + action + entity + timestamp on every mutation.
27. [ ] OWASP A10 — SSRF: verify ad/payment adapters validate upstream URLs against allowlist.
28. [ ] Verify `AuditLog.tenantId` is populated on every write (currently `AuditLog` may not have tenantId — confirm in schema).

**Evidence collection:** `audit/evidence/WS-1/{curl-probes,env-scan,owasp-zap-baseline.html}`
**Expected pass rate:** 18/28 (10 known gaps → 10 Critical/High findings expected)
**Auto-fix policy:** items 12, 13, 16 (config flags) → auto-fix. Items 4, 5, 17, 18 (HMAC, socket auth, rooms) → flag-only (architectural). Items 8, 9 (encryption) → flag-only.

### WS-2: Data Layer

**Owner:** Data sub-agent
**Scope:** Prisma schema integrity, migrations, seed, multi-tenant isolation, pgvector readiness, indexes
**Files in scope:** `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/db.ts`, `src/lib/carriers.ts`, `src/lib/format.ts`, `db/custom.db`

**Checklist (24 items):**

1. [ ] Confirm 62 models present (grep `^model ` → 62).
2. [ ] For each of 62 models, verify `tenantId` field present OR documented exception.
3. [ ] Verify `Tenant.id` is referenced as `tenantId` (not `tenant_id`) consistently across all FKs.
4. [ ] Verify `@@index([tenantId, createdAt])` on time-series models (Message, Order, OrderEvent, WalletTransaction, ConversionEvent, GuideMovement, CustomerNotification).
5. [ ] Verify `@@unique([tenantId, slug])` on Product SKU, Channel accountId.
6. [ ] Verify `onDelete: Cascade` is intentional (not default) on every relation.
7. [ ] Verify no `Json` field lacks documented schema (find all `Json` usages).
8. [ ] Verify `prisma/seed.ts` creates exactly 5 tenants (Saramantha, Sublimados Majestic, Lovely Pijamas, Sueño de Reina, Indisutex Intl).
9. [ ] Verify seed loads 238 real orders (worklog says 238, RE-AUDITORIA says 239 — confirm truth).
10. [ ] Verify 6 "Interrapidísimo" carrier variants normalized to 1 canonical `Carrier` row (or 6 with `canonicalId`).
11. [ ] Verify seed is idempotent (`upsert` not `create`).
12. [ ] Verify `prisma db push` runs clean on a fresh SQLite.
13. [ ] Verify migration path to Postgres: `provider = "sqlite"` → swap to `"postgresql"` should work without schema edits.
14. [ ] Verify pgvector column (`Vector?`) declared on Product/Message if embeddings used (worklog claims embeddings/ dir exists — it does NOT, flag High).
15. [ ] Verify `Message.embedding` field exists if semantic search claimed (RE-AUDITORIA says yes — confirm).
16. [ ] Verify RLS SQL file exists for Postgres (worklog claims `src/lib/rls.ts` — does NOT exist on disk, flag High).
17. [ ] Verify composite indexes on hot paths: `Order(tenantId, status, createdAt)`, `Conversation(tenantId, status, lastMessageAt)`.
18. [ ] Verify `WalletTransaction` has `balanceBefore` + `balanceAfter` for ledger integrity (immutable chain).
19. [ ] Verify `WithdrawalRequest` state machine field (`status`) has allowed-values constraint in code.
20. [ ] Verify `AuditLog.meta` size cap (currently `.slice(0, 1000)` in webhooks — verify elsewhere).
21. [ ] Verify no N+1 query patterns in seed (eager load relations where needed).
22. [ ] Verify `db.custom.db` is gitignored OR committed intentionally (check `.gitignore`).
23. [ ] Verify Prisma client log level: production = `['error']`, dev = `['error','warn']` (currently correct in `src/lib/db.ts`).
24. [ ] Verify `prisma generate` runs without warnings.

**Evidence collection:** `audit/evidence/WS-2/{schema-graph.png, seed-output.log, prisma-validate.txt}`
**Expected pass rate:** 19/24 (5 gaps: RLS file missing, embeddings missing, 238 vs 239 truth, pgvector readiness, possibly missing indexes)
**Auto-fix policy:** Add missing `@@index` → auto-fix. Add Postgres RLS SQL file → flag-only (architectural). Confirm order count truth → flag-only.

### WS-3: Backend API

**Owner:** Backend sub-agent
**Scope:** All 44 API routes — input validation, error handling, idempotency, rate limiting, logging
**Files in scope:** all `src/app/api/**/route.ts`

**Checklist (30 items):**

1. [ ] Every POST/PUT/PATCH route validates body with zod schema (count: how many do vs. don't).
2. [ ] Every route returns structured error JSON `{ error: string }` with correct HTTP status.
3. [ ] No route returns 200 on error.
4. [ ] No route uses `any` in request/response types.
5. [ ] Every mutation route creates an `AuditLog` entry.
6. [ ] Every route that accepts `tenantId` from client verifies the caller belongs to that tenant.
7. [ ] Idempotency: `POST /api/payments/create-link` uses `reference` (verify it dedupes on retry).
8. [ ] Idempotency: `POST /api/conversions` uses `eventId` (verify dedup).
9. [ ] Rate limiting: confirm no rate limit on `/api/agents/[agentName]` (LLM cost abuse) — flag High.
10. [ ] Rate limiting: confirm no rate limit on `/api/webhooks/whatsapp` (DDoS) — flag Medium.
11. [ ] Error handling: every `await db.*` is wrapped in try/catch OR relies on a global error boundary.
12. [ ] No `console.log` left in production routes (find all).
13. [ ] No `console.warn` left except in adapter stubs (documented pattern).
14. [ ] Response size: `/api/overview` returns bounded payload (verify `take` on every `findMany`).
15. [ ] Pagination: list endpoints (`/api/orders`, `/api/conversations`, `/api/novedades`) accept `cursor` or `page` param.
16. [ ] Sorting: list endpoints accept `sortBy` + `order`.
17. [ ] Filtering: list endpoints accept filter params scoped to tenantId.
18. [ ] `GET /api/health` does NOT require auth (intentional) — verify it leaks no secrets.
19. [ ] `GET /api/health/uptime` — verify auth (should be admin-only) — currently unknown.
20. [ ] `POST /api/orchestrate` — verify it validates pipelineId against enum.
21. [ ] `POST /api/agents/[agentName]` — verify agentName against `AGENT_NAMES` allowlist.
22. [ ] `POST /api/ai-reply` — verify conversationId belongs to caller's tenant.
23. [ ] `POST /api/catalog/sync` — verify idempotent (no duplicate Products on re-sync).
24. [ ] `POST /api/payments/create-link` — verify `amount > 0`, `gateway` in `PAYMENT_GATEWAYS`.
25. [ ] `POST /api/webhooks/whatsapp` — verify returns 200 fast (no blocking work).
26. [ ] `DELETE /api/ads/[id]` — verify soft-delete vs hard-delete (currently unknown).
27. [ ] `PATCH /api/orders/[id]` — verify status transition allowed-values.
28. [ ] `POST /api/wallet` (action=register_account) — verify `accountNumber` is masked in response.
29. [ ] Every route documents its contract in a JSDoc comment.
30. [ ] No route uses `req.json()` without try/catch (malformed JSON → 500 currently).

**Evidence collection:** `audit/evidence/WS-3/{curl-44-routes.json, openapi-snapshot.yaml}`
**Expected pass rate:** 18/30 (12 gaps expected: rate limiting, pagination, zod coverage, console.log, JSDoc)
**Auto-fix policy:** Add zod schemas → auto-fix. Remove console.log → auto-fix. Add try/catch on `req.json()` → auto-fix. Add rate limiting middleware → flag-only (architectural, needs Redis).

### WS-4: Agents & Orchestration

**Owner:** Agents sub-agent
**Scope:** 26 agents, 3 pipelines, prompts, LLM multi-provider, fallback
**Files in scope:** `src/lib/agents/prompts.ts`, `src/lib/orchestrator/constants.ts`, `src/app/api/agents/*`, `src/app/api/orchestrate/route.ts`, `src/app/api/ai-reply/route.ts`, `src/app/api/buyer-behavior/route.ts`, `src/app/api/catalog/send-to-chat/route.ts`, `src/app/api/redelivery/route.ts`, `src/app/api/logistics-intelligence/route.ts`, `src/app/api/marketplace/route.ts`, `src/app/api/product-enrichment/route.ts`, `src/app/api/remarketing/route.ts`, `src/app/api/notifications/route.ts`, `src/app/api/address-analysis/route.ts`, `agent-ctx/REDELIVERY-API-UI-orchestrator.md`

**Checklist (26 items):**

1. [ ] Verify `AGENT_NAMES` array has exactly 26 entries.
2. [ ] For each of 26 agents, verify a prompt exists in `prompts.ts` (≥100 chars).
3. [ ] Verify NO business data is hardcoded in prompts (regla de oro §2 — only brand voice, not products).
4. [ ] Verify each agent's prompt references its inputs as variables, not literals.
5. [ ] Verify `POST /api/agents/[agentName]` returns structured `{ agent, output, meta }` shape.
6. [ ] Verify `POST /api/agents/[agentName]` rejects unknown agentName with 404.
7. [ ] Verify LLM provider fallback chain: tenant.proveedorIa → zai default (confirm in `ai-reply`).
8. [ ] Verify LLM adapter supports 4 providers: zai, chatgpt, xai, ollama (RE-AUDITORIA says only zai tested — confirm code path).
9. [ ] Verify the LLM adapter file exists (worklog claims `src/lib/llm/adapter.ts` — does NOT exist on disk, flag Critical).
10. [ ] Verify Pipeline A sequence: buyer_behavior → profile → speech → catalog → cart_builder → quote → objection → address → logistics → checkout (10 steps).
11. [ ] Verify Pipeline B sequence: guide_tracking → novedades → redelivery → remarketing (4 steps).
12. [ ] Verify Pipeline C sequence: customer_score → carrier_score → product_enrichment → marketplace → affiliator (5 steps).
13. [ ] Verify `POST /api/orchestrate` accepts `{ pipelineId, tenantId, input }` and runs steps in order.
14. [ ] Verify orchestrator persists state between steps (ConversationSession or similar).
15. [ ] Verify orchestrator handles step failure: logs, continues OR halts per pipeline config.
16. [ ] Verify buyer_behavior activates `require_prepay` protocol if devolvedor detected (per worklog FIX 4).
17. [ ] Verify sales_retainer anti-invasion: max 2 msgs, 1 per 24h, 8am-8pm CO timezone.
18. [ ] Verify logistics_notifier: 9 lifecycle types, at_office + out_for_delivery are CRÍTICA.
19. [ ] Verify traffic_orchestrator: dedup eventId, user matching (fbp/fbc/gclid/ttclid).
20. [ ] Verify `address` agent collects 10 fields one-at-a-time (not all at once).
21. [ ] Verify `novedades` agent anti-alucinación: validates order exists before creating case.
22. [ ] Verify `vision` agent pipeline: OCR (tesseract) → CLIP (@xenova/transformers) → VLM (z-ai-web-dev-sdk). Confirm `vision/` dir exists (worklog claims yes — does NOT, flag High).
23. [ ] Verify `cart_builder` persists `ConversationalCart` + `CartItem` with tenantId.
24. [ ] Verify `affiliator` computes ROI from TraffickerSale + TraffickerTransaction.
25. [ ] Verify all agent responses are tenant-scoped (no cross-tenant data in output).
26. [ ] Verify token/cost logging per LLM call (for billing).

**Evidence collection:** `audit/evidence/WS-4/{agent-26-responses.json, pipeline-ABC-traces.json}`
**Expected pass rate:** 19/26 (7 gaps: LLM adapter missing, vision dir missing, fallback untested, cost logging, etc.)
**Auto-fix policy:** Add missing JSDoc → auto-fix. Add agentName allowlist enforcement → auto-fix. Re-create `src/lib/llm/adapter.ts` if truly missing → flag-only (architectural, may exist as inline code).

### WS-5: Integrations & Adapters

**Owner:** Integrations sub-agent
**Scope:** 18 adapters (catalog/logistics/payments/ads) — credential handling, error fallback, retry
**Files in scope:** all `src/lib/adapters/*.ts`, `src/app/api/catalog/*`, `src/app/api/shipping/*`, `src/app/api/payments/*`, `src/app/api/ads/*`, `src/app/api/conversions/route.ts`

**Checklist (24 items):**

1. [ ] Verify `ecommerce-adapter.ts` interface has: `listProducts`, `getProduct`, `syncCatalog`, `pushOrder`.
2. [ ] Verify `logistics-adapter.ts` interface has: `quote`, `createGuide`, `trackGuide`, `cancelGuide`.
3. [ ] Verify `payment-adapter.ts` interface has: `createPaymentLink`, `verifyPayment`, `refund`, `webhookVerify`.
4. [ ] For each of 18 adapters: confirm stub-when-no-creds pattern (return `success: false, message: 'X credentials not configured'`).
5. [ ] Verify WooCommerce adapter makes real HTTP (RE-AUDITORIA flagged as stub — re-verify current code).
6. [ ] Verify Shopify adapter makes real HTTP.
7. [ ] Verify Supabase adapter uses `@supabase/supabase-js` or raw `fetch` (RE-AUDITORIA flagged).
8. [ ] Verify Dropi adapter: real HTTP for quote + createGuide.
9. [ ] Verify 99envios adapter: real HTTP.
10. [ ] Verify Aveonline adapter: real HTTP.
11. [ ] Verify Google Ads adapter: GAQL v17, `cost_micros` → `spend` division by 1_000_000.
12. [ ] Verify TikTok Ads adapter: Marketing API v1.3, `code != 0` handled as error.
13. [ ] Verify MercadoPago adapter: `webhookVerify` does HMAC-SHA256 of `ts+body`.
14. [ ] Verify Wompi adapter: amounts in cents, HMAC of body.
15. [ ] Verify Stripe adapter: `webhookVerify` parses `t=,v1=` signature format.
16. [ ] Verify PayU adapter: MD5 signature `{apiKey}~{merchantId}~{reference}~{amount}~{currency}`.
17. [ ] Verify `payment-registry.ts` exports `PAYMENT_GATEWAYS` typed list.
18. [ ] Verify `registry.ts` (catalog) returns adapter or null — never throws.
19. [ ] **Verify `/api/conversions` actually fires to Meta CAPI / Google MP / TikTok Events API** (currently STUB at line 66 — Critical).
20. [ ] Verify retry policy: adapters retry on 5xx with exponential backoff (currently unknown — flag High if absent).
21. [ ] Verify timeout: every outbound HTTP has a timeout (currently unknown).
22. [ ] Verify no adapter logs raw credentials (scan for `console.log(token)`).
23. [ ] Verify `User-Agent` header set on outbound calls.
24. [ ] Verify adapters normalize currency (COP for ML, USD for Stripe) — flag Medium if inconsistent.

**Evidence collection:** `audit/evidence/WS-5/{adapter-18-matrix.md, conversions-stub-proof.txt, http-traces/}`
**Expected pass rate:** 15/24 (9 gaps: conversions stub, retry, timeout, currency norm, Woo/Shopify/Supabase real-HTTP)
**Auto-fix policy:** Add timeouts → auto-fix. Add User-Agent → auto-fix. Implement real CAPI calls → flag-only (needs credentials + architectural decision).

### WS-6: Frontend UX

**Owner:** Frontend sub-agent
**Scope:** 14 dashboard views + 2 SSR pages + responsive + sticky footer + dark mode + a11y
**Files in scope:** all `src/components/dashboard/*.tsx`, `src/components/theme-provider.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

**Checklist (28 items):**

1. [ ] Verify sidebar has 14 nav items matching the 14 modules.
2. [ ] Verify sidebar shows tenant switcher dropdown.
3. [ ] Verify topbar shows current tenant + role badge.
4. [ ] Verify every view has a loading skeleton state.
5. [ ] Verify every view has an empty state (no data → helpful message).
6. [ ] Verify every view has an error state (API 500 → toast + retry).
7. [ ] Verify `use-toast.ts` is wired into every mutation (create/update/delete).
8. [ ] Verify Kanban drag&drop uses `@dnd-kit/core` + persists order to API.
9. [ ] Verify Kanban has 8 columns matching `KANBAN_STAGES`.
10. [ ] Verify Messenger dropdown has 27 items (26 agents + generic).
11. [ ] Verify Messenger socket reconnects on disconnect (use `getSocket()` from `src/lib/socket.ts`).
12. [ ] Verify Wallet view: 2FA setup dialog (3 steps), TOTP InputOTP, backup codes display.
13. [ ] Verify Wallet view: withdrawal dialog enforces TOTP before submit.
14. [ ] Verify Catalog Visual: embedded IA chat panel (worklog claims yes).
15. [ ] Verify Overview: 4 KPI cards + chart (Recharts).
16. [ ] Verify dark mode toggle works (next-themes).
17. [ ] Verify responsive: mobile stack, desktop grid (test 375px, 768px, 1280px).
18. [ ] Verify sticky footer present on SSR pages.
19. [ ] Verify a11y: all interactive elements have `aria-label` (run `axe-core`).
20. [ ] Verify a11y: color contrast ≥ 4.5:1 on text (run Lighthouse).
21. [ ] Verify a11y: keyboard navigation works on Kanban + dialogs.
22. [ ] Verify a11y: focus trap on dialogs.
23. [ ] Verify i18n: no hardcoded Spanish strings that should be in `next-intl` messages (LATAM-first, but Colombian Spanish is default).
24. [ ] Verify no `any` in component props (TypeScript strict).
25. [ ] Verify `Suspense` boundaries around async SSR data.
26. [ ] Verify `loading.tsx` / `error.tsx` Next.js conventions (currently unknown if present).
27. [ ] Verify image optimization: `next/image` used on SSR product images.
28. [ ] Verify no inline styles where Tailwind class exists.

**Evidence collection:** `audit/evidence/WS-6/{screenshots-mobile-desktop-dark.png, lighthouse-report.html, axe-report.json}`
**Expected pass rate:** 20/28 (8 gaps expected: a11y, loading/error conventions, image optimization, i18n)
**Auto-fix policy:** Add aria-labels → auto-fix. Add `loading.tsx`/`error.tsx` → auto-fix. Replace `<img>` with `<Image>` → auto-fix. Refactor for i18n → flag-only.

### WS-7: Real-Time (Socket.io)

**Owner:** Real-time sub-agent
**Scope:** Socket.io mini-service, message flow, reconnection, room isolation
**Files in scope:** `mini-services/chat-service/index.ts`, `src/lib/socket.ts`, `examples/websocket/server.ts`, `examples/websocket/frontend.tsx`

**Checklist (14 items):**

1. [ ] Verify chat-service binds to port 3003.
2. [ ] Verify Caddyfile forwards `?XTransformPort=3003` to chat-service (currently 23 lines — confirm rule).
3. [ ] Verify `src/lib/socket.ts` connects with `transports: ['websocket', 'polling']`.
4. [ ] Verify reconnection: `reconnectionAttempts: 10`, `reconnectionDelay: 1500`.
5. [ ] Verify `message:sent` event broadcasts `message:new` (outbound + simulated inbound).
6. [ ] Verify `agent:typing` event broadcasts to others (not sender).
7. [ ] Verify `status:change` event broadcasts to all.
8. [ ] **Verify room/tenant isolation: sockets join a room per tenantId; `io.to(room).emit()` instead of `io.emit()`.** (Currently `io.emit()` broadcasts to ALL — flag Critical.)
9. [ ] Verify auth: socket handshake carries JWT/session token (currently none — flag High).
10. [ ] Verify rate limit on `message:sent` (currently none — flag Medium).
11. [ ] Verify message persistence: outbound message persisted to `Message` table (currently only emits, no DB write — flag High).
12. [ ] Verify graceful shutdown: SIGTERM/SIGINT handlers (currently present ✓).
13. [ ] Verify ping/pong: `pingTimeout: 60000`, `pingInterval: 25000` (present ✓).
14. [ ] Verify chat-service is containerized in docker-compose (worklog claims yes — verify compose file).

**Evidence collection:** `audit/evidence/WS-7/{socket-events.log, room-isolation-probe.json}`
**Expected pass rate:** 8/14 (6 gaps: room isolation, auth, persistence, rate limit)
**Auto-fix policy:** Add room join → auto-fix (low risk). Add socket auth middleware → flag-only (needs session integration). Add DB persistence → flag-only (architectural).

### WS-8: Fintech

**Owner:** Fintech sub-agent
**Scope:** Wallet, transactions, withdrawals, 2FA TOTP, compensation logic
**Files in scope:** `src/app/api/wallet/route.ts`, `src/app/api/monetization/*`, `src/app/api/trafficker/route.ts`, `src/components/dashboard/wallet-view.tsx`, `src/lib/totp.ts`, Prisma models: WalletAccount, WalletTransaction, WithdrawalRequest, TwoFactorConfig, Trafficker*, CommissionEntry

**Checklist (22 items):**

1. [ ] Verify wallet ledger immutability: WalletTransaction has `balanceBefore` + `balanceAfter`, never updated after insert.
2. [ ] Verify balance derivation: `balance === last balanceAfter` (currently computed in API — verify matches).
3. [ ] Verify 2FA setup flow: `setup_2fa` → returns secret+uri+backup codes; `verify_2fa` → sets `enabled=true`.
4. [ ] Verify `verify_2fa` requires valid TOTP (uses `verifyTOTP` from `src/lib/totp.ts`).
5. [ ] Verify `request_withdrawal` requires `enabled: true` TwoFactorConfig.
6. [ ] Verify `request_withdrawal` requires valid `totpCode` (verifyTOTP).
7. [ ] Verify `request_withdrawal` checks `balance >= amount`.
8. [ ] Verify fee calc: `fee = amount * 0.02`, `net = amount - fee`.
9. [ ] Verify withdrawal creates 2 WalletTransactions: `withdrawal_request` + `withdrawal_fee`.
10. [ ] Verify withdrawal state machine: `pending_2fa → pending_processing → processing → completed | rejected`.
11. [ ] Verify admin actions: `complete_withdrawal`, `reject_withdrawal` exist (verify in route).
12. [ ] Verify compensation logic: `TraffickerCompensation` created when `TraffickerSale.status = failed` (verify trigger).
13. [ ] Verify 15 transaction categories: inbound (sale_commission, referral_bonus, deposit, refund, compensation, …) + outbound (withdrawal_request, withdrawal_fee, refund, …).
14. [ ] Verify account registration: 5 types (bank/nequi/daviplata/paypal/wise).
15. [ ] Verify account masking: `accountNumber` returns `****1234` in API.
16. [ ] Verify no route exposes full `accountNumber` except on create.
17. [ ] Verify monetization tiers: tramo 1 (4.5%), tramo 2, tramo 3 — confirm in `monetization/commission` route.
18. [ ] Verify GMV calc: sum of `Order.total` where status in (paid, shipped, delivered) — confirm in `monetization/gmv` route.
19. [ ] Verify `Trafficker.walletBalance` updated atomically with WalletTransaction (transaction block).
20. [ ] Verify no negative balance ever possible (constraint at DB or app level).
21. [ ] Verify backup codes: 8 codes, hashed at rest (currently plaintext — flag High, see WS-1 item 9).
22. [ ] Verify 2FA disable flow (currently unknown — flag Medium).

**Evidence collection:** `audit/evidence/WS-8/{wallet-flow-trace.json, withdrawal-2fa-block-proof.json, compensation-trigger.log}`
**Expected pass rate:** 16/22 (6 gaps: backup hashing, disable flow, atomicity, negative-balance guard, RBAC on wallet, compensation trigger verification)
**Auto-fix policy:** Add Prisma `$transaction` wrapper → auto-fix. Add negative-balance guard → auto-fix. Hash backup codes → flag-only (needs migration of existing data).

### WS-9: Performance & Scalability

**Owner:** Performance sub-agent
**Scope:** N+1 queries, bundle size, SSR streaming, caching, pagination
**Files in scope:** all routes + all dashboard views + `next.config.ts` + `package.json`

**Checklist (18 items):**

1. [ ] Verify `next build` succeeds with `output: 'standalone'`.
2. [ ] Measure bundle size: `first-load-js` per route (target < 300 KB).
3. [ ] Verify code-splitting: heavy libs (recharts, framer-motion) loaded lazily.
4. [ ] Verify `dynamic(() => import(...))` used for client-only components.
5. [ ] Verify SSR pages use `fetch` caching (`cache: 'force-cache'` or `revalidate`).
6. [ ] Verify `generateMetadata` on SSR pages is async + efficient.
7. [ ] Verify `generateStaticParams` on `/t/[slug]` and `/t/[slug]/p/[sku]` for ISR.
8. [ ] Verify no N+1 in `/api/overview` (eager-load relations with `include`).
9. [ ] Verify no N+1 in `/api/orders` (include `OrderItem` + `Customer`).
10. [ ] Verify Prisma `select` used to project only needed fields (no over-fetching).
11. [ ] Verify pagination on all list endpoints (currently unknown — flag High).
12. [ ] Verify `take` cap on every `findMany` (no unbounded queries).
13. [ ] Verify `redis` in docker-compose for future caching (worklog claims yes).
14. [ ] Verify no synchronous blocking in API routes (all I/O awaited).
15. [ ] Verify image optimization: `next/image` with `width`/`height` to prevent CLS.
16. [ ] Verify font optimization: `next/font` used (currently unknown).
17. [ ] Verify `useMemo` / `useCallback` on expensive dashboard renders.
18. [ ] Verify tree-shaking: no `import * as` from large libs.

**Evidence collection:** `audit/evidence/WS-9/{bundle-analyzer.html, lighthouse-perf.json, prisma-query-log.txt}`
**Expected pass rate:** 12/18 (6 gaps: pagination, caching, image opt, font opt, code-splitting)
**Auto-fix policy:** Add `take` caps → auto-fix. Add `select` projections → auto-fix. Add `dynamic()` imports → flag-only (UX impact).

### WS-10: SEO & Public Surfaces

**Owner:** SEO sub-agent
**Scope:** Schema.org, sitemap, robots, OG tags, structured data
**Files in scope:** `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/t/[slug]/page.tsx`, `src/app/t/[slug]/p/[sku]/page.tsx`, `src/app/api/public/*`, `src/app/layout.tsx`

**Checklist (20 items):**

1. [ ] Verify `sitemap.ts` returns valid XML with `<urlset>` root.
2. [ ] Verify sitemap includes: root, /directorio, /t/{slug} for each active tenant, /t/{slug}/p/{sku} for each active product.
3. [ ] Verify sitemap entries have `lastModified`, `changeFrequency`, `priority`.
4. [ ] Verify `robots.ts` returns `text/plain` with `User-agent: *`, `Allow: /t/`, `Disallow: /api/`.
5. [ ] Verify `robots.ts` includes sitemap URL.
6. [ ] Verify `/t/[slug]` page emits `OnlineStore` JSON-LD.
7. [ ] Verify `/t/[slug]` page emits `ItemList` JSON-LD.
8. [ ] Verify `/t/[slug]` page emits `FAQPage` JSON-LD (3 Q&A).
9. [ ] Verify `/t/[slug]/p/[sku]` page emits `Product` JSON-LD with `offers`, `brand`, `additionalProperty`.
10. [ ] Verify `/t/[slug]/p/[sku]` page emits `BreadcrumbList` JSON-LD.
11. [ ] Verify `generateMetadata` on `/t/[slug]` returns title, description, keywords, canonical, OG, Twitter.
12. [ ] Verify `generateMetadata` on `/t/[slug]/p/[sku]` returns product-specific keywords.
13. [ ] Verify OG image: `og:image` points to product image or default brand.
14. [ ] Verify `canonical` URL is absolute.
15. [ ] Verify `noindex` on `/api/*` routes (via `robots.ts` + meta).
16. [ ] Verify hreflang not needed (single locale: es-CO) — document.
17. [ ] Verify JSON-LD validates with Google Rich Results Test (run on a sample URL).
18. [ ] Verify SSR pages return 200 with valid HTML (no React hydration errors).
19. [ ] Verify `/api/public/tenants` excludes inactive tenants.
20. [ ] Verify `/api/public/catalog` excludes inactive products + masks internal fields.

**Evidence collection:** `audit/evidence/WS-10/{sitemap.xml, robots.txt, rich-results-test.json, og-screenshot.png}`
**Expected pass rate:** 16/20 (4 gaps: OG image, hreflang doc, noindex on API, public catalog masking)
**Auto-fix policy:** Add `noindex` meta → auto-fix. Add canonical absolute URL → auto-fix. Add hreflang doc → auto-fix.

### WS-11: DevOps & Config

**Owner:** DevOps sub-agent
**Scope:** Docker compose, env vars, Caddyfile, health endpoint, uptime monitoring
**Files in scope:** `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `Caddyfile`, `.env`, `mini-services/chat-service/package.json`, `src/app/api/health/*`

**Checklist (20 items):**

1. [ ] Verify `docker-compose.yml` exists (worklog claims 11 services — confirm file location; NOT in root listing → flag High).
2. [ ] Verify docker-compose services: postgres, n8n, minio, nocodb, ollama, app, chat-service, redis, caddy, uptime-kuma (11 total per worklog).
3. [ ] Verify each service has healthcheck.
4. [ ] Verify volumes for persistent data (postgres, minio, redis).
5. [ ] Verify networks isolate services (app cannot reach minio directly unless needed).
6. [ ] Verify `.env.example` documents all required env vars (currently only `.env` with `DATABASE_URL` — flag High).
7. [ ] Verify `Caddyfile` reverse-proxies: `:443` → `app:3000`, `chat.example.com` → `chat-service:3003`.
8. [ ] Verify Caddyfile TLS automation (Let's Encrypt).
9. [ ] Verify Caddyfile security headers (CSP, HSTS, X-Frame-Options).
10. [ ] Verify `GET /api/health` returns summary `{ ok, warning, error, not_configured }`.
11. [ ] Verify `GET /api/health/uptime` returns uptime-kuma status (or proxy).
12. [ ] Verify `package.json` scripts: `dev`, `build`, `start`, `lint`, `db:push`, `db:generate`, `db:migrate`, `db:reset` (present ✓).
13. [ ] Verify `tsconfig.json` strict mode (verify `strict: true`).
14. [ ] Verify `eslint.config.mjs` extends `next/core-web-vitals` + `next/typescript`.
15. [ ] Verify `next.config.ts` `output: 'standalone'` (present ✓ — for Docker).
16. [ ] Verify no `console.log` in production build (eslint rule).
17. [ ] Verify `bun.lock` and `package-lock.json` not both committed (currently `bun.lock` only ✓).
18. [ ] Verify `.gitignore` excludes: `.env.local`, `.next/`, `node_modules/`, `db/custom.db`.
19. [ ] Verify CI pipeline (GitHub Actions?) — currently unknown, flag Medium.
20. [ ] Verify monitoring: uptime-kuma probes configured for `/api/health`.

**Evidence collection:** `audit/evidence/WS-11/{docker-compose-validate.txt, caddy-validate.txt, health-response.json}`
**Expected pass rate:** 13/20 (7 gaps: docker-compose missing from root, .env.example missing, CI missing, security headers, etc.)
**Auto-fix policy:** Add `.env.example` → auto-fix. Add security headers to Caddyfile → auto-fix. Create docker-compose if missing → flag-only (architectural).

### WS-12: Compliance & Data Privacy

**Owner:** Compliance sub-agent
**Scope:** LATAM PEP, Habeas Data Colombia (Ley 1581), GDPR-compatible, retention policies
**Files in scope:** `prisma/schema.prisma` (PII fields), `src/app/api/webhooks/*` (inbound PII), `src/app/api/wallet/route.ts` (financial PII), SSR pages (public PII)

**Checklist (18 items):**

1. [ ] Enumerate PII fields: Customer.name, Customer.phone, Customer.email, Customer.address*, User.email, WalletAccount.accountNumber, WalletAccount.documentNumber, Conversation metadata, Message.body.
2. [ ] Verify each PII field has documented retention period (currently unknown — flag High).
3. [ ] Verify `Customer` has `consentAt` + `consentSource` fields (Habeas Data requires consent log).
4. [ ] Verify right-to-erasure endpoint exists (`DELETE /api/customers/[id]` with cascade — currently unknown).
5. [ ] Verify right-to-portability endpoint exists (export customer data JSON — currently unknown).
6. [ ] Verify data residency: all data stored in Colombia-region infra (document in README).
7. [ ] Verify PEP screening: no political-exposed-person check on Customer (flag Medium — may be out of scope for v1).
8. [ ] Verify AuditLog retains 5+ years (financial regulation).
9. [ ] Verify WalletTransaction immutable for 5+ years.
10. [ ] Verify no PII in `console.log` (scan all log statements).
11. [ ] Verify no PII in LLM prompts (regla de oro §2 — confirm in `prompts.ts`).
12. [ ] Verify no PII in error messages returned to client.
13. [ ] Verify SSR pages do not expose Customer PII (only Product + Tenant public fields).
14. [ ] Verify webhooks log truncated (`meta: JSON.stringify(body).slice(0, 1000)`) — confirm no full PII persisted (flag Medium — may truncate mid-PII).
15. [ ] Verify cookie consent banner on SSR pages (currently unknown — flag Medium).
16. [ ] Verify GDPR-compatible: data processing agreement template exists (docs).
17. [ ] Verify subprocessors list documented (z-ai-web-dev-sdk, OpenAI, Stripe, etc.).
18. [ ] Verify breach notification procedure documented.

**Evidence collection:** `audit/evidence/WS-12/{pii-inventory.csv, consent-flow-screenshot.png, retention-policy.md}`
**Expected pass rate:** 8/18 (10 gaps expected: retention, consent, erasure, portability, cookie banner, DPA, subprocessors, breach)
**Auto-fix policy:** Add `consentAt` field → flag-only (schema migration). Add `console.log` PII scan → auto-fix (redact). Document retention policy → auto-fix (markdown).

---

## 6. Evidence Repository Structure

```
/home/z/my-project/audit/
├── evidence/                       # Captured artifacts (read-only after capture)
│   ├── WS-1-security/
│   │   ├── curl-probes/            # 44 curl JSON responses (one per API route)
│   │   ├── env-scan.txt            # All process.env references
│   │   ├── owasp-zap-baseline.html # Automated scan
│   │   └── hmac-verification-proof.txt
│   ├── WS-2-data/
│   │   ├── schema-graph.png        # Prisma ERD
│   │   ├── seed-output.log
│   │   ├── prisma-validate.txt
│   │   └── rls-policy-draft.sql
│   ├── WS-3-backend/
│   │   ├── curl-44-routes.json     # Aggregated probe results
│   │   └── openapi-snapshot.yaml
│   ├── WS-4-agents/
│   │   ├── agent-26-responses.json # One response per agent
│   │   └── pipeline-ABC-traces.json
│   ├── WS-5-integrations/
│   │   ├── adapter-18-matrix.md
│   │   ├── conversions-stub-proof.txt
│   │   └── http-traces/            # One log per adapter call
│   ├── WS-6-frontend/
│   │   ├── screenshots/            # 14 modules × 3 viewports × 2 themes
│   │   ├── lighthouse-report.html
│   │   └── axe-report.json
│   ├── WS-7-realtime/
│   │   ├── socket-events.log
│   │   └── room-isolation-probe.json
│   ├── WS-8-fintech/
│   │   ├── wallet-flow-trace.json
│   │   ├── withdrawal-2fa-block-proof.json
│   │   └── compensation-trigger.log
│   ├── WS-9-performance/
│   │   ├── bundle-analyzer.html
│   │   ├── lighthouse-perf.json
│   │   └── prisma-query-log.txt
│   ├── WS-10-seo/
│   │   ├── sitemap.xml
│   │   ├── robots.txt
│   │   ├── rich-results-test.json
│   │   └── og-screenshot.png
│   ├── WS-11-devops/
│   │   ├── docker-compose-validate.txt
│   │   ├── caddy-validate.txt
│   │   └── health-response.json
│   └── WS-12-compliance/
│       ├── pii-inventory.csv
│       ├── consent-flow-screenshot.png
│       └── retention-policy.md
├── findings/                       # One MD per finding
│   ├── F-001-critical-webhook-no-hmac.md
│   ├── F-002-critical-wallet-no-auth.md
│   ├── F-003-high-conversions-stub.md
│   ├── F-004-high-llm-adapter-missing.md
│   ├── F-005-high-rls-file-missing.md
│   ├── F-006-high-socket-no-room-isolation.md
│   ├── F-007-high-nextconfig-ignore-build-errors.md
│   ├── F-008-medium-console-log-prod.md
│   ├── F-009-medium-missing-pagination.md
│   ├── F-010-low-doc-drift.md
│   └── ...                         # One file per finding
├── reports/
│   ├── AUDIT-INTERIM-WS1-WS6.md    # After first parallel batch
│   ├── AUDIT-INTERIM-WS7-WS12.md   # After second parallel batch
│   ├── AUDIT-CONSOLIDATED.md       # After CONSOLIDATE-001
│   └── AUDIT-REPORT.md             # Final (REPORT-001)
├── fixes/                          # Applied diffs (one per auto-fix)
│   ├── FIX-001-add-zod-validation.patch
│   ├── FIX-002-remove-console-log.patch
│   ├── FIX-003-add-take-cap.patch
│   └── ...
└── README.md                       # Explains the structure
```

### Finding File Template (`audit/findings/F-NNN-*.md`)

```markdown
# F-NNN — <Title>

| Field | Value |
|---|---|
| Severity | Critical / High / Medium / Low / Info |
| Workstream | WS-N |
| Owning agent | <name> |
| Status | Open / Auto-fixed / Flagged / Closed |
| File:line | `src/app/api/webhooks/whatsapp/route.ts:18` |
| Discovered | 2025-01-XX |
| Remediated | (date or —) |

## Description
<1-paragraph explanation>

## Reproduction
```bash
curl -X POST https://app/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[...]}'
# Expected: 200 {received: true}  ← no HMAC check
```

## Evidence
- `audit/evidence/WS-1-security/hmac-verification-proof.txt`

## Impact
<what an attacker could do>

## Recommended Fix
<code snippet or PR description>

## Auto-fix Applied?
Yes / No (reason)

## Verification
<command to confirm fix>
```

---

## 7. Autonomous Fix Policy

### 7.1 Auto-fix allowed (Low risk, reversible, no architectural decision)

The auditor MAY apply these directly on a feature branch (`audit/autofix-001`) without human approval, provided each fix is committed as a separate commit with message `fix(audit): F-NNN <short>` and the diff is saved to `audit/fixes/FIX-NNN-*.patch`:

| Category | Examples | Typical Severity |
|---|---|---|
| Typos | comment / variable name typos | Low |
| Missing types | add `: string` / `: number` where `any` inferred | Low / Medium |
| Missing error handling | wrap `await db.*` in try/catch on read paths | Medium |
| Missing input validation | add zod schema to POST body | Medium / High |
| Missing tenantId guards | add `where: { tenantId, ... }` to a query that lacked it | High |
| Missing 2FA checks | add `verifyTOTP` call where absent | High |
| Missing HMAC verification | add `crypto.timingSafeEqual` on webhook signature | Critical (auto-fix allowed because pattern is mechanical) |
| Missing indexes | add `@@index([tenantId, createdAt])` to schema | Medium |
| Dead code | remove unused imports / functions | Low |
| `console.log` in prod | remove or replace with structured logger | Medium |
| Add `take: N` cap | bound unbounded `findMany` | Medium |
| Add JSDoc | document API route contract | Low |
| Add aria-labels | a11y on interactive elements | Medium |
| Replace `<img>` with `<Image>` | Next.js image optimization | Medium |
| Add `.env.example` | document required env vars | Medium |
| Add `loading.tsx` / `error.tsx` | Next.js convention files | Medium |
| Remove `ignoreBuildErrors` | `next.config.ts` flag → false | High |
| Enable `reactStrictMode` | `next.config.ts` flag → true | Medium |

### 7.2 Flag-only (requires human approval)

These MUST be filed as findings with severity + recommended fix, but NOT auto-applied:

| Category | Why flagged | Typical Severity |
|---|---|---|
| Schema migrations affecting data | requires backup + downtime window | High |
| Breaking API contract changes | requires client coordination | High |
| Security policy decisions | e.g., enforce RBAC middleware globally | Critical |
| Architectural refactors | e.g., create `src/lib/auth.ts` middleware | High |
| New dependencies | e.g., add `rate-limiter-flexible` | Medium |
| Encryption-at-rest for TOTP secrets | requires data migration | High |
| Real CAPI implementation | requires credentials + privacy review | High |
| Socket.io room refactor | changes message routing semantics | High |
| RLS Postgres policy enforcement | requires provider switch + migration | High |
| Compensation logic changes | fintech correctness, needs QA | High |
| i18n refactor | move all strings to `next-intl` | Medium |
| CI/CD pipeline creation | DevOps architectural decision | Medium |
| PEP screening | compliance product decision | Medium |
| Cookie consent banner | legal review required | Medium |

### 7.3 Auto-fix Verification Protocol

Every auto-fix must pass before the finding is marked closed:

1. `bun run lint` → 0 errors
2. `npx tsc --noEmit` → 0 errors in `src/`
3. `bun run build` → success (with `ignoreBuildErrors` removed per FIX-007)
4. The original reproduction command now returns the expected safe response
5. A new commit on `audit/autofix-001` branch with diff saved to `audit/fixes/`
6. The finding MD file updated: `Status: Auto-fixed`, `Verification: <command>`

---

## 8. Audit Execution Sequence (with Task IDs)

> The plan is dispatched in 5 phases. Phases 1–2 are parallelizable; phases 3–5 are sequential.

### Phase 1 — Parallel Audit (7 workstreams, no shared writes)

| Task ID | Workstream | Owner | Inputs | Outputs |
|---|---|---|---|---|
| `EXEC-AUDIT-WS1` | Security & AuthN/AuthZ | Security agent | `src/lib/totp.ts`, webhooks, wallet, `.env` | `audit/findings/F-*-WS1-*.md` (28 checklist items) |
| `EXEC-AUDIT-WS2` | Data Layer | Data agent | `prisma/`, `src/lib/db.ts` | `audit/findings/F-*-WS2-*.md` (24 items) |
| `EXEC-AUDIT-WS5` | Integrations & Adapters | Integrations agent | `src/lib/adapters/`, conversions API | `audit/findings/F-*-WS5-*.md` (24 items) |
| `EXEC-AUDIT-WS9` | Performance & Scalability | Performance agent | all routes + views + config | `audit/findings/F-*-WS9-*.md` (18 items) |
| `EXEC-AUDIT-WS10` | SEO & Public surfaces | SEO agent | SSR pages, sitemap, robots | `audit/findings/F-*-WS10-*.md` (20 items) |
| `EXEC-AUDIT-WS11` | DevOps & Config | DevOps agent | root configs, Caddyfile | `audit/findings/F-*-WS11-*.md` (20 items) |
| `EXEC-AUDIT-WS12` | Compliance & Data Privacy | Compliance agent | PII scan, schema, webhooks | `audit/findings/F-*-WS12-*.md` (18 items) |

**Phase 1 total checklist items: 152.** Expected findings: ~60–80 (10 Critical, 20 High, 30 Medium, 10 Low, 10 Info).

### Phase 2 — Parallel Audit (5 workstreams, depend on WS-1 baseline)

| Task ID | Workstream | Owner | Depends on | Outputs |
|---|---|---|---|---|
| `EXEC-AUDIT-WS3` | Backend API | Backend agent | WS-1 (auth baseline) | 30 items |
| `EXEC-AUDIT-WS4` | Agents & Orchestration | Agents agent | WS-1, WS-2 | 26 items |
| `EXEC-AUDIT-WS6` | Frontend UX | Frontend agent | WS-3 (API contracts) | 28 items |
| `EXEC-AUDIT-WS7` | Real-Time | RT agent | WS-1, WS-3 | 14 items |
| `EXEC-AUDIT-WS8` | Fintech | Fintech agent | WS-1, WS-2 | 22 items |

**Phase 2 total checklist items: 120.** Expected findings: ~40–60.

### Phase 3 — Consolidation

| Task ID | Action | Owner | Inputs | Outputs |
|---|---|---|---|---|
| `CONSOLIDATE-001` | Merge all findings, dedupe, rank by severity, produce risk heat-map | Plan agent | All `audit/findings/*.md` from phases 1+2 | `audit/reports/AUDIT-CONSOLIDATED.md` + `audit/findings/_INDEX.md` |

### Phase 4 — Auto-fix

| Task ID | Action | Owner | Inputs | Outputs |
|---|---|---|---|---|
| `AUTOFIX-001` | Apply all §7.1 auto-fixes on branch `audit/autofix-001`, one commit per fix | Backend agent (rotated) | `AUDIT-CONSOLIDATED.md` + finding files marked `Auto-fix allowed` | `audit/fixes/FIX-NNN-*.patch` × N + branch push |
| `VERIFY-001` | Re-run `lint` + `tsc` + `build` + agent-browser smoke on 14 modules + 2 SSR pages | QA agent | `audit/autofix-001` branch | `audit/evidence/verify-001-*.json` + close findings |

### Phase 5 — Final Report

| Task ID | Action | Owner | Inputs | Outputs |
|---|---|---|---|---|
| `REPORT-001` | Publish `AUDIT-REPORT.md` with executive summary, risk heat-map, sign-off block | Plan agent | All prior artifacts | `audit/reports/AUDIT-REPORT.md` + worklog entry |

### Execution Sequence Diagram

```
Phase 1 (parallel, 7 agents):
  WS1 ─┐
  WS2 ─┤
  WS5 ─┤
  WS9 ─┼─→ CONSOLIDATE-001
  WS10 ─┤
  WS11 ─┤
  WS12 ─┘

Phase 2 (parallel after WS-1, 5 agents):
  WS1 ──→ WS3 ──┐
         WS4 ───┤
         WS6 ←──┤ (WS-3 contracts)
         WS7 ───┤
         WS8 ───┘

Phase 3: CONSOLIDATE-001
Phase 4: AUTOFIX-001 → VERIFY-001
Phase 5: REPORT-001
```

### Total Checklist Items

| Phase | Items |
|---|---|
| Phase 1 (7 WS) | 152 |
| Phase 2 (5 WS) | 120 |
| **Total** | **272 checklist items** |

---

## 9. Acceptance / Definition of Done

The audit is **complete and the system is production-ready** when ALL of the following gates pass:

### 9.1 Finding Gates

- [ ] 0 Critical findings open (all closed or risk-accepted with documented justification)
- [ ] 0 High findings open (all closed or scheduled with SLA ≤ 72 h)
- [ ] ≤ 5 Medium findings open (each with owner + due date)
- [ ] ≤ 20 Low findings open (each with owner)
- [ ] Info findings documented, no action required

### 9.2 Coverage Gates

- [ ] 100% files inspected: 163/163 inventory entries have a depth tier assigned + executed
- [ ] 100% features exercised: 26 agents invoked, 14 modules rendered, 18 adapters called, 5 SSR routes curled, 62 Prisma models verified, 8 fintech flows tested, 8 multi-tenant tests passed, 6 real-time events traced
- [ ] 100% API routes probed: 44/44 routes have at least one happy-path + one error-path curl artifact
- [ ] agent-browser verification: 14 modules + 2 SSR pages screenshotted at 375px + 1280px in light + dark

### 9.3 Fix Gates

- [ ] All §7.1 auto-fixes applied on `audit/autofix-001` branch
- [ ] `bun run lint` → 0 errors
- [ ] `npx tsc --noEmit` → 0 errors in `src/`
- [ ] `bun run build` → success (with `ignoreBuildErrors: false`)
- [ ] All §7.2 flag-only findings have a JIRA/issue equivalent in `audit/findings/_INDEX.md` with owner + due date

### 9.4 Documentation Gates

- [ ] `audit/reports/AUDIT-REPORT.md` published with:
  - Executive summary (1 page)
  - Risk heat-map (Critical/High/Medium/Low counts by WS)
  - Coverage roll-up table
  - Top 10 findings detailed
  - Sign-off block (Engineering lead + Security officer)
- [ ] `worklog.md` appended with `REPORT-001` entry summarizing the audit
- [ ] `README.md` updated with "Audit status: PASSED" badge + link to report

### 9.5 Operational Gates

- [ ] `GET /api/health` returns 0 errors (warnings acceptable if documented in report)
- [ ] `GET /api/health` returns ≥ 6 ok (current baseline per worklog)
- [ ] `audit/fixes/` contains a patch file for every auto-fix
- [ ] `audit/evidence/` contains ≥ 1 artifact per finding (repro proof)

### 9.6 Sign-off Block (template)

```
Audit lead: ______________________  Date: __________
Engineering lead: ________________  Date: __________
Security officer: ________________  Date: __________
Compliance officer: ______________  Date: __________

Decision: [ ] PRODUCTION-READY   [ ] CONDITIONAL   [ ] BLOCKED
Conditions (if conditional):
  1. _________________________________________________
  2. _________________________________________________
```

---

## 10. Appendix

### 10.1 shadcn/ui Primitives (48 files — Existence-only)

`accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toast, toaster, toggle, toggle-group, tooltip`

### 10.2 Pre-existing Context Documents (input)

| Doc | Use |
|---|---|
| `upload/RE-AUDITORIA-honesta.md` | Prior honest audit — input for WS-1, WS-2, WS-4, WS-5 |
| `upload/MAESTRO-arquitectura.md` | Architecture reference — input for WS-2, WS-4 |
| `upload/AUDITORIA-cumplimiento-saramantha.md` | Compliance reference — input for WS-12 |
| `upload/GUIA-DEPLOY-PRODUCCION.md` | Deploy guide — input for WS-11 |
| `upload/ONBOARDING-COMPLETO.md` | Onboarding — input for WS-6 |
| `agent-ctx/REDELIVERY-API-UI-orchestrator.md` | Redelivery spec — input for WS-4 |
| `worklog.md` (1640 lines) | Build history — input for all WS |

### 10.3 Tooling Reference

| Tool | Use |
|---|---|
| `Read`, `Grep`, `Glob`, `LS` | Static inspection |
| `Bash` (curl, prisma CLI, bun, tsc, eslint) | Runtime probes + build verification |
| `agent-browser` skill | End-to-end UI verification (14 modules + 2 SSR) |
| `VLM` skill (z-ai-web-dev-sdk) | Screenshot analysis for visual regressions |
| `web-search` skill | Verify latest API versions (Meta CAPI v19, GAQL v17, TikTok v1.3) |

### 10.4 Glossary

- **RLS** — Row-Level Security (Postgres feature for multi-tenant isolation)
- **TOTP** — Time-based One-Time Password (RFC 6238, used by Google Authenticator)
- **HMAC** — Hash-based Message Authentication Code (webhook signature verification)
- **CAPI** — Conversions API (Meta server-side conversion tracking)
- **GAQL** — Google Ads Query Language
- **AEO** — Answer Engine Optimization (for AI search like ChatGPT/Perplexity)
- **GEO** — Generative Engine Optimization / Geographic SEO (context-dependent)
- **Habeas Data** — Colombian data protection law (Ley 1581 de 2012)
- **PEP** — Politically Exposed Person (compliance screening)
- **GMV** — Gross Merchandise Value
- **CPA/ROAS/ROI** — Cost Per Acquisition / Return On Ad Spend / Return On Investment
- **COD** — Cash On Delivery

---

**End of AUDIT-PLAN.md**

> *This plan is the authoritative source for the audit cycle. Any deviation must be approved by the audit lead and recorded in `worklog.md` under a new Task ID.*
