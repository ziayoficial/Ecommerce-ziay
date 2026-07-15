# ADR-0010: CAPI Auto-fire on Payment (Fire-and-Forget)

**Status:** Accepted
**Date:** 2026-07-14

## Context
The "Comercio Agéntico" study §14.4 calls "closing the attribution loop with CAPI" the highest-impact improvement in 2026. The question: should CAPI firing be synchronous (in the webhook handler) or async (fire-and-forget)?

## Decision
Use fire-and-forget pattern: when a payment webhook marks an order as `paid`, call `fireCapiPurchaseEvent(orderId, tenantId).catch(() => {})` without awaiting. The function pre-creates `ConversionEvent` rows in `pending` status and enqueues a BullMQ `capi-fire` job.

## Consequences
- **Positive:** Webhook responds fast (<100ms) — no gateway timeout risk
- **Positive:** CAPI failures don't block payment processing
- **Positive:** BullMQ retries failed CAPI calls automatically
- **Negative:** If BullMQ is down, CAPI events stay in `pending` forever
- **Negative:** No immediate feedback if CAPI fails
- **Mitigation:** ConversionEvent rows in `pending` can be manually replayed; BullMQ dashboard shows failed jobs
