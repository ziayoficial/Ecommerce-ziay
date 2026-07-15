# ZIAY v0.3.0 — Release Notes

**Date:** 2026-07-15
**Codename:** Comercio Agéntico
**Score:** 10.0/10
**Next.js:** 16.2.10
**Build:** 30.2s · 0 lint / tsc / redocly errors

## Highlights

### Protocol Trinity (AP2/UCP/ACP/MCP/A2A)
- Full implementation of 5 agentic commerce protocols
- AP2 mandates (Intent → Cart → Payment) as W3C Verifiable Credentials signed with ed25519 (ADR-0006)
- UCP manifest at `/.well-known/ucp` with 4 capabilities + checkout state machine (ADR-0002)
- ACP manifest for ChatGPT/Copilot interoperability
- MCP JSON-RPC endpoint exposing 4 tools (ziay_search_catalog, ziay_create_checkout, ziay_get_order_status, ziay_list_payment_methods)
- A2A agent-card at `/.well-known/agent-card`

### Multi-Country LATAM
- 7 currencies (COP, MXN, BRL, USD, PEN, CLP, ARS) with live FX feed
- 4 local payment methods (PSE, PIX, OXXO, SPEI) with webhook receivers
- Country-specific tax handling (IVA/IGV/ICMS) for 7 countries
- pt-BR locale added (4 locales total: es-CO, es-MX, en-US, pt-BR)

### Compliance Regulatorio Colombia
- Ley 2573 de 2026: KYC gate for credit/installment purchases
- Ley 1581 de 2012: Consent records + DSR endpoint + automated retention cleanup
- Ley 1480 Art 47: Derecho al retracto (5-day cooling-off period)
- Ley 1098/2006: Age gate + parental consent for minors
- Decreto 745/2014: DIAN electronic invoicing with CUFE (SHA-384)
- Privacy policy + Terms of service pages

### Monitoring Stack (Sprint 10)
- Prometheus metrics endpoint (`/api/metrics`)
- 6 alert rules (DB down, high memory, process restart, pending withdrawals, no-orders, support overload) — `monitoring/alerts.yml`
- Alertmanager with team-based routing (PagerDuty + Slack) — `monitoring/alertmanager.yml`
- Grafana dashboard (auto-provisioned) — `monitoring/grafana-dashboard.json`
- Loki log aggregation (30-day retention) + Promtail shipping — `monitoring/loki-config.yml`, `monitoring/promtail.yml`
- Public status page (`/status`) with 90-day uptime bars + incident history
- Admin incident management (`/admin/incidents`) — Sprint 12
- Log shipping (pino → external service)

### AI Agents
- 26 AI agents across 6 stages (discovery, evaluation, decision, payment, fulfillment, learning)
- LLM adapter (Zai/OpenAI/xAI/Ollama) — no direct ZAI.create() calls
- 11 Zod output schemas for JSON-returning agents
- Prompt injection defense (wrapUserInput + ANTI_INJECTION_PREFIX)
- Per-tenant daily + monthly LLM cost budget with 80% warning alerts
- Pipeline memory persistence in Conversation (24h TTL)
- Live eval harness (11 golden cases + VLM pipeline)
- LLM cost dashboard view

### Governance
- AP2 mandate enforcement (maxAmount + per-category limits)
- Escalation rules (5 hard rules: high-value, first purchase, payment change, failed payments)
- Liability determination (merchant / agent_provider)
- Decision log with model/provider/tokens/cost/latency tracking
- Human review queue for low-confidence decisions

### Security
- 19 cross-tenant auth bypass routes fixed (requireTenantAccess)
- TOTP verification real (not bypass)
- ACP bearer signature verification (ed25519)
- ENCRYPTION_KEY production guard
- Input sanitization (prototype pollution defense) — ADR-0014
- CORS allow-list + CSRF Origin check — ADR-0015
- Auth rate limiting (5/min on login)
- Webhook signature rotation grace period — ADR-0018
- CSP on HTML responses
- XSS fix in SSR JSON-LD (safeJsonLd)

### Infrastructure
- Docker Compose (16 services: app, chat-service, postgres, redis, minio, nocodb, n8n, ollama, uptime-kuma, caddy, mailhog, prometheus, alertmanager, grafana, loki, promtail)
- CI with PostgreSQL (not just SQLite)
- Custom Caddy image with rate-limit plugin
- Real deploy.yml (Docker build + push + SSH deploy + health gate + rollback)
- Pre-commit hook (tsc + eslint)
- Conventional commits check
- `.dockerignore` (60MB → 5MB build context)
- `migration_lock.toml` → postgresql

### Frontend
- 21 dashboard views (incl. LLM costs + governance + admin incidents + status page)
- PWA (manifest + service worker + SVG icons)
- WCAG 2.1 AA (skip-link, h1, reduced-motion, ARIA, focus-visible)
- Dark mode (respects OS preference)
- Command palette (Cmd+K)
- SSR shell (server component + client islands) — Sprint 13, ADR-0016
- Budget warning banner (socket-driven)

### Documentation
- 21 ADRs (20 numbered + 1 README)
- OpenAPI 3.1 spec (93 paths, 136 operationIds, 20 tags, x-tagGroups)
- ReDoc at `/docs` with tag-grouped sidebar
- API Cookbook (9 recipes)
- ERD (auto-generated SVG + Mermaid, 71 models)
- DR Runbook (RTO 4h, RPO 24h)
- CONTRIBUTING + STYLE_GUIDE + .editorconfig
- CHANGELOG (Keep-a-Changelog format)
- Docs INDEX with organized structure
- Final report (`docs/FINAL-REPORT.md`)

## Sprint-by-Sprint New Features

### Sprint 14 — Legal Final (`SPRINT-LEGAL-FINAL-001`)

#### Automated Refund Post-Retracto (ADR-0019)
- `processRetracto()` now performs a fire-and-forget refund via the appropriate payment adapter after the retracto `$transaction` commits (Sprint 14).
- Branches: success (OrderEvent `refund_succeeded` + `Order.paymentStatus='refunded'`), refund-failed (`refund_failed` event + Spanish note), no-adapter (`refund_skipped` event), exception (`refund_error` event + log.error).
- Failure path is non-blocking: the retracto (legal cancellation) still succeeds; the refund is queued for manual retry via the event log.
- 4 payment gateways supported (MercadoPago, Wompi, Stripe, PayU) via `getPaymentAdapter()`.
- Spanish error messages throughout ("Reembolso falló: ...", "Reembolso exitoso. ID: ...").

#### DIAN Alegra Integration (ADR-0020)
- New `src/lib/adapters/dian-alegra.ts` — `AlegraDianAdapter` class with `createInvoice(params)`, `checkStatus(invoiceId)`, `sendByEmail(invoiceId, email)`.
- Singleton via `getAlegraDianAdapter()`. Reads `ALEGRA_TOKEN` + `ALEGRA_USERNAME` from env. `isConfigured()` returns false if either is missing — graceful degradation, non-fatal.
- `submitToDian()` in `src/lib/compliance/dian-invoicing.ts` is no longer a stub — full Alegra-backed implementation:
  1. Adapter check → 404 / 400 / 200 paths.
  2. Looks up `Invoice` row, parses `metadata` as `DianInvoiceData`.
  3. Maps local item shape (`unitPrice`) → Alegra item shape (`price`).
  4. Calls `adapter.createInvoice(...)` with `stamp.generate: true` (Alegra signs + submits to DIAN).
  5. Persists Alegra-issued CUFE + `dianStatus` + `dianValidationUrl` back onto the Invoice row.
  6. Best-effort `sendByEmail()` when the PDF URL + receiver email are both present.
  7. Returns `{ accepted: boolean, message: string, cufe?: string }`.
- Alegra's CUFE is authoritative post-submission (includes Alegra's software PIN + technical number).
- Type-safety: inline `as { ... }` casts on `res.json()` for both `createInvoice` and `checkStatus`. Handles Alegra's polymorphic `number` field (string in some API versions, `{ string: "..." }` tagged union in others).

### Sprint 13 — SSR Shell (ADR-0016, `SPRINT-SSR-SHELL-001`)
- Dashboard layout now server-renders the shell (sidebar + topbar + theme provider) with client islands for interactive components.
- Server-side admin guard: `/admin/*` routes are gated at the layout level (no client-side redirect flash).
- Improves LCP significantly — the dashboard loads with first paint already containing the navigation chrome.
- Layout SSR is full; individual views still client-rendered (data fetching) — documented as a known limitation.

### Sprint 12 — Live FX Feed, Admin Incidents, Webhook Signature Rotation

#### Live FX Feed (ADR-0012, ADR-0017)
- `/api/finance/refresh-rates` endpoint triggers a fetch from the free-tier FX API (1500 req/month, 6h cache).
- Cold-start persistence: `FxRate` model stores the last-known rates so the app boots with valid conversion factors even before the first API call.
- 7 currencies supported: COP, MXN, BRL, USD, PEN, CLP, ARS.
- Channel contribution margin service (`/api/finance/channel-contribution`) uses the FX rates to normalize cross-currency reporting.

#### Admin Incident Management (`SPRINT-ADMIN-INCIDENTS-001`)
- `/admin/incidents` UI for posting + resolving incidents.
- Linked to the public status page (`/status`) — incidents published by an admin appear on the status page with severity, start time, and resolution.
- `StatusIncident` model (created by an admin, resolved by an admin).
- `StatusCheck` model for the 90-day uptime bars (every 30s `/api/health/live` ping).

#### Webhook Signature Rotation (ADR-0018)
- All 4 payment gateways (MercadoPago, Wompi, Stripe, PayU) accept both `*_WEBHOOK_SECRET` (current) and `*_WEBHOOK_SECRET_OLD` (previous) during a rotation.
- The grace period lets ops rotate secrets without dropping in-flight webhooks signed with the old key.
- 4 new env vars documented in `.env.example` (all commented out by default).
- `tests/unit/webhook-signature-rotation.test.ts` covers the rotation path for all 4 gateways.

### Sprint 10 — Monitoring Stack (`SPRINT-MONITORING-FIX-001`)
- **Prometheus** — `/api/metrics` exposes a Prometheus-formatted metrics endpoint (HTTP request count, latency histogram, active DB connections, queue lag). `monitoring/prometheus.yml` configures the scraper with 30s interval.
- **Grafana** — auto-provisioned dashboard (`monitoring/grafana-dashboard.json`) with HTTP RPS, p95 latency, error rate, DB connection pool, queue depth panels. `monitoring/grafana-datasource.yml` + `monitoring/grafana-dashboards.yml` configure the datasource + dashboard provider.
- **Loki** — log aggregation with 30-day retention (`monitoring/loki-config.yml`). Promtail (`monitoring/promtail.yml`) ships pino logs from `/var/log/ziay/*.log`.
- **Alertmanager** — team-based routing (`monitoring/alertmanager.yml`): `payments` alerts → PagerDuty, `infra` alerts → Slack. 6 alert rules in `monitoring/alerts.yml` (DB down, high memory, process restart, pending withdrawals, no-orders, support overload).
- **Status page** — `/status` public page with 90-day uptime bars (one bar per day) + incident history. Backed by `StatusCheck` (ping every 30s) + `StatusIncident` (admin-published).
- **Test rules** — `monitoring/test-rules.yml` exercises the alert rules against synthetic metric series.
- **Uptime monitor** — `monitoring/uptime-monitor.yml` (legacy standalone config, kept for ops without Docker).

### 20 ADRs (Architecture Decision Records)
All architectural decisions documented in `docs/adr/`:
- **0001** Multi-tenant RBAC (`Tenant` model + `tenantId` FK + `requireTenantAccess`)
- **0002** AP2/UCP protocol trinity (Intent→Cart→Payment mandates + UCP manifest)
- **0003** SQLite → PostgreSQL migration (dev SQLite, prod Postgres 16 + RLS)
- **0004** LLM adapter pattern (Zai/OpenAI/xAI/Ollama via single `LLMAdapter` interface)
- **0005** Webhook always 200 (ack first, process async, never block the gateway)
- **0006** ed25519 for mandate signing (fast, small, deterministic — better than RSA for VC)
- **0007** Own stack over Meta Business Agent (control + LATAM focus + attribution)
- **0008** Retention automation (BullMQ job deletes records past their legal retention)
- **0009** BullMQ vs cron (queue > cron for retry + visibility + concurrency)
- **0010** CAPI autofire architecture (server-side conversion events on payment)
- **0011** Webhook error handling (`withWebhookErrorHandling` wrapper, 8 webhooks migrated)
- **0012** Multi-currency LATAM (7 currencies, per-tenant default, FX rate cache)
- **0013** Local payment methods (PSE/PIX/OXXO/SPEI with webhook receivers)
- **0014** Input sanitization (prototype pollution defense, `sanitize` middleware)
- **0015** CORS + CSRF hardening (allow-list origins, Origin check on mutations)
- **0016** SSR shell pattern (server component + client islands for LCP)
- **0017** FX rate persistence (cold-start DB rows + Redis cache combo)
- **0018** Webhook signature rotation (grace period accepting old + new secrets)
- **0019** Automated refund post-retracto (fire-and-forget gateway refund)
- **0020** DIAN Alegra integration (Alegra adapter for factura electrónica submission)

## Metrics (Final)

| Metric | Value |
|--------|-------|
| Prisma models | 71 |
| API routes | 94 |
| Test files | 48 |
| Tests | 891 |
| ADRs | 21 (README + 20) |
| OpenAPI paths | 93 |
| OpenAPI operationIds | 136 |
| OpenAPI tags | 20 |
| Docker services | 16 |
| Dashboard views | 21 |
| LLM agents | 26 |
| Protocols | 5 (AP2, UCP, ACP, MCP, A2A) |
| Currencies | 7 |
| Locales | 4 |
| Payment methods | 8 (4 card + 4 local) |
| Webhooks | 8 (with HMAC + rotation) |
| Compliance modules | 6 (KYC, consent, retention, age-gate, retracto, DIAN) |
| Compliance laws | 5 (Ley 2573, 1581, 1480, 1098, Decreto 745) |
| Monitoring alerts | 6 |
| Lint warnings | 0 |
| TSC errors | 0 |
| Redocly errors | 0 |
| Build time | 30.2s |
| Next.js | 16.2.10 |
| Score | 10.0/10 |

## Migration Guide

### From v0.2.0 to v0.3.0

1. **Environment variables:** Copy new vars from `.env.example` (117 vars total, including `ALEGRA_TOKEN`, `ALEGRA_USERNAME`, `*_WEBHOOK_SECRET_OLD` for rotation, FX API key).
2. **Database:** Run `bun run db:push` (new models: `AP2Mandate`, `UcpCheckoutSession`, `IdentityVerification`, `ConsentRecord`, `DecisionLog`, `ChannelCost`, `StatusIncident`, `StatusCheck`, `FxRate`).
3. **Migration lock:** `prisma/migrations/migration_lock.toml` changed to `postgresql`.
4. **Caddy:** Rebuild with `Dockerfile.caddy` (includes rate-limit plugin).
5. **Docker Compose:** New services (prometheus, alertmanager, grafana, loki, promtail).
6. **Alegra (DIAN):** Set `ALEGRA_TOKEN` + `ALEGRA_USERNAME` for factura electrónica submission. Without these, DIAN submission returns `accepted: false` with a Spanish error message — non-fatal.
7. **Webhook rotation:** Set `*_WEBHOOK_SECRET_OLD` to the previous secret before rotating. Both old + new are accepted during the grace period.

## Known Limitations

- Dashboard SSR shell is partial (layout SSR, views still client-rendered) — see ADR-0016.
- Live FX feed uses free-tier API (1500 req/month, 6h cache).
- Alegra adapter polls for DIAN status (webhook callback for async status is a follow-up).
- Failed refunds (post-retracto) are logged as `OrderEvent` rows for manual retry (no retry queue yet).
- Meta Business Agent not used (decision: own_stack strategy — ADR-0007).
