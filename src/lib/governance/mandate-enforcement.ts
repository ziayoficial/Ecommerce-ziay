// ───────────────────────────────────────────────────────────────────────────
// ZIAY — Governance enforcement layer (SPRINT-GOVERNANCE-001).
// Documento "Comercio Agéntico" §11 — 4 pilares de gobernanza:
//   1. Límites de gasto por categoría (no solo por monto total).
//   2. Reglas de escalamiento a humano.
//   3. Definición clara de responsabilidad si el agente compra fuera de los
//      límites autorizados (liability).
//   4. Trazabilidad de decisiones del agente (DecisionLog — ver schema).
//
// Este módulo expone:
//   - `enforceMandateBounds(intentMandateId, cart)`     → pilar #1
//   - `checkEscalationRules(context)`                   → pilar #2
//   - `determineLiability(context)` + LIABILITY_POLICY  → pilar #3
//   (pilar #4 — DecisionLog — se persiste en /api/governance/decisions y se
//   alimenta desde /api/agents/[agentName] automáticamente.)
//
// Todas las funciones son puras respecto a la base de datos salvo
// `enforceMandateBounds`, que necesita cargar el Intent Mandate firmado.
// ───────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'

/** Item de carrito normalizado que recibe `enforceMandateBounds`. */
export interface CartItem {
  sku: string
  name: string
  price: number
  quantity: number
  category: string // product.categoria
  total: number
}

/** Resultado de la verificación de límites del Intent Mandate. */
export interface EnforcementResult {
  allowed: boolean
  violations: string[]
  updatedCart?: CartItem[]
}

/**
 * Enforce Intent Mandate bounds on a cart.
 * Document §11: "Límites de gasto por categoría, no solo por monto total".
 *
 * Chequeos (en orden):
 *   1. El mandate existe, es `type=intent`, `status=active` y no expirado.
 *   2. El total del carrito ≤ `mandate.maxAmount`.
 *   3. Cada categoría del carrito ≤ `mandate.categoryLimits[cat]`.
 *
 * Si todo pasa → `{ allowed: true, violations: [], updatedCart: cart }`.
 * Si falla → `{ allowed: false, violations: [...], updatedCart: undefined }`.
 */
export async function enforceMandateBounds(
  intentMandateId: string,
  cart: CartItem[],
): Promise<EnforcementResult> {
  const mandate = await db.aP2Mandate.findUnique({
    where: { id: intentMandateId },
  })

  if (!mandate || mandate.type !== 'intent' || mandate.status !== 'active') {
    return { allowed: false, violations: ['Mandato inválido o revocado'] }
  }

  if (mandate.expiresAt && mandate.expiresAt < new Date()) {
    return { allowed: false, violations: ['Mandato expirado'] }
  }

  const violations: string[] = []

  // Check total amount.
  const cartTotal = cart.reduce((sum, item) => sum + item.total, 0)
  if (mandate.maxAmount != null && cartTotal > mandate.maxAmount) {
    violations.push(
      `Total ${cartTotal} excede el monto máximo autorizado ${mandate.maxAmount}`,
    )
  }

  // Check per-category limits.
  if (mandate.categoryLimits) {
    let limits: Record<string, number> = {}
    try {
      limits = JSON.parse(mandate.categoryLimits) as Record<string, number>
    } catch {
      limits = {}
    }
    const byCategory: Record<string, number> = {}
    for (const item of cart) {
      byCategory[item.category] =
        (byCategory[item.category] ?? 0) + item.total
    }
    for (const [category, amount] of Object.entries(byCategory)) {
      const limit = limits[category]
      if (limit !== undefined && amount > limit) {
        violations.push(
          `Categoría "${category}": ${amount} excede límite ${limit}`,
        )
      }
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    updatedCart: violations.length === 0 ? cart : undefined,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Pilar #2 — Reglas de escalamiento a humano.
// ───────────────────────────────────────────────────────────────────────────

export interface EscalationRule {
  trigger: string
  threshold: number
  action: 'escalate' | 'block'
  reason: string
}

export const ESCALATION_RULES: EscalationRule[] = [
  {
    trigger: 'order_value',
    threshold: 5_000_000,
    action: 'escalate',
    reason: 'Orden mayor a COP 5M requiere aprobación humana',
  },
  {
    trigger: 'category_moda',
    threshold: 2_000_000,
    action: 'escalate',
    reason: 'Compra de moda mayor a COP 2M requiere aprobación',
  },
  {
    trigger: 'first_purchase',
    threshold: 1,
    action: 'escalate',
    reason: 'Primera compra de cliente nuevo requiere verificación',
  },
  {
    trigger: 'payment_method_change',
    threshold: 1,
    action: 'escalate',
    reason: 'Cambio de método de pago requiere re-autorización',
  },
  {
    trigger: 'failed_payment_count',
    threshold: 3,
    action: 'block',
    reason: '3 pagos fallidos bloquean la cuenta temporalmente',
  },
]

export function checkEscalationRules(context: {
  orderValue: number
  category: string
  isFirstPurchase: boolean
  paymentMethodChanged: boolean
  failedPaymentCount: number
}): { shouldEscalate: boolean; shouldBlock: boolean; reasons: string[] } {
  const reasons: string[] = []
  let shouldEscalate = false
  let shouldBlock = false

  for (const rule of ESCALATION_RULES) {
    let triggered = false
    switch (rule.trigger) {
      case 'order_value':
        triggered = context.orderValue >= rule.threshold
        break
      case `category_${context.category}`:
        triggered = context.orderValue >= rule.threshold
        break
      case 'first_purchase':
        triggered = context.isFirstPurchase
        break
      case 'payment_method_change':
        triggered = context.paymentMethodChanged
        break
      case 'failed_payment_count':
        triggered = context.failedPaymentCount >= rule.threshold
        break
    }
    if (triggered) {
      if (rule.action === 'block') {
        shouldBlock = true
      } else {
        shouldEscalate = true
      }
      reasons.push(rule.reason)
    }
  }

  return { shouldEscalate, shouldBlock, reasons }
}

// ───────────────────────────────────────────────────────────────────────────
// Pilar #3 — Definición de responsabilidad (liability).
// Document §11: "Definición clara de responsabilidad si el agente compra
// fuera de los límites autorizados".
//
//   withinBounds           → el comercio (ZIAY tenant) absorbe
//   exceedsBounds          → el proveedor del agente absorbe el exceso
//   noMandate              → el proveedor del agente asume responsabilidad
//                            total (sin autorización = acto fuera de mandato)
//   revokedMandate         → si el mandato fue revocado ANTES de que el
//                            agente sometiera el carrito, el proveedor del
//                            agente asume responsabilidad total
// ───────────────────────────────────────────────────────────────────────────

export const LIABILITY_POLICY = {
  // If the agent exceeds the Intent Mandate bounds:
  // - The merchant (ZIAY tenant) is NOT liable for the excess
  // - The agent provider IS liable
  // - The user can dispute the charge
  withinBounds: 'merchant_liability', // merchant absorbs
  exceedsBounds: 'agent_provider_liability', // agent provider absorbs
  noMandate: 'agent_provider_full_liability', // no authorization = full liability on agent
  revokedMandate: 'agent_provider_full_liability',

  // Time-based: if mandate was revoked BEFORE the cart was submitted
  // but the agent still proceeded, agent provider has full liability
} as const

export type LiabilityParty =
  (typeof LIABILITY_POLICY)[keyof typeof LIABILITY_POLICY]

export function determineLiability(context: {
  hasValidMandate: boolean
  withinBounds: boolean
  mandateRevokedBeforeCart: boolean
}): string {
  if (!context.hasValidMandate) return LIABILITY_POLICY.noMandate
  if (context.mandateRevokedBeforeCart) return LIABILITY_POLICY.revokedMandate
  if (!context.withinBounds) return LIABILITY_POLICY.exceedsBounds
  return LIABILITY_POLICY.withinBounds
}

// ───────────────────────────────────────────────────────────────────────────
// Helper — convierte un carrito UCP/AP2 (formato `{items: [{unitPrice, tax,
// quantity, category?}], totals: {total}}`) al formato `CartItem[]` que
// espera `enforceMandateBounds`. Reutilizable desde los 2 call-sites.
// ───────────────────────────────────────────────────────────────────────────

export function normalizeUcpCartToItems(cart: {
  items?: Array<{
    sku: string
    name?: string
    quantity: number
    unitPrice: number
    tax?: number
    category?: string
  }>
  totals?: { total?: number; subtotal?: number; shipping?: number; tax?: number }
}): CartItem[] {
  const items = cart.items ?? []
  return items.map((it) => {
    const lineUnit = it.unitPrice + (it.tax ?? 0)
    return {
      sku: it.sku,
      name: it.name ?? it.sku,
      price: lineUnit,
      quantity: it.quantity,
      category: it.category ?? 'uncategorized',
      total: lineUnit * it.quantity,
    }
  })
}
