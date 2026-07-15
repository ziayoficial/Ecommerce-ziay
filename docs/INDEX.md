# ZIAY Documentation Index

> **v0.3.0** · Score 10.0/10 · 71 Prisma models · 94 API routes · 891 tests · 21 ADRs · 5 protocols (AP2/UCP/ACP/MCP/A2A) · 7 currencies · 4 locales · 8 payment methods · 16 Docker services · 26 AI agents.

## Top-Level Docs

- [README](../README.md) — Quick Start + Tech Stack + Status badges
- [Changelog](../CHANGELOG.md) — Keep-a-Changelog format (v0.1.0 → v0.3.0)
- [Release Notes](../RELEASE-NOTES.md) — v0.3.0 highlights + migration guide
- [Final Report](./FINAL-REPORT.md) — v0.3.0 scorecard + journey (10.0/10)
- [Production Checklist](../PRODUCTION-CHECKLIST.md) — pre-launch items + ✅ status
- [Contributing](../CONTRIBUTING.md) — dev setup + commit conventions

## Architecture

- [Master Architecture](../upload/MAESTRO-arquitectura.md) — design, stack, modeling, security, scaling
- [Technical Summary](../upload/RESUMEN-TECNICO-COMPLETO.md) — full technical deep dive
- [Enterprise Plan](../upload/PLAN-ENTERPRISE-COMERCIO-AGENTICO.md) — Revenue Operations positioning
- [ERD (auto-generated SVG)](./erd.svg) — 71 Prisma models
- [ERD (Mermaid)](./ERD.md) — hand-curated relationship diagram
- [ADRs (21)](./adr/README.md) — architectural decisions (README + 0001-0020)
- [Meta Agent Decision](./META-AGENT-DECISION.md) — own_stack vs Meta Business Agent

## ADRs (Architecture Decision Records) — 21 files

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
- [API Manifest](/api-docs) — JSON list of routes

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
| Prisma models | 71 |
| API routes | 94 |
| Tests | 891 (48 files) |
| ADRs | 21 |
| OpenAPI paths | 93 |
| Docker services | 16 |
| Dashboard views | 21 |
| LLM agents | 26 |
| Protocols | 5 (AP2/UCP/ACP/MCP/A2A) |
| Currencies | 7 |
| Locales | 4 |
| Payment methods | 8 |
| Lint / TSC / Redocly errors | 0 / 0 / 0 |
| Build time | 30.2s |
| Score | 10.0/10 |
