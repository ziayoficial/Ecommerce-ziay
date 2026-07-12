// Unit tests for src/lib/adapters/payment-adapter.ts
// TASK: TESTS-CICD-001

import { describe, it, expect } from 'vitest'
import {
  stubNoCredentials,
  type PaymentAdapter,
  type PaymentResult,
  type CreatePaymentLinkOptions,
} from '@/lib/adapters/payment-adapter'

describe('stubNoCredentials', () => {
  it('returns the correct shape (PaymentResult) with success=false and status=stub', () => {
    const result = stubNoCredentials('mercadopago', 150000, 'COP')
    expect(result).toMatchObject({
      success: false,
      status: 'stub',
      amount: 150000,
      currency: 'COP',
    })
    expect(typeof result.message).toBe('string')
    expect(result.message!.length).toBeGreaterThan(0)
    expect(result.rawResponse).toEqual({ gateway: 'mercadopago', stub: true })
  })

  it('echoes the gateway name into the message for each of the 4 supported gateways', () => {
    const gateways = ['mercadopago', 'wompi', 'stripe', 'payu'] as const
    for (const g of gateways) {
      const result = stubNoCredentials(g, 100, 'USD')
      expect(result.success).toBe(false)
      expect(result.status).toBe('stub')
      expect(result.message).toContain(g)
      expect(result.rawResponse).toEqual({ gateway: g, stub: true })
    }
  })

  it('preserves the passed amount and currency exactly (no mutation, no rounding)', () => {
    const result = stubNoCredentials('stripe', 99.99, 'USD')
    expect(result.amount).toBe(99.99)
    expect(result.currency).toBe('USD')
  })

  it('always returns a fresh object (no shared mutable state)', () => {
    const a = stubNoCredentials('wompi', 100, 'COP')
    const b = stubNoCredentials('wompi', 100, 'COP')
    expect(a).not.toBe(b)
    expect(a.rawResponse).not.toBe(b.rawResponse)
  })
})

describe('PaymentAdapter interface compliance', () => {
  it('a minimal implementation satisfies the PaymentAdapter contract', () => {
    // Build a minimal concrete adapter that uses stubNoCredentials under the hood.
    const adapter: PaymentAdapter = {
      name: 'mock',
      async createPaymentLink(opts: CreatePaymentLinkOptions): Promise<PaymentResult> {
        return stubNoCredentials('mock', opts.amount, opts.currency)
      },
      async verifyPayment(_paymentId: string): Promise<PaymentResult> {
        return stubNoCredentials('mock', 0, 'COP')
      },
      async refund(_paymentId: string, _amount?: number): Promise<PaymentResult> {
        return stubNoCredentials('mock', 0, 'COP')
      },
      webhookVerify(_rawBody: string, _signature: string): boolean {
        return false
      },
    }

    expect(adapter.name).toBe('mock')
    expect(typeof adapter.createPaymentLink).toBe('function')
    expect(typeof adapter.verifyPayment).toBe('function')
    expect(typeof adapter.refund).toBe('function')
    expect(typeof adapter.webhookVerify).toBe('function')
  })

  it('createPaymentLink returns a PaymentResult with the expected canonical fields', async () => {
    const adapter: PaymentAdapter = {
      name: 'mock',
      async createPaymentLink(opts) {
        return stubNoCredentials('mock', opts.amount, opts.currency)
      },
      async verifyPayment(_id) {
        return stubNoCredentials('mock', 0, 'COP')
      },
      async refund(_id, _amt?) {
        return stubNoCredentials('mock', 0, 'COP')
      },
      webhookVerify() {
        return false
      },
    }

    const result = await adapter.createPaymentLink({
      amount: 250000,
      currency: 'COP',
      description: 'Test order',
      reference: 'ORD-1',
    })

    expect(result).toMatchObject({
      success: false,
      status: 'stub',
      amount: 250000,
      currency: 'COP',
    })
  })
})
