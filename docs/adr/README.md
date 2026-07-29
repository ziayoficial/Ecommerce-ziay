# Architecture Decision Records

| # | Title | Date | Status |
|---|-------|------|--------|
| 0001 | Multi-tenant RBAC with NextAuth JWT | 2026-06-15 | Accepted |
| 0002 | AP2/UCP/ACP Protocol Trinity | 2026-07-13 | Accepted |
| 0003 | SQLite for Dev, PostgreSQL for Prod | 2026-06-15 | Accepted |
| 0004 | Multi-provider LLM Adapter | 2026-07-14 | Accepted |
| 0005 | Webhooks Always Return 200 | 2026-07-13 | Accepted |
| 0006 | ed25519 for AP2 Mandate Signing | 2026-07-13 | Accepted |
| 0007 | Own Stack Over Meta Business Agent | 2026-07-14 | Accepted |
| 0008 | Automated Data Retention (Ley 1581) | 2026-07-14 | Accepted |
| 0009 | BullMQ vs Cron for Background Jobs | 2026-07-14 | Accepted |
| 0010 | CAPI Auto-fire on Payment (Fire-and-Forget) | 2026-07-14 | Accepted |
| 0011 | Webhook Error Handling (Always 200 + Body Status) | 2026-07-15 | Accepted |
| 0012 | Multi-Currency LATAM Support | 2026-07-15 | Accepted |
| 0013 | Local Payment Methods (PSE/PIX/OXXO/SPEI) | 2026-07-15 | Accepted |
| 0014 | Input Sanitization Strategy | 2026-07-15 | Accepted |
| 0015 | CORS + CSRF Hardening | 2026-07-15 | Accepted |
| 0016 | SSR Shell with Client Islands for Dashboard | 2026-07-15 | Accepted |
| 0017 | FxRate Persistence for Cold-Start FX Rates | 2026-07-15 | Accepted |
| 0018 | Webhook Signature Rotation with Grace Period | 2026-07-15 | Accepted |
| 0019 | Automated Refund Post-Retracto | 2026-07-15 | Accepted |
| 0020 | DIAN Electronic Invoicing via Alegra | 2026-07-15 | Accepted |

## How to create a new ADR

1. Copy `0001-multi-tenant-rbac.md` as a template
2. Number sequentially (0008, 0009, ...)
3. Fill in Context → Decision → Consequences
4. Set status to `Proposed`
5. After review, set to `Accepted` or `Rejected`
