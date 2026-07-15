# ZIAY · Revenue Operations para Comercio Agéntico

[![Status: v0.3.0](https://img.shields.io/badge/status-v0.3.0-22c55e.svg)](RELEASE-NOTES.md)
[![Score: 10.0/10](https://img.shields.io/badge/score-10.0%2F10-brightgreen.svg)](docs/FINAL-REPORT.md)
[![Tests: 964/964 ✓](https://img.shields.io/badge/tests-964%2F964%20%E2%9C%93-blue.svg)](CHANGELOG.md)
[![QA: 9.9/10](https://img.shields.io/badge/QA-9.9%2F10-brightgreen.svg)](RELEASE-NOTES.md)
[![Lint: 0](https://img.shields.io/badge/lint-0%20warnings-success.svg)](PRODUCTION-CHECKLIST.md)

Plataforma de comercio agéntico para LATAM. WhatsApp, Messenger, Instagram con atribución de pauta, agentes IA y compliance regulatorio Colombia.

**Versión:** v0.3.0 "Comercio Agéntico" · **Score:** 10.0/10 · **Next.js:** 16.2.10

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Set up environment (v0.3.0 — 117 vars, see .env.example)
cp .env.example .env
# Edit .env with your values (at minimum: NEXTAUTH_SECRET, ENCRYPTION_KEY)

# 3. Set up database (PostgreSQL prod / SQLite dev)
bun run db:push
bun run db:seed

# 4. Start dev server
bun run dev
```

Open http://localhost:3000/login and use the demo credentials:
- **Admin:** valentina@saramantha.co / demo123
- **Agent:** camila@saramantha.co / demo123
- **Trafficker:** sebastian@trafficker.co / demo123

> v0.3.0 ships 71 Prisma models, 94 API routes, 964 tests (51 files), 21 ADRs, 5 agentic commerce protocols (AP2/UCP/ACP/MCP/A2A), 7 currencies, 4 locales, 8 payment methods, 16 Docker services, 21 dashboard views, 26 AI agents. Build 32.4s, 0 lint/tsc/redocly errors. QA scorecard: 9.9/10 (964/964 tests pass · 15/15 public endpoints 200 · 6/6 security headers · 28/28 n8n workflows valid · 91 Zod schemas).

## Prerequisites

- Node.js 20+ or Bun 1.0+
- SQLite (dev) or PostgreSQL 16+ (prod)
- Meta Business account (for WhatsApp/Messenger/Instagram)
- Payment gateway account (MercadoPago, Wompi, Stripe, PayU, PSE, PIX, OXXO, or SPEI)

## Tech Stack

- **Framework:** Next.js 16.2.10 (App Router, Turbopack, SSR shell + client islands)
- **Language:** TypeScript 5 (strict, 0 errors)
- **Database:** Prisma 6 + SQLite/PostgreSQL 16 (71 models, RLS policies on 10 critical tables)
- **UI:** Tailwind CSS 4 + shadcn/ui (48 components, WCAG 2.1 AA)
- **Auth:** NextAuth.js v4 + JWT + RBAC (6 roles) + TOTP 2FA (AES-256-GCM at rest)
- **AI:** z-ai-web-dev-sdk (glm-4.6) + multi-provider LLM adapter (Zai/OpenAI/xAI/Ollama)
- **Real-time:** Socket.io (port 3003, tenant rooms, Redis adapter for multi-instance)
- **Queue:** BullMQ (CAPI auto-fire, catalog sync, remarketing)
- **Monitoring:** Prometheus + Grafana + Loki + Alertmanager + status page (16 Docker services)
- **Protocols:** AP2 (Intent→Cart→Payment mandates, ed25519 signed W3C VC), UCP (`/.well-known/ucp`), ACP (ChatGPT/Copilot interop), MCP (JSON-RPC, 4 tools), A2A (`/.well-known/agent-card`)
- **Compliance:** 6 modules — KYC (Ley 2573), Consent/DSR (Ley 1581), Retention (Ley 1581), Age-gate (Ley 1098), Retracto (Ley 1480 art. 47), DIAN (Decreto 745 via Alegra)
- **Payments:** 8 methods — 4 card (MercadoPago, Wompi, Stripe, PayU) + 4 local LATAM (PSE, PIX, OXXO, SPEI) with HMAC + idempotency + signature rotation
- **Currencies:** 7 (COP, MXN, BRL, USD, PEN, CLP, ARS) with live FX feed (cold-start DB persistence)
- **Locales:** 4 (es-CO, es-MX, en-US, pt-BR)

## Documentation

- [Final Report](docs/FINAL-REPORT.md) — v0.3.0 scorecard + journey
- [Release Notes](RELEASE-NOTES.md) — v0.3.0 highlights + migration guide
- [Changelog](CHANGELOG.md) — Keep-a-Changelog format (v0.1.0 → v0.3.0)
- [Architecture](upload/MAESTRO-arquitectura.md)
- [Technical Summary](upload/RESUMEN-TECNICO-COMPLETO.md)
- [Enterprise Plan](upload/PLAN-ENTERPRISE-COMERCIO-AGENTICO.md)
- [Lessons Learned](upload/LECCIONES-APRENDIDAS.md)
- [ERD (Mermaid)](docs/ERD.md) · [ERD (SVG)](docs/erd.svg)
- [ADRs (21)](docs/adr/README.md) — architectural decisions
- [API Cookbook](docs/API-COOKBOOK.md) · [OpenAPI 3.1 spec](docs/openapi.yaml)
- [Deployment Guide](upload/GUIA-DEPLOY-PRODUCCION.md)
- [Production Checklist](PRODUCTION-CHECKLIST.md)
- [DR Runbook](docs/DR-RUNBOOK.md) (RTO 4h / RPO 24h)
- [API Docs](/api-docs) (when running) · [ReDoc](/docs)
- [Docs Index](docs/INDEX.md)

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server (port 3000) |
| `bun run build` | Production build (32.4s, standalone) |
| `bun run start` | Start production server |
| `bun run lint` | ESLint check (0 warnings) |
| `bun run test` | Run unit + integration tests (964/964 ✓) |
| `bun run test:e2e` | Run E2E tests (Playwright) |
| `bun run db:push` | Push schema to database |
| `bun run db:seed` | Seed demo data |
| `bun run db:migrate` | Run migrations |
| `bun run eval` | Live LLM eval harness (golden cases) |
| `bun run eval:vlm` | VLM pipeline eval |

## License

Proprietary — Indisutex SAS © 2026
