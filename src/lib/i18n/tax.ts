// ─────────────────────────────────────────────────────────────────────────────
// Country-specific tax handling — Comercio Agéntico study §12 (legal) + §18
// (LATAM expansion).
//
// Each supported country carries:
//   - VAT name (IVA / IGV / ICMS / Sales Tax)
//   - VAT rate (0.19 = 19%)
//   - Whether VAT applies to shipping
//   - Optional reduced rates (food / books)
//   - Exempt categories (alimentos_basicos, medicamentos, libros, …)
//
// `calculateTax` produces a `TaxBreakdown` — subtotal, tax amount, shipping,
// shipping tax, total, exempt items — that the checkout flow can persist as
// JSON on `Order.taxBreakdown` for audit + reconciliation.
//
// SPRINT-MULTICOUNTRY-001
// ─────────────────────────────────────────────────────────────────────────────

export interface TaxConfig {
  countryCode: string
  /** Display name of the consumption tax (IVA | ITBMS | ICMS | IGV | Sales Tax). */
  vatName: string
  /** 0.19 = 19%. 0 for non-VAT countries (e.g. US Sales Tax, handled per-state). */
  vatRate: number
  /** Whether VAT is charged on the shipping line. */
  appliesToShipping: boolean
  /** Optional reduced rate for food/medicine (e.g. Argentina 10.5%). */
  foodReducedRate?: number
  /** Optional reduced rate for books. */
  booksReducedRate?: number
  /** Item categories that are exempt from VAT entirely. */
  exemptCategories: string[]
}

export const TAX_CONFIGS: Record<string, TaxConfig> = {
  CO: {
    countryCode: 'CO', vatName: 'IVA', vatRate: 0.19,
    appliesToShipping: true,
    exemptCategories: ['alimentos_basicos', 'medicamentos'],
  },
  MX: {
    countryCode: 'MX', vatName: 'IVA', vatRate: 0.16,
    appliesToShipping: true,
    exemptCategories: ['alimentos', 'medicamentos', 'libros'],
  },
  BR: {
    countryCode: 'BR', vatName: 'ICMS', vatRate: 0.17, // varies by state
    appliesToShipping: true,
    exemptCategories: ['alimentos_basicos'],
  },
  PE: {
    countryCode: 'PE', vatName: 'IGV', vatRate: 0.18,
    appliesToShipping: true,
    exemptCategories: [],
  },
  CL: {
    countryCode: 'CL', vatName: 'IVA', vatRate: 0.19,
    appliesToShipping: true,
    exemptCategories: [],
  },
  AR: {
    countryCode: 'AR', vatName: 'IVA', vatRate: 0.21,
    appliesToShipping: true,
    foodReducedRate: 0.105,
    exemptCategories: ['libros', 'pan_blanco', 'leche'],
  },
  US: {
    countryCode: 'US', vatName: 'Sales Tax', vatRate: 0.0, // varies by state
    appliesToShipping: false,
    exemptCategories: [],
  },
}

export interface ReducedRateItem {
  sku: string
  rate: number
  amount: number
}

export interface TaxBreakdown {
  subtotal: number
  taxRate: number
  taxAmount: number
  shipping: number
  shippingTax: number
  total: number
  exemptItems: string[]
  // SPRINT-COMPLIANCE-FINAL-001 · P2 — per-product reduced-rate tracking.
  // Items taxed at a reduced VAT rate (food, books) instead of the standard
  // rate. Each entry records the SKU, the applied rate, and the item line
  // total (price × quantity) so the persisted `Order.taxBreakdown` JSON is
  // auditable per-line for DIAN / AFIP / SAT reconciliation.
  reducedRateItems: ReducedRateItem[]
}

/**
 * Compute the tax breakdown for a cart.
 *
 * Rules applied per `TaxConfig`:
 *   1. Items whose `category` is in `exemptCategories` are excluded from the
 *      taxable base AND listed in `exemptItems` (by SKU) for transparency.
 *   2. If `foodReducedRate` is set and the item category is `alimentos`, the
 *      item is taxed at the reduced rate (its taxable base is scaled so the
 *      flat `vatRate` × scaled-base == reduced-rate × full-price). The SKU
 *      is also recorded in `reducedRateItems` for per-line audit.
 *   3. If `booksReducedRate` is set and the item category is `libros`, the
 *      same reduced-rate logic applies. (SPRINT-COMPLIANCE-FINAL-001.)
 *   4. All other items are taxed at the full `vatRate`.
 *   5. Shipping tax = `shipping × vatRate` when `appliesToShipping`.
 *   6. Total = subtotal + taxAmount + shipping + shippingTax.
 *
 * Unknown countries fall back to the US config (no VAT) — the caller should
 * still receive a TaxBreakdown so the order can be persisted, but with
 * `taxAmount = 0` and `taxRate = 0`.
 *
 * All amounts are rounded to 2 decimal places to avoid floating-point dust.
 */
export function calculateTax(params: {
  items: { sku: string; name: string; price: number; quantity: number; category: string }[]
  shipping: number
  countryCode: string
}): TaxBreakdown {
  const config = TAX_CONFIGS[params.countryCode?.toUpperCase()] || TAX_CONFIGS.US
  const exemptItems: string[] = []
  const reducedRateItems: ReducedRateItem[] = []

  let subtotal = 0
  let taxableAmount = 0

  for (const item of params.items) {
    const itemTotal = item.price * item.quantity
    subtotal += itemTotal

    // Per-product exemption — category is on the country's exempt list.
    if (config.exemptCategories.includes(item.category)) {
      exemptItems.push(item.sku)
      continue
    }

    // Per-product reduced rate — food (alimentos) or books (libros). The
    // taxable base is scaled so the aggregate `vatRate × taxableAmount`
    // yields the correct reduced-rate tax for this line.
    let rate = config.vatRate
    if (config.foodReducedRate && item.category === 'alimentos') {
      rate = config.foodReducedRate
      reducedRateItems.push({ sku: item.sku, rate, amount: itemTotal })
    } else if (config.booksReducedRate && item.category === 'libros') {
      rate = config.booksReducedRate
      reducedRateItems.push({ sku: item.sku, rate, amount: itemTotal })
    }

    if (rate === config.vatRate) {
      taxableAmount += itemTotal
    } else {
      // Scale so `vatRate × scaled-base == reduced × full-price`.
      // Guard against a zero `vatRate` (US fallback) — a reduced rate never
      // applies there because `foodReducedRate`/`booksReducedRate` are unset
      // for the US config, so this branch is unreachable in practice.
      taxableAmount += (itemTotal * rate) / config.vatRate
    }
  }

  const taxAmount = Math.round(taxableAmount * config.vatRate * 100) / 100
  const shippingTax = config.appliesToShipping
    ? Math.round(params.shipping * config.vatRate * 100) / 100
    : 0
  const total = subtotal + taxAmount + params.shipping + shippingTax

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxRate: config.vatRate,
    taxAmount,
    shipping: Math.round(params.shipping * 100) / 100,
    shippingTax,
    total: Math.round(total * 100) / 100,
    exemptItems,
    reducedRateItems,
  }
}

/**
 * Look up the `TaxConfig` for a country. Falls back to US (no VAT) for
 * unknown countries.
 */
export function getTaxConfig(countryCode: string): TaxConfig {
  return TAX_CONFIGS[countryCode?.toUpperCase()] || TAX_CONFIGS.US
}
