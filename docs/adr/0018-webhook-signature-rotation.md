# ADR-0018: Webhook Signature Rotation with Grace Period

**Status:** Accepted
**Date:** 2026-07-15

## Context
When rotating webhook secrets (e.g., after a security incident), there's a window where in-flight webhooks are signed with the old secret but the server only knows the new secret. These webhooks would be rejected, causing missed payment notifications.

## Decision
Support `*_WEBHOOK_SECRET_OLD` environment variable for each of the 4 payment gateways (Stripe, MercadoPago, Wompi, PayU). The webhook route tries the current secret first; if verification fails AND the old secret is set, retry with the old secret. On success with old secret, log a warning for monitoring.

## Consequences
- **Positive:** Zero-downtime secret rotation
- **Positive:** No missed webhooks during rotation
- **Negative:** Two secrets are valid simultaneously (slightly less secure during rotation window)
- **Negative:** Must remember to remove `*_WEBHOOK_SECRET_OLD` after rotation completes
- **Mitigation:** Warning log on old-secret usage triggers alert to rotate completion
