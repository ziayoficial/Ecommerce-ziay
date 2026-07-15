# ADR-0009: BullMQ vs Cron for Background Jobs

**Status:** Accepted
**Date:** 2026-07-14

## Context
ZIAY has two types of background work:
1. **Async + retryable** — CAPI firing, catalog sync, image processing
2. **Fixed schedule** — retention cleanup, daily cost recording, status checks

## Decision
- **BullMQ** for async + retryable jobs (CAPI fire, catalog sync) — provides retries, exponential backoff, dead letter queue
- **Cron endpoint** for fixed-schedule jobs (retention, cost recording) — simpler, no Redis dependency in dev, platform-agnostic (system cron / Vercel Cron / k8s CronJob)

Routing rule:
- If the job needs retries or is triggered by an event → BullMQ
- If the job runs on a fixed schedule and is idempotent → Cron

## Consequences
- **Positive:** BullMQ jobs get automatic retries + dead letter queue
- **Positive:** Cron jobs work without Redis (simpler dev setup)
- **Negative:** Two job systems to maintain
- **Negative:** No unified job dashboard
- **Mitigation:** Both write to AuditLog for observability
