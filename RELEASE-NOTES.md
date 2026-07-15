# ZIAY v0.3.0 — Release Notes

**Date:** Julio 2026
**Codename:** Comercio Agéntico

## Highlights

### Protocol Trinity (AP2/UCP/ACP/MCP/A2A)
- Full implementation of 5 agentic commerce protocols
- AP2 mandates (Intent → Cart → Payment) as W3C Verifiable Credentials signed with ed25519
- UCP manifest at `/.well-known/ucp` with 4 capabilities + checkout state machine
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

### Monitoring Stack
- Prometheus metrics endpoint (`/api/metrics`)
- 6 alert rules (DB down, high memory, process restart, pending withdrawals, no-orders, support overload)
- Alertmanager with team-based routing (PagerDuty + Slack)
- Grafana dashboard (auto-provisioned)
- Loki log aggregation (30-day retention)
- Public status page (`/status`) with 90-day uptime bars + incident history
- Admin incident management (`/admin/incidents`)
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
- Input sanitization (prototype pollution defense)
- CORS allow-list + CSRF Origin check
- Auth rate limiting (5/min on login)
- Webhook signature rotation grace period
- CSP on HTML responses
- XSS fix in SSR JSON-LD (safeJsonLd)

### Infrastructure
- Docker Compose (16 services: app, chat-service, postgres, redis, prometheus, alertmanager, grafana, loki, promtail, caddy, etc.)
- CI with PostgreSQL (not just SQLite)
- Custom Caddy image with rate-limit plugin
- Real deploy.yml (Docker build + push + SSH deploy + health gate + rollback)
- Pre-commit hook (tsc + eslint)
- Conventional commits check
- `.dockerignore` (60MB → 5MB build context)
- `migration_lock.toml` → postgresql

### Frontend
- 21 dashboard views (incl. LLM costs + governance)
- PWA (manifest + service worker + SVG icons)
- WCAG 2.1 AA (skip-link, h1, reduced-motion, ARIA, focus-visible)
- Dark mode (respects OS preference)
- Command palette (Cmd+K)
- SSR shell (server component + client islands)
- Budget warning banner (socket-driven)

### Documentation
- 18 ADRs (Architecture Decision Records)
- OpenAPI 3.1 spec (93 paths, 20 tags, x-tagGroups, operationId)
- ReDoc at `/docs` with tag-grouped sidebar
- API Cookbook (9 recipes)
- ERD (auto-generated SVG, 70 models)
- DR Runbook (RTO 4h, RPO 24h)
- CONTRIBUTING + STYLE_GUIDE + .editorconfig
- CHANGELOG (Keep-a-Changelog format)
- Docs INDEX with organized structure

## Metrics

| Metric | Value |
|--------|-------|
| Prisma models | 70 |
| API routes | 94 |
| Test files | 44 |
| Tests | 839 |
| ADRs | 18 |
| OpenAPI paths | 93 |
| Docker services | 16 |
| Dashboard views | 21 |
| LLM agents | 26 |
| Protocols | 5 (AP2, UCP, ACP, MCP, A2A) |
| Currencies | 7 |
| Locales | 4 |
| Payment methods | 8 (4 card + 4 local) |
| Webhooks | 8 (with HMAC + rotation) |
| Lint warnings | 0 |
| Build time | 34.8s |

## Migration Guide

### From v0.2.0 to v0.3.0

1. **Environment variables:** Copy new vars from `.env.example` (117 vars total)
2. **Database:** Run `bun run db:push` (8 new models: AP2Mandate, UcpCheckoutSession, IdentityVerification, ConsentRecord, DecisionLog, ChannelCost, StatusIncident, StatusCheck, FxRate)
3. **Migration lock:** `prisma/migrations/migration_lock.toml` changed to `postgresql`
4. **Caddy:** Rebuild with `Dockerfile.caddy` (includes rate-limit plugin)
5. **Docker Compose:** New services (prometheus, alertmanager, grafana, loki, promtail)

## Known Limitations

- Dashboard SSR shell is partial (layout SSR, views still client-rendered)
- Live FX feed uses free-tier API (1500 req/month, 6h cache)
- DIAN invoicing generates CUFE but doesn't submit to DIAN (provider integration needed)
- Retracto cancels order but doesn't auto-refund (per-gateway refund TODO)
- Meta Business Agent not used (decision: own_stack strategy)
