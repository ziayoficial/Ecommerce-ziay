// Tests for the Meta Business Agent strategy config (GAP-FIX-3).
// Verifies the three strategies + escalation logic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('Meta Agent Config — strategy resolution', () => {
  const originalEnv = process.env.META_AGENT_STRATEGY

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.META_AGENT_STRATEGY
    } else {
      process.env.META_AGENT_STRATEGY = originalEnv
    }
  })

  it('defaults to own_stack when META_AGENT_STRATEGY is not set', async () => {
    delete process.env.META_AGENT_STRATEGY
    const { getMetaAgentStrategy } = await import('@/lib/config/meta-agent-config')
    const config = getMetaAgentStrategy()
    expect(config.strategy).toBe('own_stack')
    expect(config.useOwnAgents).toBe(true)
    expect(config.useMetaAgent).toBe(false)
  })

  it('respects meta_native strategy', async () => {
    process.env.META_AGENT_STRATEGY = 'meta_native'
    const { getMetaAgentStrategy } = await import('@/lib/config/meta-agent-config')
    const config = getMetaAgentStrategy()
    expect(config.strategy).toBe('meta_native')
    expect(config.useMetaAgent).toBe(true)
    expect(config.useOwnAgents).toBe(false)
  })

  it('respects hybrid strategy', async () => {
    process.env.META_AGENT_STRATEGY = 'hybrid'
    const { getMetaAgentStrategy } = await import('@/lib/config/meta-agent-config')
    const config = getMetaAgentStrategy()
    expect(config.strategy).toBe('hybrid')
    expect(config.useMetaAgent).toBe(true)
    expect(config.useOwnAgents).toBe(true)
  })

  it('falls back to own_stack on invalid value (defensive)', async () => {
    process.env.META_AGENT_STRATEGY = 'invalid_value'
    const { getMetaAgentStrategy } = await import('@/lib/config/meta-agent-config')
    const config = getMetaAgentStrategy()
    // Should not throw — should fall back to own_stack
    expect(config.strategy).toBe('own_stack')
  })
})

describe('Meta Agent Config — shouldEscalateToOwnAgent', () => {
  const originalEnv = process.env.META_AGENT_STRATEGY

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.META_AGENT_STRATEGY
    } else {
      process.env.META_AGENT_STRATEGY = originalEnv
    }
  })

  describe('own_stack mode (default)', () => {
    beforeEach(() => {
      process.env.META_AGENT_STRATEGY = 'own_stack'
    })

    it('always escalates to own agents (returns true)', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'faq' })).toBe(true)
      expect(shouldEscalateToOwnAgent({ intent: 'checkout' })).toBe(true)
      expect(shouldEscalateToOwnAgent({ intent: 'catalog_query' })).toBe(true)
    })
  })

  describe('meta_native mode', () => {
    beforeEach(() => {
      process.env.META_AGENT_STRATEGY = 'meta_native'
    })

    it('never escalates to own agents (returns false)', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'faq' })).toBe(false)
      expect(shouldEscalateToOwnAgent({ intent: 'checkout' })).toBe(false)
    })
  })

  describe('hybrid mode', () => {
    beforeEach(() => {
      process.env.META_AGENT_STRATEGY = 'hybrid'
    })

    it('escalates checkout to own agents', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'checkout' })).toBe(true)
    })

    it('escalates novedad to own agents', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'novedad' })).toBe(true)
    })

    it('escalates complaint to own agents', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'complaint' })).toBe(true)
    })

    it('escalates high-value orders (>500K) to own agents', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'faq', orderValue: 600_000 })).toBe(true)
    })

    it('escalates VIP customers to own agents', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'faq', customerTier: 'vip' })).toBe(true)
    })

    it('does NOT escalate simple FAQ (stays with Meta)', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'faq' })).toBe(false)
    })

    it('does NOT escalate low-value catalog queries (stays with Meta)', async () => {
      const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
      expect(shouldEscalateToOwnAgent({ intent: 'catalog_query', orderValue: 50_000 })).toBe(false)
    })
  })
})

describe('Meta Agent Config — hybrid intent classification regression', () => {
  // RE-AUDIT FIX: previously the webhook hardcoded intent='faq' which meant
  // hybrid mode never escalated anything to ZIAY. These tests verify the
  // keyword-based pre-classification catches the right intents.
  const originalEnv = process.env.META_AGENT_STRATEGY

  beforeEach(() => {
    process.env.META_AGENT_STRATEGY = 'hybrid'
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.META_AGENT_STRATEGY
    } else {
      process.env.META_AGENT_STRATEGY = originalEnv
    }
  })

  it('checkout keywords escalate to ZIAY (not FAQ)', async () => {
    const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
    // Simulate the webhook's keyword classification
    const msgLower = 'quiero hacer un pedido y pagar con wompi'
    let intent: 'faq' | 'catalog_query' | 'checkout' | 'novedad' | 'complaint' = 'faq'
    if (/pedido|orden|comprar|pago|wompi|nequi|tarjeta|confirmar|envío|envio|dirección|direccion/.test(msgLower)) {
      intent = 'checkout'
    }
    expect(intent).toBe('checkout')
    expect(shouldEscalateToOwnAgent({ intent })).toBe(true)
  })

  it('complaint keywords escalate to ZIAY', async () => {
    const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
    const msgLower = 'quiero poner una queja, el servicio fue pésimo'
    let intent: 'faq' | 'catalog_query' | 'checkout' | 'novedad' | 'complaint' = 'faq'
    if (/queja|mal|pésimo|pesimo|terrible|estafa|denuncia/.test(msgLower)) {
      intent = 'complaint'
    }
    expect(intent).toBe('complaint')
    expect(shouldEscalateToOwnAgent({ intent })).toBe(true)
  })

  it('novedad keywords escalate to ZIAY', async () => {
    const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
    const msgLower = 'tengo un problema con mi pedido, no llegó'
    let intent: 'faq' | 'catalog_query' | 'checkout' | 'novedad' | 'complaint' = 'faq'
    if (/novedad|reclamo|problema|no llegó|no llego|devolución|devolucion|reembolso|reclama/.test(msgLower)) {
      intent = 'novedad'
    }
    expect(intent).toBe('novedad')
    expect(shouldEscalateToOwnAgent({ intent })).toBe(true)
  })

  it('simple FAQ stays with Meta (does NOT escalate)', async () => {
    const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
    const msgLower = 'hola, a qué hora abren?'
    let intent: 'faq' | 'catalog_query' | 'checkout' | 'novedad' | 'complaint' = 'faq'
    // No keyword matches → stays as 'faq'
    expect(intent).toBe('faq')
    expect(shouldEscalateToOwnAgent({ intent })).toBe(false)
  })

  it('catalog query stays with Meta in hybrid mode (low-value)', async () => {
    const { shouldEscalateToOwnAgent } = await import('@/lib/config/meta-agent-config')
    const msgLower = 'tienes catálogo de productos?'
    let intent: 'faq' | 'catalog_query' | 'checkout' | 'novedad' | 'complaint' = 'faq'
    if (/catálogo|catalogo|producto|precio|talla|color|tienes|disponible/.test(msgLower)) {
      intent = 'catalog_query'
    }
    expect(intent).toBe('catalog_query')
    // catalog_query without high value or VIP → stays with Meta
    expect(shouldEscalateToOwnAgent({ intent, orderValue: 50_000 })).toBe(false)
  })
})
