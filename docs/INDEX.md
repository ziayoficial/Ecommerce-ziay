# ZIAY Documentation Index

> **v0.4.0** · Fintech audit **8.8/10** (3 iterations: V1 5.5 → V2 7.7 → V3 8.8) · 78 Prisma models · 114 API routes · 986 unit tests + 52 E2E · 22 ADRs · 5 protocols (AP2/UCP/ACP/MCP/A2A) · 7 currencies · 4 locales · 8 functional payment methods (4 card + 4 local: PSE/PIX/OXXO/SPEI) · 16 Docker services · 27 AI agents · 35 RLS policies · CI 6/6 green.

## Top-Level Docs

- [README](../README.md) — Quick Start + Tech Stack + Status badges
- [Changelog](../CHANGELOG.md) — Keep-a-Changelog format (v0.1.0 → v0.4.0)
- [Release Notes](../RELEASE-NOTES.md) — v0.4.0 highlights + migration guide
- [Final Report](./FINAL-REPORT.md) — v0.4.0 scorecard + 3-iteration audit journey (8.8/10)
- [Production Checklist](../PRODUCTION-CHECKLIST.md) — pre-launch items + ✅ status
- [Contributing](../CONTRIBUTING.md) — dev setup + commit conventions + CI pipeline

## Architecture

- [Master Architecture](../upload/MAESTRO-arquitectura.md) — design, stack, modeling, security, scaling
- [Technical Summary](../upload/RESUMEN-TECNICO-COMPLETO.md) — full technical deep dive
- [Enterprise Plan](../upload/PLAN-ENTERPRISE-COMERCIO-AGENTICO.md) — Revenue Operations positioning
- [ERD (auto-generated SVG)](./erd.svg) — 78 Prisma models
- [ERD (Mermaid)](./ERD.md) — hand-curated relationship diagram
- [ADRs (22)](./adr/README.md) — architectural decisions (README + 0001-0021)
- [Meta Agent Decision](./META-AGENT-DECISION.md) — own_stack vs Meta Business Agent

## ADRs (Architecture Decision Records) — 22 files

- [README](./adr/README.md) — ADR index + format
- [0001 Multi-tenant RBAC](./adr/0001-multi-tenant-rbac.md)
- [0002 AP2/UCP Protocol Trinity](./adr/0002-ap2-ucp-protocol-trinity.md)
- [0003 SQLite → PostgreSQL](./adr/0003-sqlite-to-postgresql.md)
- [0004 LLM Adapter Pattern](./adr/0004-llm-adapter-pattern.md)
- [0005 Webhook Always 200](./adr/0005-webhook-always-200.md)
- [0006 ed25519 for Mandates](./adr/0006-ed25519-for-mandates.md)
- [0007 Own Stack over Meta Business Agent](./adr/0007-own-stack-over-meta-business-agent.md)
- [0008 Retention Automation](./adr/0008-retention-automation.md)
- [0009 BullMQ vs Cron](./adr/0009-bullmq-vs-cron.md)
- [0010 CAPI Autofire Architecture](./adr/0010-capi-autofire-architecture.md)
- [0011 Webhook Error Handling](./adr/0011-webhook-error-handling.md)
- [0012 Multi-currency LATAM](./adr/0012-multi-currency-latam.md)
- [0013 Local Payment Methods](./adr/0013-local-payment-methods.md)
- [0014 Input Sanitization](./adr/0014-input-sanitization.md)
- [0015 CORS + CSRF Hardening](./adr/0015-cors-csrf-hardening.md)
- [0016 SSR Shell Pattern](./adr/0016-ssr-shell-pattern.md)
- [0017 FX Rate Persistence](./adr/0017-fx-rate-persistence.md)
- [0018 Webhook Signature Rotation](./adr/0018-webhook-signature-rotation.md)
- [0019 Automated Refund Post-Retracto](./adr/0019-automated-refund-retracto.md)
- [0020 DIAN Alegra Integration](./adr/0020-dian-alegra-integration.md)
- [0021 Escrow Design](./adr/0021-escrow-design.md)

## Audit Reports (v0.4.0 cycle)

- [Fintech Audit V3 (Final)](../public/presentaciones/AUDITORIA-FINTECH-V3-FINAL.md) — score 8.8/10, 28-item backlog closed
- [Fintech Audit V2](../public/presentaciones/AUDITORIA-FINTECH-V2.md) — score 7.7/10, mid-cycle
- [Fintech Audit V1](../public/presentaciones/AUDITORIA-FINTECH.md) — score 5.5/10, baseline
- [Full Security + Code + Test Audit](../public/presentaciones/AUDITORIA-FULL-SECURITY-CODE-TEST.md) — non-fintech dimensions
- [Full UX + SEO + Docs + Deploy Audit](../public/presentaciones/AUDITORIA-FULL-UX-SEO-DOCS-DEPLOY.md) — UX/SEO/docs/deploy

## Onboarding

- [Getting Started (Clients)](../upload/GUIA-ONBOARDING-CLIENTES.md)
- [Operator Onboarding](../upload/ONBOARDING-COMPLETO.md)
- [API Cookbook](./API-COOKBOOK.md) — 9 recipes
- [Style Guide](./STYLE_GUIDE.md)

## Deployment

- [Deploy Guide](../upload/GUIA-DEPLOY-PRODUCCION.md)
- [DR Runbook](./DR-RUNBOOK.md) — RTO 4h, RPO 24h
- [Lessons Learned](../upload/LECCIONES-APRENDIDAS.md)

## Research

- [Market Research](../upload/INVESTIGACION-MERCADO-COMERCIO-AGENTICO.md)
- [Agent Platform Research](../upload/INVESTIGACION-PLATAFORMA-AGENTES-IA.md)

## API

- [OpenAPI 3.1 Spec](./openapi.yaml) — 93 paths, 136 operationIds, 20 tags
- [API Docs (ReDoc)](/docs) — tag-grouped sidebar
- [API Manifest](/api-docs) — JSON list of routes (114 total)

## Compliance

- [Privacy Policy](/privacy) — Ley 1581
- [Terms of Service](/terms)
- [Legal Hub](/legal) — Ley 2573, 1581, 1480, 1098, Decreto 745
- [Parental Consent](/compliance/parental-consent) — Ley 1098
- [Status Page](/status) — 90-day uptime + incidents

## Monitoring

- [Prometheus config](../monitoring/prometheus.yml)
- [Alertmanager config](../monitoring/alertmanager.yml)
- [Grafana dashboard](../monitoring/grafana-dashboard.json)
- [Loki config](../monitoring/loki-config.yml)
- [Promtail config](../monitoring/promtail.yml)
- [Alert rules](../monitoring/alerts.yml)

## Status

| Metric | Value |
|--------|-------|
| Prisma models | 78 (was 71) |
| API routes | 114 (was 94) |
| Unit tests | 986 (51 files, was 964) |
| E2E tests (Playwright) | 52 passing |
| ADRs | 22 (README + 0001-0021) |
| OpenAPI paths | 93 |
| Docker services | 16 |
| Dashboard views | 16 (was 14) |
| LLM agents | 27 (was 26) |
| Protocols | 5 (AP2/UCP/ACP/MCP/A2A) |
| Currencies | 7 |
| Locales | 4 |
| Payment methods | 8 functional (4 card + 4 local: PSE/PIX/OXXO/SPEI) |
| Anti-fraud service | Full (velocity, blocklist, OFAC, 3DS, CVV/AVS) |
| Credential encryption | AES-256-GCM at-rest |
| RLS policies | 35 (was 10) |
| Lint / TSC / Redocly errors | 0 / 0 / 0 (was 58 TSC errors before remediation) |
| CI pipeline | 6/6 green (lint, typecheck, unit, openapi, build, e2e) |
| Build time | 32.4s |
| Fintech audit score | 8.8/10 (3 iterations) |
