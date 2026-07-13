// ZIAY — PaymentAdapter interface
// Saramantha §10 / §17 — desacopla los gateways de pago (MercadoPago, Wompi,
// Stripe, PayU) del flujo conversacional y del orquestador de checkout.
// Cualquier referencia a pagos en agentes y API routes debe usar esta interfaz,
// resuelta en runtime por `getPaymentAdapter(gateway)` en `payment-registry.ts`.
//
// Contrato común:
//   createPaymentLink(opts) → genera un link/URL de pago en el gateway
//   verifyPayment(id)       → consulta el estado actual del pago
//   refund(id, amount?)     → reembolso total o parcial
//   webhookVerify(body, sig)→ valida que un webhook fue emitido por el gateway
//
// La implementación concreta se resuelve en runtime desde `Order.paymentGateway`
// o el config del tenant vía `getPaymentAdapter(gateway)` en `payment-registry.ts`.

/**
 * Resultado común devuelto por toda implementación de `PaymentAdapter`, sin
 * importar si el pago viene de MercadoPago, Wompi, Stripe o PayU.
 */
export interface PaymentResult {
  success: boolean
  /** ID del pago/preferencia/transaction en el gateway (nullable en errores). */
  paymentId?: string
  /** URL de checkout a la que se redirige al cliente (cuando aplica). */
  url?: string
  /** Estado canónico del pago: approved | pending | rejected | refunded | error | stub. */
  status: string
  /** Monto en la unidad mayor (no centavos) — ej. 150000.00 para $150.000 COP. */
  amount: number
  /** Código ISO 4217 — COP, USD, MXN, etc. */
  currency: string
  /** Mensaje humano, usado para errores y para el modo stub. */
  message?: string
  /** Respuesta cruda del gateway, para auditoría y debugging. */
  rawResponse?: unknown
}

/** Opciones para crear un link de pago. */
export interface CreatePaymentLinkOptions {
  amount: number
  currency: string
  description: string
  /** Referencia interna — típicamente `Order.number` — para conciliar webhooks. */
  reference: string
}

/**
 * Contrato común que todo gateway de pago debe implementar.
 * Ver Saramantha §10 — adaptadores de pago.
 */
export interface PaymentAdapter {
  /** Nombre canónico del gateway (mercadopago | wompi | stripe | payu). */
  name: string
  /** Crea un link de pago en el gateway y devuelve la URL de checkout. */
  createPaymentLink(opts: CreatePaymentLinkOptions): Promise<PaymentResult>
  /** Consulta el estado actual de un pago por su ID en el gateway. */
  verifyPayment(paymentId: string): Promise<PaymentResult>
  /** Reembolso total (sin `amount`) o parcial (con `amount`) de un pago. */
  refund(paymentId: string, amount?: number): Promise<PaymentResult>
  /** Verifica la firma HMAC/MD5 de un webhook entrante. */
  webhookVerify(rawBody: string, signature: string): boolean
}

/**
 * Respuesta stub devuelta por cualquier adaptador cuando las credenciales
 * no están configuradas en env. Permite que el sistema siga funcionando
 * (UI, demo, desarrollo local) sin un gateway real configurado.
 *
 * El agente conversacional y la API reciben `success: false` + `status: 'stub'`
 * y pueden degradar graciosamente (mostrar COD, ocultar el botón de pago
 * online, etc.).
 */
export function stubNoCredentials(
  gateway: string,
  amount: number,
  currency: string,
): PaymentResult {
  return {
    success: false,
    status: 'stub',
    amount,
    currency,
    message: `${gateway}: credenciales no configuradas (modo stub). Configure las variables de entorno para habilitar el gateway real.`,
    rawResponse: { gateway, stub: true },
  }
}
