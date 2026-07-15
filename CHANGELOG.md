# Changelog

All notable changes to ZIAY are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes. See [0.3.0] for the current release._

## [0.3.0] - 2026-07-15 — "Comercio Agéntico"

Final score: **10.0/10** · 71 Prisma models · 94 API routes · 891 tests (48 files) · 21 ADRs · Next.js 16.2.10 · build 30.2s · 0 lint/tsc/redocly errors.

### Added — Protocol Trinity (AP2 / UCP / ACP / MCP / A2A)
- AP2 mandates (Intent → Cart → Payment) as W3C Verifiable Credentials signed with ed25519 (ADR-0006)
- UCP manifest at `/.well-known/ucp` with 4 capabilities + checkout state machine (ADR-0002)
- ACP manifest + `/api/acp/v1/{checkout,orders/[id],refunds}` for ChatGPT/Copilot interoperability (bearer signature verified via ed25519)
- MCP JSON-RPC endpoint (`/api/mcp`) exposing 4 tools (ziay_search_catalog, ziay_create_checkout, ziay_get_order_status, ziay_list_payment_methods)
- A2A agent-card at `/.well-known/agent-card`
- `UcpCheckoutSession` state machine: `incomplete → requires_escalation → ready_for_complete → completed`
- Governance: mandate enforcement (maxAmount + per-category limits), escalation queue (5 hard rules), liability determination, decision log with model/provider/tokens/cost/latency tracking

### Added — Multi-Country LATAM
- 7 currencies (COP, MXN, BRL, USD, PEN, CLP, ARS) with live FX feed (cold-start DB persistence) — ADR-0012, ADR-0017
- 4 local payment methods (PSE, PIX, OXXO, SPEI) with webhook receivers + HMAC verification — ADR-0013
- Country-specific tax handling (IVA/IGV/ICMS) for 7 countries
- pt-BR locale added (4 locales total: es-CO, es-MX, en-US, pt-BR)
- `FxRate` model for cold-start persistence of FX rates (DRY cache + DB combo)

### Added — Compliance Regulatorio Colombia (6 modules, 5 laws)
- Ley 2573 de 2026: KYC gate for credit/installment purchases (`IdentityVerification`)
- Ley 1581 de 2012: Consent records + DSR endpoint + automated retention cleanup (cron)
- Ley 1480 Art 47: Derecho al retracto (5-day cooling-off period) with **automated refund post-retracto** (Sprint 14, ADR-0019) — fire-and-forget gateway refund + `OrderEvent` audit trail
- Ley 1098/2006: Age gate + parental consent for minors
- Decreto 745/2014: DIAN electronic invoicing with CUFE (SHA-384) + Alegra adapter (Sprint 14, ADR-0020) — `submitToDian()` wired to `AlegraDianAdapter.createInvoice()`, `checkStatus()`, `sendByEmail()`
- Privacy policy + Terms of service pages (`/privacy`, `/terms`, `/legal`)

### Added — Monitoring Stack (Sprint 10)
- Prometheus metrics endpoint (`/api/metrics`)
- 6 alert rules (DB down, high memory, process restart, pending withdrawals, no-orders, support overload) — `monitoring/alerts.yml`
- Alertmanager with team-based routing (PagerDuty + Slack) — `monitoring/alertmanager.yml`
- Grafana dashboard (auto-provisioned via `monitoring/grafana-dashboard.json`)
- Loki log aggregation (30-day retention) + Promtail shipping
- Public status page (`/status`) with 90-day uptime bars + incident history
- Admin incident management UI (`/admin/incidents`) — Sprint 12
- Log shipping (pino → external service)

### Added — AI Agents (26 agents across 6 stages)
- 26 agents: discovery, evaluation, decision, payment, fulfillment, learning
- LLM adapter (Zai/OpenAI/xAI/Ollama) — no direct `ZAI.create()` calls (ADR-0004)
- 11 Zod output schemas for JSON-returning agents
- Prompt injection defense (`wrapUserInput` + `ANTI_INJECTION_PREFIX`)
- Per-tenant daily + monthly LLM cost budget with 80% warning alerts (socket-driven banner)
- Pipeline memory persistence in `Conversation` (24h TTL)
- Live eval harness (11 golden cases + VLM pipeline) — `scripts/eval-live.ts`, `scripts/eval-vlm.ts`
- LLM cost dashboard view (`/dashboard` LLM costs tab) with `byModel` breakdown
- Cost tracking API: `/api/llm/costs`, `/api/llm/costs/breakdown`, `/api/llm/budget`

### Added — Frontend (21 dashboard views)
- LLM costs view + governance escalations view (Sprint 8A)
- Admin incident management view (Sprint 12, `SPRINT-ADMIN-INCIDENTS-001`)
- Status page (`/status`) with uptime bars + incident history (Sprint 12)
- **SSR shell** for dashboard layout + server-side admin guard (Sprint 13, ADR-0016) — server component + client islands, improves LCP significantly
- Budget warning banner (socket-driven, 80% threshold)
- PWA (manifest + service worker + SVG icons)
- WCAG 2.1 AA (skip-link, h1, reduced-motion, ARIA, focus-visible)
- Dark mode (respects OS preference)
- Command palette (Cmd+K)
- Recharts lazy-load (bundle optimization)

### Added — Security hardening (Sprint 8D, `SPRINT-HARDENING-FINAL-001`)
- Input sanitization middleware (prototype pollution defense) — ADR-0014
- CORS allow-list (origin validation) — ADR-0015
- CSRF Origin check on mutations — ADR-0015
- Auth rate limiting (5/min on login, 60/min global)
- Webhook signature rotation grace period (Sprint 12, ADR-0018) — accepts both old + new secrets during rotation
- 19 cross-tenant auth bypass routes fixed (`requireTenantAccess`)
- TOTP verification real (not bypass)
- ACP bearer signature verification (ed25519)
- ENCRYPTION_KEY production guard
- CSP on HTML responses
- XSS fix in SSR JSON-LD (`safeJsonLd`)

### Added — Documentation (21 ADRs)
- 20 ADRs (Architecture Decision Records) + 1 README = 21 files in `docs/adr/`
  - 0001-multi-tenant-rbac · 0002-ap2-ucp-protocol-trinity · 0003-sqlite-to-postgresql
  - 0004-llm-adapter-pattern · 0005-webhook-always-200 · 0006-ed25519-for-mandates
  - 0007-own-stack-over-meta-business-agent · 0008-retention-automation · 0009-bullmq-vs-cron
  - 0010-capi-autofire-architecture · 0011-webhook-error-handling · 0012-multi-currency-latam
  - 0013-local-payment-methods · 0014-input-sanitization · 0015-cors-csrf-hardening
  - 0016-ssr-shell-pattern · 0017-fx-rate-persistence · 0018-webhook-signature-rotation
  - 0019-automated-refund-retracto · 0020-dian-alegra-integration
- OpenAPI 3.1 spec (93 paths, 136 operationIds, 20 tags, `x-tagGroups`) — ReDoc at `/docs` with tag-grouped sidebar
- API Cookbook (9 recipes)
- ERD auto-generated SVG + Mermaid (71 models)
- DR Runbook (RTO 4h, RPO 24h)
- CONTRIBUTING + STYLE_GUIDE + .editorconfig
- Docs INDEX with organized structure

### Added — Infrastructure
- Docker Compose (16 services: app, chat-service, postgres, redis, minio, nocodb, n8n, ollama, uptime-kuma, caddy, mailhog, **prometheus, alertmanager, grafana, loki, promtail**)
- CI with PostgreSQL (not just SQLite)
- Custom Caddy image with rate-limit plugin
- Real deploy.yml (Docker build + push + SSH deploy + health gate + rollback)
- Pre-commit hook (tsc + eslint)
- Conventional commits check
- `.dockerignore` (60MB → 5MB build context)
- `migration_lock.toml` → postgresql

### Added — Tests (891 tests, 48 files)
- 48 test files: 35 unit + 7 webhook + 4 middleware + 4 integration + 1 eval + 5 src/lib inline
- Webhook tests: mercado-pago, wompi, stripe, payu, pse, pix, whatsapp, meta (HMAC + idempotency)
- Middleware tests: cors, csrf, etag, cache-headers, rate-limit, hmac
- Integration tests: ap2-mandate-chain, ucp-checkout-flow, capi-autofire, whatsapp-inbound-flow
- Eval tests: golden-cases (11 LLM scenarios), VLM pipeline
- Compliance edge cases test (KYC, retracto, age-gate, CUFE)
- Webhook signature rotation test (old + new secret acceptance)
- Sanitize test (prototype pollution defense)
- Pipeline memory TTL test
- LLM budget test (daily + monthly thresholds)

### Added — WhatsApp Cloud API
- End-to-end functional WhatsApp Cloud API send + receive
- `hub.challenge` handshake verification
- CAPI auto-fire on payment (closed-loop attribution) — ADR-0010
- First Response Time (TTR) tracking
- Channel contribution margin service

### Changed
- Tenant switcher defaults to user's tenant (was first in list)
- AI agents use `role: 'system'` (was `role: 'assistant'`)
- LLM calls go through adapter (was direct ZAI.create)
- `.env` removed from git tracking
- `migration_lock.toml` → postgresql (was sqlite)
- `ignoreBuildErrors: false` (was true)
- `reactStrictMode: true` (was false)
- 24+ lint rules re-enabled as warnings
- WhatsApp webhook now parses messages (was stub)
- Commission POST race condition (upsert)
- 4 adapter crearPedido now atomic ($transaction)
- N+1 in monetization/overview services fixed
- Recharts lazy-loaded (bundle size optimization)
- OpenAPI spec upgraded to OAS 3.1 (was 3.0) — Redocly clean

### Fixed
- 11 security vulnerabilities (KYC bypass, identity-linking, ENCRYPTION_KEY, ACP bearer, cross-tenant credentials/commission/governance/consent, XSS JSON-LD, CSP)
- 6 infra blockers (.env in git, migration_lock, Caddyfile, .dockerignore, deploy.yml, start-server.sh)
- 4 AI critical issues (role:system, Zod validation, confidence real, prompt injection defense)
- 4 legal P0 (privacy/terms, retention, consent gate, age verification)
- DIAN invoicing generates CUFE AND submits via Alegra (was stub — Sprint 14)
- Retracto cancels order AND auto-refunds via payment adapter (was TODO — Sprint 14, ADR-0019)

### Removed
- `framer-motion` (unused dependency)
- 10 unused npm packages
- `ignoreBuildErrors` config
- `noImplicitAny: false` config
- Stub `submitToDian()` (replaced with Alegra-backed implementation)

## [0.2.0] - 2026-07-13

### Added
- Service layer (13 services, 76% API coverage)
- Socket.io chat-service with JWT auth + tenant room isolation
- Multi-provider LLM adapter (Zai/OpenAI/xAI/Ollama)
- BullMQ queue for CAPI + catalog sync
- LRU cache (1000 entries)
- Rate limiting (60/min global + per-route)
- Idempotency (in-memory + DB-backed)
- Sentry error tracking
- Pino structured logging
- Docker Compose (11 services)

### Changed
- 17 dashboard views with skeleton/error/empty states
- WCAG AA accessibility across all views
- Responsive 375px mobile
- Command palette (Cmd+K)

## [0.1.0] - 2026-06-15

### Added
- Initial release
- 26 AI agents (pre-sale, post-sale, intelligence, specialist)
- 4 payment gateways (MercadoPago, Wompi, Stripe, PayU)
- 6 webhooks with HMAC verification
- 4 brands (Saramantha, Majestic, Lovely, Reina)
- Multi-tenant RBAC (6 roles)
- NextAuth.js v4 + JWT
