# Changelog

All notable changes to ZIAY are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- AP2/UCP/ACP/MCP/A2A protocol support (5 protocols)
- Multi-currency (COP, MXN, BRL, USD, PEN, CLP, ARS)
- Local payment methods (PSE, PIX, OXXO, SPEI)
- Ley 2573 KYC gate + Ley 1581 consent/DSR + age gate
- WhatsApp Cloud API send + receive (end-to-end functional)
- CAPI auto-fire on payment (closed-loop attribution)
- First Response Time (TTR) tracking
- Channel contribution margin service
- Governance: mandate enforcement + escalation queue + liability
- Monitoring: Prometheus metrics + web vitals + DR runbook
- PWA manifest + service worker
- Privacy policy + Terms of service pages

### Changed
- Tenant switcher defaults to user's tenant (was first in list)
- AI agents use `role: 'system'` (was `role: 'assistant'`)
- LLM calls go through adapter (was direct ZAI.create)
- `.env` removed from git tracking
- `migration_lock.toml` → postgresql (was sqlite)
- `ignoreBuildErrors: false` (was true)
- `reactStrictMode: true` (was false)
- 24+ lint rules re-enabled as warnings

### Fixed
- 11 security vulnerabilities (KYC bypass, identity-linking, ENCRYPTION_KEY, ACP bearer, cross-tenant credentials/commission/governance/consent, XSS JSON-LD, CSP)
- 6 infra blockers (.env in git, migration_lock, Caddyfile, .dockerignore, deploy.yml, start-server.sh)
- 4 AI critical issues (role:system, Zod validation, confidence real, prompt injection defense)
- 4 legal P0 (privacy/terms, retention, consent gate, age verification)
- WhatsApp webhook now parses messages (was stub)
- Commission POST race condition (upsert)
- 4 adapter crearPedido now atomic ($transaction)
- N+1 in monetization/overview services

### Removed
- `framer-motion` (unused dependency)
- 10 unused npm packages
- `ignoreBuildErrors` config
- `noImplicitAny: false` config

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
