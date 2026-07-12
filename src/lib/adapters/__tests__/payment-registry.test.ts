// Unit tests for src/lib/adapters/payment-registry.ts
// TASK: TESTS-CICD-001

import { describe, it, expect } from 'vitest'
import {
  getPaymentAdapter,
  isPaymentGateway,
  PAYMENT_GATEWAYS,
  type PaymentGatewayName,
} from '@/lib/adapters/payment-registry'
import type { PaymentAdapter } from '@/lib/adapters/payment-adapter'

describe('PAYMENT_GATEWAYS', () => {
  it('contains all 4 supported gateways', () => {
    expect(PAYMENT_GATEWAYS).toEqual(['mercadopago', 'wompi', 'stripe', 'payu'])
    expect(PAYMENT_GATEWAYS).toHaveLength(4)
  })

  it('is a readonly tuple of canonical gateway names', () => {
    for (const g of PAYMENT_GATEWAYS) {
      expect(typeof g).toBe('string')
      expect(g).toBe(g.toLowerCase()) // canonical = lowercase
    }
  })
})

describe('getPaymentAdapter', () => {
  it('returns a concrete adapter for each of the 4 gateways', () => {
    const cases: Array<{ gateway: string; expectedName: string }> = [
      { gateway: 'mercadopago', expectedName: 'mercadopago' },
      { gateway: 'wompi', expectedName: 'wompi' },
      { gateway: 'stripe', expectedName: 'stripe' },
      { gateway: 'payu', expectedName: 'payu' },
    ]

    for (const { gateway, expectedName } of cases) {
      const adapter = getPaymentAdapter(gateway)
      expect(adapter, `for gateway=${gateway}`).not.toBeNull()
      expect(adapter!.name).toBe(expectedName)
      // Confirm the adapter satisfies the PaymentAdapter contract (4 methods).
      expect(typeof adapter!.createPaymentLink).toBe('function')
      expect(typeof adapter!.verifyPayment).toBe('function')
      expect(typeof adapter!.refund).toBe('function')
      expect(typeof adapter!.webhookVerify).toBe('function')
    }
  })

  it('returns null for an unknown gateway', () => {
    expect(getPaymentAdapter('paypal')).toBeNull()
    expect(getPaymentAdapter('')).toBeNull()
    expect(getPaymentAdapter('unknown')).toBeNull()
  })

  it('is case-insensitive — accepts UPPERCASE and MixedCase gateway names', () => {
    const a = getPaymentAdapter('MERCADOPAGO')
    const b = getPaymentAdapter('Wompi')
    const c = getPaymentAdapter('STRIPE')
    const d = getPaymentAdapter('PayU')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(c).not.toBeNull()
    expect(d).not.toBeNull()
    expect(a!.name).toBe('mercadopago')
    expect(b!.name).toBe('wompi')
    expect(c!.name).toBe('stripe')
    expect(d!.name).toBe('payu')
  })

  it('returns a fresh adapter instance on each call (no shared state)', () => {
    const a = getPaymentAdapter('mercadopago')
    const b = getPaymentAdapter('mercadopago')
    expect(a).not.toBe(b)
  })

  it('returned adapters satisfy the PaymentAdapter interface', () => {
    const adapter: PaymentAdapter | null = getPaymentAdapter('stripe')
    expect(adapter).not.toBeNull()
    if (adapter) {
      // PaymentAdapter must have a string `name` and 4 methods.
      expect(typeof adapter.name).toBe('string')
      expect(typeof adapter.createPaymentLink).toBe('function')
      expect(typeof adapter.verifyPayment).toBe('function')
      expect(typeof adapter.refund).toBe('function')
      expect(typeof adapter.webhookVerify).toBe('function')
    }
  })
})

describe('isPaymentGateway', () => {
  it('returns true for each canonical gateway name', () => {
    for (const g of PAYMENT_GATEWAYS) {
      expect(isPaymentGateway(g)).toBe(true)
    }
  })

  it('returns false for unsupported gateways', () => {
    expect(isPaymentGateway('paypal')).toBe(false)
    expect(isPaymentGateway('')).toBe(false)
    expect(isPaymentGateway('random')).toBe(false)
  })

  it('narrows the type to PaymentGatewayName when true', () => {
    const candidate = 'mercadopago' as string
    if (isPaymentGateway(candidate)) {
      // TypeScript narrowing — this assignment must typecheck.
      const _ok: PaymentGatewayName = candidate
      expect(_ok).toBe('mercadopago')
    } else {
      throw new Error('should have been a gateway')
    }
  })
})
