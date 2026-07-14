// ZIAY — Payment Adapter Registry
// Saramantha §10 — resuelve el adaptador de pago concreto en runtime según
// `Order.paymentGateway` o el config del tenant. Único punto del código que
// sabe qué implementación concreta de PaymentAdapter corresponde a cada gateway.
//
// Uso:
//   const adapter = getPaymentAdapter(order.paymentGateway ?? 'mercadopago')
//   if (!adapter) throw new Error('gateway not supported')
//   const link = await adapter.createPaymentLink({ amount, currency, description, reference })
//
// ── SPRINT-MULTICOUNTRY-001 — LATAM expansion (study §18) ──
// Added `LOCAL_PAYMENT_METHODS` (pse, pix, oxxo, spei) — local LATAM payment
// methods that don't fit the global PaymentAdapter contract (they return
// QR/barcode/redirect instead of a checkout URL). Callers should use
// `getLocalPaymentAdapter(method)` for those; `getPaymentAdapter()` continues
// to return only `PaymentAdapter` implementations (null for local methods)
// to preserve the type contract asserted by `payment-registry.test.ts`.

import { MercadoPagoAdapter } from './mercadopago'
import { WompiAdapter } from './wompi'
import { StripeAdapter } from './stripe'
import { PayUAdapter } from './payu'
import type { PaymentAdapter } from './payment-adapter'
import {
  getLocalPaymentAdapter as _getLocalPaymentAdapter,
  isLocalPaymentMethod as _isLocalPaymentMethod,
  type LocalPaymentMethod,
  type LocalPaymentAdapter,
} from './local-payments'

/**
 * Canonical global gateway names — adapters that implement the full
 * `PaymentAdapter` contract (createPaymentLink / verifyPayment / refund /
 * webhookVerify). Returned by `getPaymentAdapter()`.
 */
export const PAYMENT_GATEWAYS = ['mercadopago', 'wompi', 'stripe', 'payu'] as const

/**
 * Canonical local payment method names — LATAM-specific payment flows that
 * don't fit the global PaymentAdapter contract. Returned by
 * `getLocalPaymentAdapter()`.
 *
 *   pse  — Colombia (bank transfer via ACH Colombia)
 *   pix  — Brasil (instant payment via Banco Central)
 *   oxxo — México (cash at convenience stores, via Stripe Sources)
 *   spei — México (interbank transfer via Banco de México)
 */
export const LOCAL_PAYMENT_METHODS = ['pse', 'pix', 'oxxo', 'spei'] as const

/**
 * Union type covering both global gateways AND local payment methods.
 * Any string that resolves to a `PaymentGatewayName` is a "supported payment
 * method" — `isPaymentGateway()` returns true for it.
 */
export type PaymentGatewayName =
  | (typeof PAYMENT_GATEWAYS)[number]
  | (typeof LOCAL_PAYMENT_METHODS)[number]

/** Convenience alias for the local-method subset. */
export type LocalPaymentMethodName = LocalPaymentMethod

/**
 * Devuelve la implementación de `PaymentAdapter` correspondiente al gateway.
 * Cada instancia lee sus credenciales desde `process.env` en el constructor;
 * si faltan, las llamadas devuelven `stubNoCredentials(...)` (success=false,
 * status='stub') y la UI puede degradar graciosamente.
 *
 * Local payment methods (pse / pix / oxxo / spei) return `null` here —
 * callers should use `getLocalPaymentAdapter(method)` instead. The two
 * contracts are intentionally separate: local methods return QR / barcode /
 * bank-redirect URLs that don't fit the `createPaymentLink` shape.
 *
 * @param gateway nombre canónico del gateway (case-insensitive)
 * @returns adaptador concreto o `null` si el gateway no está soportado
 */
export function getPaymentAdapter(gateway: string): PaymentAdapter | null {
  switch (gateway.toLowerCase()) {
    case 'mercadopago':
      return new MercadoPagoAdapter()
    case 'wompi':
      return new WompiAdapter()
    case 'stripe':
      return new StripeAdapter()
    case 'payu':
      return new PayUAdapter()
    default:
      return null
  }
}

/**
 * Devuelve el adaptador local para un método de pago LATAM (PSE / PIX /
 * OXXO / SPEI). Re-exporta la fábrica centralizada de `local-payments.ts`
 * para que los callers solo importen desde el registry.
 *
 * @param method nombre canónico del método local (case-insensitive)
 * @returns adaptador concreto o `null` si el método no es un método local
 *         soportado
 */
export function getLocalPaymentAdapter(method: string): LocalPaymentAdapter | null {
  if (!_isLocalPaymentMethod(method.toLowerCase())) return null
  return _getLocalPaymentAdapter(method.toLowerCase() as LocalPaymentMethod)
}

/** Type guard: el string es un nombre canónico de gateway soportado. */
export function isPaymentGateway(gateway: string): gateway is PaymentGatewayName {
  const g = gateway.toLowerCase()
  return (
    (PAYMENT_GATEWAYS as readonly string[]).includes(g) ||
    (LOCAL_PAYMENT_METHODS as readonly string[]).includes(g)
  )
}

/**
 * Type guard: el string es un nombre canónico de método de pago LOCAL
 * (PSE / PIX / OXXO / SPEI). Re-exportado desde `local-payments.ts` para
 * que los callers solo importen desde el registry.
 */
export function isLocalPaymentMethod(method: string): method is LocalPaymentMethodName {
  return _isLocalPaymentMethod(method.toLowerCase())
}

/**
 * Lista TODOS los métodos de pago soportados (globales + locales). Útil para
 * la UI de configuración de pagos + para validar entrada en endpoints que
 * aceptan cualquier método.
 */
export function getAllSupportedMethods(): readonly string[] {
  return [...PAYMENT_GATEWAYS, ...LOCAL_PAYMENT_METHODS]
}
