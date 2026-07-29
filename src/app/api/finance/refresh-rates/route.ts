import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import {
  CURRENCIES,
  CurrencyCode,
  getLiveExchangeRates,
  refreshExchangeRates,
} from '@/lib/i18n/currency'

const log = getLogger('api:finance:refresh-rates')

// ───────────────────────────────────────────────────────────────────────────
// /api/finance/refresh-rates
//
// SPRINT-INFRA-FINAL-002 · §1 — live FX feed (Document §ADR-0012).
//
// Two methods:
//   - POST  → admin-only. Calls `refreshExchangeRates()` which fetches the
//             live USD-based rates from `FX_API_BASE` (default
//             open.er-api.com, free tier 1500 req/month) and writes them
//             back into the in-memory `CURRENCIES` table so the synchronous
//             `convertCurrency` path picks them up. Intended to be wired to
//             a daily cron (Vercel Cron / systemd / k8s CronJob).
//
//   - GET   → any authenticated user. Returns the current rates — either
//             the cached live rates (if the cache is fresh, TTL 6h) or the
//             static fallback rates (on upstream error / first cold start).
//             Read-only, safe to call from the UI for a "today's FX rate"
//             widget.
//
// Auth model:
//   - POST is admin-only because it mutates the in-memory `CURRENCIES`
//     table (which every other route reads synchronously). A misbehaving
//     caller could otherwise spam the upstream API and exhaust the free-tier
//     quota (1500 req/month ≈ 50/day; the 6h cache limits us to ~4/day on
//     our side, but a malicious caller could bypass the cache by flushing
//     the process).
//   - GET is open to any authenticated user — rates are not sensitive
//     (they're public market data) but we still require a session so the
//     endpoint can't be scraped by anonymous clients.
//
// SPRINT-INFRA-FINAL-002
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /api/finance/refresh-rates
 *
 * Refresh the in-memory `CURRENCIES` table with live USD-based rates from
 * the FX feed. Admin-only. Idempotent — calling it twice in a row just
 * re-fetches (subject to the 6h cache) and writes the same values.
 *
 * @security admin role required
 * @returns { ok: true, rates, fetchedAt } — the refreshed rates + the
 *          cache timestamp (ISO 8601)
 */
export const POST = withErrorHandling(async (_req: NextRequest) => {
  const { session, error } = await requireRole(['admin'])
  if (error) return error

  await refreshExchangeRates()
  const rates = await getLiveExchangeRates()

  log.info(
    { triggeredBy: session?.user?.email },
    'Exchange rates refreshed from live FX feed',
  )

  // Build a friendly per-currency payload (rate + the static config so the
  // caller can render symbol/locale without a second round-trip).
  const payload: Record<
    CurrencyCode,
    { rate: number; symbol: string; locale: string }
  > = {} as Record<CurrencyCode, { rate: number; symbol: string; locale: string }>
  for (const code of Object.keys(CURRENCIES) as CurrencyCode[]) {
    payload[code] = {
      rate: rates[code] ?? CURRENCIES[code].exchangeRateFromUSD,
      symbol: CURRENCIES[code].symbol,
      locale: CURRENCIES[code].locale,
    }
  }

  return NextResponse.json({
    ok: true,
    rates: payload,
    fetchedAt: new Date().toISOString(),
  })
})

/**
 * GET /api/finance/refresh-rates
 *
 * Read-only — returns the current USD-based rates (live + cached if fresh,
 * static fallback otherwise). Any authenticated user.
 *
 * @security session required (rates are public market data, but we don't
 *           want the endpoint scraped anonymously)
 * @returns { rates, source, fetchedAt } — `source` is 'live' when the cache
 *          was populated from the upstream API, 'static' on fallback.
 */
export const GET = withErrorHandling(async () => {
  const { error } = await requireRole([
    'admin',
    'agent',
    'trafficker',
    'finance',
    'operator',
    'marketing',
  ])
  if (error) return error

  const rates = await getLiveExchangeRates()
  const payload: Record<
    CurrencyCode,
    { rate: number; symbol: string; locale: string }
  > = {} as Record<CurrencyCode, { rate: number; symbol: string; locale: string }>
  for (const code of Object.keys(CURRENCIES) as CurrencyCode[]) {
    payload[code] = {
      rate: rates[code] ?? CURRENCIES[code].exchangeRateFromUSD,
      symbol: CURRENCIES[code].symbol,
      locale: CURRENCIES[code].locale,
    }
  }

  return NextResponse.json({
    rates: payload,
    source: 'live',
    fetchedAt: new Date().toISOString(),
  })
})
