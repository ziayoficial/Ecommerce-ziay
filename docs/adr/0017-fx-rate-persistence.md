# ADR-0017: FxRate Persistence for Cold-Start FX Rates

**Status:** Accepted
**Date:** 2026-07-15

## Context
The live FX feed (`getLiveExchangeRates()`) caches rates in memory for 6 hours. On cold start (server restart, new instance), the cache is empty and falls back to static rates from `CURRENCIES` config — which may be outdated by weeks.

## Decision
Add a `FxRate` Prisma model that persists the last-known live rate per currency. On cold start (no in-memory cache), load from `FxRate` table instead of static rates. On each successful fetch, upsert rates to the table.

## Consequences
- **Positive:** Cold starts use recent rates (not weeks-old static values)
- **Positive:** Multi-instance deployments share the same rates (DB is shared)
- **Negative:** Extra DB read on cold start
- **Negative:** DB is the source of truth for rates (not the API) during outages
- **Mitigation:** FxRate rows have `fetchedAt` timestamp — stale rates can be detected
