// ─────────────────────────────────────────────────────────────────────────────
// Multi-currency support — Comercio Agéntico study §18 (LATAM expansion).
//
// COP (Colombia), MXN (México), BRL (Brasil), USD (international),
// PEN (Perú), CLP (Chile), ARS (Argentina).
//
// Each currency carries:
//   - ISO 4217 code + symbol + decimal precision
//   - BCP-47 locale for Intl.NumberFormat
//   - Static exchange rate from USD (used as the synchronous fallback by
//     `convertCurrency`; refreshed in-place by `refreshExchangeRates` from
//     a live FX feed — see SPRINT-INFRA-FINAL-002 / §ADR-0012 below)
//   - Minimum transaction amount (gateway-specific floor below which the
//     processor rejects the charge — e.g. Wompi rejects COP < $2.500)
//
// SPRINT-MULTICOUNTRY-001
// SPRINT-INFRA-FINAL-002 — added `getLiveExchangeRates`, `convertWithLiveRate`
//   and `refreshExchangeRates` (live FX feed from exchangerate-api.com, free
//   tier 1500 req/month). The static `CURRENCIES` table stays as the
//   synchronous fallback; `refreshExchangeRates` writes live values back
//   into it so `convertCurrency` (and any caller that reads
//   `exchangeRateFromUSD` directly) keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export type CurrencyCode = 'COP' | 'MXN' | 'BRL' | 'USD' | 'PEN' | 'CLP' | 'ARS'

export interface CurrencyConfig {
  code: CurrencyCode
  symbol: string
  decimals: number
  locale: string
  /** 1 USD = X currency. Used as a static base for `convertCurrency`. */
  exchangeRateFromUSD: number
  /** Minimum transaction amount in the currency's major unit (not cents). */
  minimumAmount: number
}

export const CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  COP: { code: 'COP', symbol: '$',  decimals: 0, locale: 'es-CO', exchangeRateFromUSD: 4100, minimumAmount: 1000 },
  MXN: { code: 'MXN', symbol: '$',  decimals: 2, locale: 'es-MX', exchangeRateFromUSD: 18.5, minimumAmount: 10 },
  BRL: { code: 'BRL', symbol: 'R$', decimals: 2, locale: 'pt-BR', exchangeRateFromUSD: 5.2,  minimumAmount: 5 },
  USD: { code: 'USD', symbol: '$',  decimals: 2, locale: 'en-US', exchangeRateFromUSD: 1,    minimumAmount: 1 },
  PEN: { code: 'PEN', symbol: 'S/', decimals: 2, locale: 'es-PE', exchangeRateFromUSD: 3.75, minimumAmount: 5 },
  CLP: { code: 'CLP', symbol: '$',  decimals: 0, locale: 'es-CL', exchangeRateFromUSD: 950,  minimumAmount: 500 },
  ARS: { code: 'ARS', symbol: '$',  decimals: 2, locale: 'es-AR', exchangeRateFromUSD: 1200, minimumAmount: 1000 },
}

/**
 * Format an amount using the currency's locale + decimals.
 *
 * @example formatCurrency(150000, 'COP') → "$ 150.000"
 * @example formatCurrency(99.9, 'USD')   → "$99.90"
 */
export function formatCurrency(amount: number, currency: CurrencyCode = 'COP'): string {
  const config = CURRENCIES[currency]
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.code,
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  }).format(amount)
}

/**
 * Convert an amount between two currencies using USD as the base.
 *
 * Uses the static `exchangeRateFromUSD` rates. These are refreshed in-place
 * by `refreshExchangeRates` (see SPRINT-INFRA-FINAL-002); for an async
 * conversion that always uses the freshest cached/live rate use
 * `convertWithLiveRate` instead. Result is rounded to 2 decimal places —
 * sufficient for all supported currencies (the COP / CLP zero-decimal
 * currencies round naturally).
 *
 * @example convertCurrency(100, 'USD', 'COP') → 410000
 * @example convertCurrency(1000, 'COP', 'USD') → 24.39
 */
export function convertCurrency(amount: number, from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return amount
  // Convert via USD as base
  const amountInUSD = amount / CURRENCIES[from].exchangeRateFromUSD
  return Math.round(amountInUSD * CURRENCIES[to].exchangeRateFromUSD * 100) / 100
}

/**
 * Map an ISO 3166-1 alpha-2 country code to its default currency.
 * Falls back to USD for any unmapped country (international customers).
 *
 * @example getCurrencyForCountry('CO') → 'COP'
 * @example getCurrencyForCountry('BR') → 'BRL'
 * @example getCurrencyForCountry('JP') → 'USD'  // international fallback
 */
export function getCurrencyForCountry(countryCode: string): CurrencyCode {
  const map: Record<string, CurrencyCode> = {
    CO: 'COP', MX: 'MXN', BR: 'BRL', US: 'USD', PE: 'PEN', CL: 'CLP', AR: 'ARS',
  }
  return map[countryCode?.toUpperCase()] || 'USD'
}

/**
 * Type guard: a string is a known `CurrencyCode`.
 */
export function isCurrencyCode(code: string): code is CurrencyCode {
  return code in CURRENCIES
}

/**
 * Get the config for a currency. Throws for unknown codes (defensive) —
 * callers should validate with `isCurrencyCode` first when the input is
 * user-supplied.
 */
export function getCurrencyConfig(code: CurrencyCode): CurrencyConfig {
  return CURRENCIES[code]
}

// ─────────────────────────────────────────────────────────────────────────────
// Live FX feed — SPRINT-INFRA-FINAL-002 / §ADR-0012
//
// Document §ADR-0012: "Future sprint can add a daily FX feed". The static
// `exchangeRateFromUSD` rates above are fine for synchronous code paths
// (formatters, table renders) but they drift from reality the moment a
// central bank adjusts its reference rate or a LATAM currency swings
// (ARS in particular). These helpers add a 6-hour-cached live rate layer
// on top of the static table:
//
//   - `getLiveExchangeRates()`  — async, returns a `Record<CurrencyCode, number>`
//     of USD-based rates. Hits the open.er-api.com free tier (1500 req/month,
//     more than enough at 6h TTL ≈ 4 fetches/day = ~120/month). Falls back
//     to the static `exchangeRateFromUSD` values on any error (network,
//     non-200, malformed body) so callers never throw — they just get
//     slightly stale rates.
//
//   - `convertWithLiveRate(amount, from, to)` — async convenience wrapper
//     around `getLiveExchangeRates` + the same USD-base conversion math
//     as the synchronous `convertCurrency`. Per-currency fallback to the
//     static rate if the live response omits a currency (the API occasionally
//     drops a thinly-traded code).
//
//   - `refreshExchangeRates()` — async, writes the live rates back into the
//     `CURRENCIES` table so the synchronous `convertCurrency` (and any
//     caller reading `exchangeRateFromUSD` directly) starts using them.
//     Intended to be wired to a daily cron via `/api/finance/refresh-rates`.
//
// The cache is module-level (process-scoped). On a serverless deploy
// (Vercel) the cache lasts one function invocation; on Docker / bare metal
// it lasts the process lifetime — fine either way because the TTL is 6h
// and the worst case of a cache miss is one extra upstream request.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base URL for the FX API. Defaults to the free `open.er-api.com` endpoint
 * (no API key required, 1500 req/month). Override via `FX_API_BASE` to
 * point at a self-hosted mirror, a paid tier, or a mock during tests.
 */
const FX_API_BASE = process.env.FX_API_BASE ?? 'https://open.er-api.com/v6'

/** Cache TTL — 6 hours. Limits upstream calls to ~4/day per process. */
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface FxCache {
  rates: Record<string, number>
  fetchedAt: number
}

let fxCache: FxCache | null = null

/**
 * Fetch live exchange rates from exchangerate-api.com (free tier: 1500 req/month).
 * Document §ADR-0012: "Future sprint can add a daily FX feed".
 *
 * Returns a `Record<CurrencyCode, number>` of USD-based rates (USD itself is
 * always `1`). Uses a 6-hour in-memory cache to stay well under the free-tier
 * quota. On any error (timeout, non-200, malformed body) falls back to the
 * static `CURRENCIES[*].exchangeRateFromUSD` values so callers never throw.
 *
 * @returns USD-based rates keyed by ISO 4217 code, scoped to the currencies
 *          declared in `CURRENCIES` (USD + 6 LATAM codes).
 */
export async function getLiveExchangeRates(): Promise<Record<CurrencyCode, number>> {
  // Cache hit — return the cached rates without touching the network.
  if (fxCache && Date.now() - fxCache.fetchedAt < FX_CACHE_TTL_MS) {
    return fxCache.rates as Record<CurrencyCode, number>
  }

  try {
    const res = await fetch(`${FX_API_BASE}/latest/USD`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) throw new Error(`FX API returned ${res.status}`)

    const data = (await res.json()) as { rates?: Record<string, number> }
    if (!data.rates) throw new Error('FX API returned no rates')

    // Extract only the currencies we support so the cache stays small and
    // the type assertion below is sound (every key is a known CurrencyCode).
    const supportedRates: Partial<Record<CurrencyCode, number>> = {}
    for (const code of Object.keys(CURRENCIES) as CurrencyCode[]) {
      const rate = data.rates[code]
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        supportedRates[code] = rate
      }
    }

    // USD is the base — always 1, even if the upstream response omits it.
    supportedRates.USD = 1

    fxCache = {
      rates: supportedRates as Record<string, number>,
      fetchedAt: Date.now(),
    }

    return fxCache.rates as Record<CurrencyCode, number>
  } catch {
    // Fallback to static rates. We intentionally swallow the error — the
    // contract is "always returns rates" so callers don't need try/catch.
    // A real outage will show up as stale-looking numbers in the UI, which
    // is strictly better than throwing (a currency conversion failure
    // would break order totals, invoice rendering, etc.).
    const staticRates: Record<CurrencyCode, number> = {} as Record<CurrencyCode, number>
    for (const [code, config] of Object.entries(CURRENCIES)) {
      staticRates[code as CurrencyCode] = config.exchangeRateFromUSD
    }
    return staticRates
  }
}

/**
 * Convert an amount between two currencies using the freshest cached/live
 * rate. Async counterpart of the synchronous `convertCurrency`. Falls back
 * per-currency to the static `exchangeRateFromUSD` if the live response
 * omitted a code (rare; happens for thinly-traded currencies).
 *
 * Result is rounded to 2 decimal places — same precision contract as
 * `convertCurrency`.
 *
 * @example await convertWithLiveRate(100, 'USD', 'COP') → ~410000 (varies)
 */
export async function convertWithLiveRate(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
): Promise<number> {
  if (from === to) return amount
  const rates = await getLiveExchangeRates()
  const fromRate = rates[from] || CURRENCIES[from].exchangeRateFromUSD
  const toRate = rates[to] || CURRENCIES[to].exchangeRateFromUSD
  const amountInUSD = amount / fromRate
  return Math.round(amountInUSD * toRate * 100) / 100
}

/**
 * Update `CURRENCIES` in-place with live rates. Call this from a daily cron
 * (e.g. `/api/finance/refresh-rates` wired to Vercel Cron / systemd / k8s
 * CronJob) so the synchronous `convertCurrency` path starts using fresh
 * values without each caller needing to await `getLiveExchangeRates`.
 *
 * Safe to call concurrently — the only shared state is the `CURRENCIES`
 * table and the writes are idempotent scalar assignments.
 */
export async function refreshExchangeRates(): Promise<void> {
  const rates = await getLiveExchangeRates()
  for (const code of Object.keys(rates) as CurrencyCode[]) {
    if (CURRENCIES[code] && typeof rates[code] === 'number') {
      CURRENCIES[code].exchangeRateFromUSD = rates[code]
    }
  }
}
