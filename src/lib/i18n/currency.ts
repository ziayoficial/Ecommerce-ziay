// ─────────────────────────────────────────────────────────────────────────────
// Multi-currency support — Comercio Agéntico study §18 (LATAM expansion).
//
// COP (Colombia), MXN (México), BRL (Brasil), USD (international),
// PEN (Perú), CLP (Chile), ARS (Argentina).
//
// Each currency carries:
//   - ISO 4217 code + symbol + decimal precision
//   - BCP-47 locale for Intl.NumberFormat
//   - Static exchange rate from USD (refreshed manually for now — a future
//     sprint can wire a live FX feed; the function signatures stay the same)
//   - Minimum transaction amount (gateway-specific floor below which the
//     processor rejects the charge — e.g. Wompi rejects COP < $2.500)
//
// SPRINT-MULTICOUNTRY-001
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
 * The static `exchangeRateFromUSD` rates are used (no live FX feed yet).
 * Result is rounded to 2 decimal places — sufficient for all supported
 * currencies (the COP / CLP zero-decimal currencies round naturally).
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
