# ADR-0012: Multi-Currency LATAM Support

**Status:** Accepted
**Date:** 2026-07-15

## Context
ZIAY started Colombia-only (COP). LATAM expansion requires MXN (México), BRL (Brasil), PEN (Perú), CLP (Chile), ARS (Argentina), USD (international).

## Decision
Implement `CURRENCIES` config in `src/lib/i18n/currency.ts` with 7 currencies, each with symbol, decimals, locale, exchange rate from USD, and minimum amount. Use `formatCurrency(amount, currency)` + `convertCurrency(amount, from, to)` for display + conversion. Tenant + Order + Product each have a `currency` field (default COP).

## Consequences
- **Positive:** LATAM expansion-ready
- **Positive:** Exchange rates are configurable (not hardcoded to a feed)
- **Negative:** Exchange rates are static (manual update) — no live FX feed
- **Negative:** Historical orders keep their original currency (no retroactive conversion)
- **Mitigation:** Future sprint can add a daily FX feed (exchangerate-api.com)
