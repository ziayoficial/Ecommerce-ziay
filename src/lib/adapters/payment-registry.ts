// ZIAY — Payment Adapter Registry
// Saramantha §10 — resuelve el adaptador de pago concreto en runtime según
// `Order.paymentGateway` o el config del tenant. Único punto del código que
// sabe qué implementación concreta de PaymentAdapter corresponde a cada gateway.
//
// Uso:
//   const adapter = getPaymentAdapter(order.paymentGateway ?? 'mercadopago')
//   if (!adapter) throw new Error('gateway not supported')
//   const link = await adapter.createPaymentLink({ amount, currency, description, reference })

import { MercadoPagoAdapter } from './mercadopago'
import { WompiAdapter } from './wompi'
import { StripeAdapter } from './stripe'
import { PayUAdapter } from './payu'
import type { PaymentAdapter } from './payment-adapter'

export const PAYMENT_GATEWAYS = ['mercadopago', 'wompi', 'stripe', 'payu'] as const
export type PaymentGatewayName = (typeof PAYMENT_GATEWAYS)[number]

/**
 * Devuelve la implementación de `PaymentAdapter` correspondiente al gateway.
 * Cada instancia lee sus credenciales desde `process.env` en el constructor;
 * si faltan, las llamadas devuelven `stubNoCredentials(...)` (success=false,
 * status='stub') y la UI puede degradar graciosamente.
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

/** Type guard: el string es un nombre canónico de gateway soportado. */
export function isPaymentGateway(gateway: string): gateway is PaymentGatewayName {
  return (PAYMENT_GATEWAYS as readonly string[]).includes(gateway.toLowerCase())
}
