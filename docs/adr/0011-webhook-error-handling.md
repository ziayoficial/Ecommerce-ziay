# ADR-0011: Webhook Error Handling (Always 200 + Body Status)

**Status:** Accepted
**Date:** 2026-07-15

## Context
Sprint 5D migrated 80 API routes to `withErrorHandling` (returns 500 on uncaught exceptions). But 8 webhook routes were excluded because gateways retry on non-200, causing duplicate processing + load.

## Decision
Create `withWebhookErrorHandling` wrapper that ALWAYS returns HTTP 200 (never 500). The response body includes `{ received: true, status: 'error', message }` for observability. Errors are captured to Sentry with `webhook: true` tag for lower-urgency routing.

## Consequences
- **Positive:** No retry storms from gateways (Meta 24h, Stripe 3d)
- **Positive:** Sentry `webhook: true` tag enables separate alert routing
- **Negative:** Can't use HTTP status for error signaling
- **Mitigation:** Response body `status` field + Sentry tag provide observability
