# ADR-0005: Webhooks Always Return 200

**Status:** Accepted
**Date:** 2026-07-13

## Context
Payment gateways (Stripe, MP, Wompi, PayU) and messaging platforms (Meta, WhatsApp) retry webhooks on non-200 responses. Stripe retries for 3 days, Meta for 24 hours. Retries cause duplicate processing + load.

## Decision
All webhook handlers ALWAYS return HTTP 200, even on errors. The response body includes a `status` field (`invalid_signature`, `duplicate`, `error`, `processed`) for observability. Errors are captured to Sentry + logged.

## Consequences
- **Positive:** No retry storms from gateways
- **Positive:** Clean separation between HTTP status (always 200) and business status (in body)
- **Negative:** Can't use HTTP status codes for error signaling
- **Negative:** Monitoring must check response body, not just status code
- **Mitigation:** `withWebhookErrorHandling` wrapper ensures consistency + Sentry `webhook: true` tag for routing
