// Unit tests for src/lib/agents/schemas.ts
// TASK: SPRINT-TESTS-001
//
// Covers all 11 Zod agent-output schemas + the `parseAgentOutput` JSON
// extractor + the `hasOutputSchema` registry predicate.
//
// These schemas are the LLM output contract — they prevent malformed agent
// responses from polluting the DecisionLog + downstream consumers (checkout,
// cart, customer-score). A regression here means the fallback path
// (confidence 0.3) silently kicks in, degrading agent quality without
// operator visibility.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ProfileSchema,
  QuoteSchema,
  CartBuilderSchema,
  BuyerBehaviorSchema,
  GuideTrackingSchema,
  CustomerScoreSchema,
  CarrierScoreSchema,
  AddressAnalysisSchema,
  VisionSchema,
  NovedadesSchema,
  RemarketingSchema,
  AGENT_OUTPUT_SCHEMAS,
  parseAgentOutput,
  hasOutputSchema,
} from '@/lib/agents/schemas'

// parseAgentOutput uses `console.warn` for non-blocking failure logging.
// Silence the noise + assert it was called.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ─────────────────────────────────────────────────────────────────────────────
// ProfileSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('ProfileSchema', () => {
  it('validates a correct profile', () => {
    const valid = { tipo: 'mayorista', confianza: 0.8, razon: 'compra frecuente' }
    expect(ProfileSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts all 3 valid tipo values', () => {
    for (const tipo of ['mayorista', 'emprendedor', 'detal']) {
      expect(ProfileSchema.safeParse({ tipo, confianza: 0.5, razon: 'x' }).success).toBe(true)
    }
  })

  it('rejects an invalid tipo', () => {
    const invalid = { tipo: 'unknown', confianza: 0.8, razon: 'test' }
    expect(ProfileSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects confianza > 1', () => {
    const invalid = { tipo: 'mayorista', confianza: 1.5, razon: 'test' }
    expect(ProfileSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects confianza < 0', () => {
    const invalid = { tipo: 'mayorista', confianza: -0.1, razon: 'test' }
    expect(ProfileSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts confianza boundary values 0 and 1', () => {
    expect(ProfileSchema.safeParse({ tipo: 'detal', confianza: 0, razon: 'x' }).success).toBe(true)
    expect(ProfileSchema.safeParse({ tipo: 'detal', confianza: 1, razon: 'x' }).success).toBe(true)
  })

  it('rejects a missing razon', () => {
    const invalid = { tipo: 'mayorista', confianza: 0.5 }
    expect(ProfileSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a missing tipo', () => {
    const invalid = { confianza: 0.5, razon: 'x' }
    expect(ProfileSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// QuoteSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('QuoteSchema', () => {
  const valid = {
    total: 150000,
    moneda: 'COP',
    items: [
      { sku: 'SKU-1', nombre: 'Product 1', precio: 50000, cantidad: 2, subtotal: 100000 },
      { sku: 'SKU-2', nombre: 'Product 2', precio: 50000, cantidad: 1, subtotal: 50000 },
    ],
    envio: 9500,
  }

  it('validates a correct quote', () => {
    expect(QuoteSchema.safeParse(valid).success).toBe(true)
  })

  it('validates without optional envio field', () => {
    const withoutEnvio = { ...valid }
    // Cast to optional so the `delete` operator type-checks (TS2790).
    delete (withoutEnvio as { envio?: number }).envio
    expect(QuoteSchema.safeParse(withoutEnvio).success).toBe(true)
  })

  it('rejects an empty items array (Zod v4 requires at least one item? — actually accepts empty by default)', () => {
    // Note: the schema does NOT enforce min(1) on items, so an empty array
    // is technically valid. Test the actual behavior.
    const result = QuoteSchema.safeParse({ ...valid, items: [] })
    expect(result.success).toBe(true)
  })

  it('rejects an item missing subtotal', () => {
    const invalid = {
      ...valid,
      items: [{ sku: 'SKU-1', nombre: 'Product 1', precio: 50000, cantidad: 2 }],
    }
    expect(QuoteSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a missing total', () => {
    const invalid = { ...valid }
    delete (invalid as { total?: number }).total
    expect(QuoteSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CartBuilderSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('CartBuilderSchema', () => {
  it('validates a correct cart', () => {
    const valid = {
      items: [
        { sku: 'SKU-1', cantidad: 2 },
        { sku: 'SKU-2', cantidad: 1 },
      ],
      total: 150000,
    }
    expect(CartBuilderSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a non-integer cantidad', () => {
    const invalid = {
      items: [{ sku: 'SKU-1', cantidad: 1.5 }],
      total: 100,
    }
    expect(CartBuilderSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects cantidad = 0 (must be positive)', () => {
    const invalid = {
      items: [{ sku: 'SKU-1', cantidad: 0 }],
      total: 0,
    }
    expect(CartBuilderSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects cantidad < 0', () => {
    const invalid = {
      items: [{ sku: 'SKU-1', cantidad: -2 }],
      total: 100,
    }
    expect(CartBuilderSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a missing sku on an item', () => {
    const invalid = {
      items: [{ cantidad: 2 }],
      total: 100,
    }
    expect(CartBuilderSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BuyerBehaviorSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('BuyerBehaviorSchema', () => {
  it('validates a correct behavior', () => {
    const valid = {
      intencion: 'compra',
      signals: ['high_msg_volume', 'product_question'],
      recomendacion: 'Proceder con checkout',
    }
    expect(BuyerBehaviorSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts all 4 valid intencion values', () => {
    for (const intencion of ['compra', 'compara', 'navega', 'abandona']) {
      const valid = { intencion, signals: [], recomendacion: 'x' }
      expect(BuyerBehaviorSchema.safeParse(valid).success).toBe(true)
    }
  })

  it('rejects an invalid intencion', () => {
    const invalid = { intencion: 'unknown', signals: [], recomendacion: 'x' }
    expect(BuyerBehaviorSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a missing recomendacion', () => {
    const invalid = { intencion: 'compra', signals: [] }
    expect(BuyerBehaviorSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts an empty signals array', () => {
    const valid = { intencion: 'navega', signals: [], recomendacion: 'x' }
    expect(BuyerBehaviorSchema.safeParse(valid).success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GuideTrackingSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('GuideTrackingSchema', () => {
  it('validates a correct tracking update', () => {
    const valid = {
      estado: 'en_transito',
      fechaEstimada: '2025-01-15',
      ultimaActualizacion: '2025-01-10T10:00:00Z',
    }
    expect(GuideTrackingSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts all 5 valid estado values', () => {
    for (const estado of ['en_transito', 'entregado', 'devuelto', 'perdido', 'desconocido']) {
      const valid = { estado }
      expect(GuideTrackingSchema.safeParse(valid).success).toBe(true)
    }
  })

  it('rejects an invalid estado', () => {
    const invalid = { estado: 'delivered' } // English spelling — invalid
    expect(GuideTrackingSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts only the required estado field', () => {
    const valid = { estado: 'entregado' }
    expect(GuideTrackingSchema.safeParse(valid).success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CustomerScoreSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('CustomerScoreSchema', () => {
  it('validates a correct score', () => {
    const valid = { score: 85, nivel: 'vip', razon: 'Compra frecuente + alto ticket' }
    expect(CustomerScoreSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts all 4 valid nivel values', () => {
    for (const nivel of ['vip', 'regular', 'en_riesgo', 'nuevo']) {
      const valid = { score: 50, nivel, razon: 'x' }
      expect(CustomerScoreSchema.safeParse(valid).success).toBe(true)
    }
  })

  it('rejects score > 100', () => {
    const invalid = { score: 101, nivel: 'vip', razon: 'x' }
    expect(CustomerScoreSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects score < 0', () => {
    const invalid = { score: -1, nivel: 'vip', razon: 'x' }
    expect(CustomerScoreSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts boundary scores 0 and 100', () => {
    expect(CustomerScoreSchema.safeParse({ score: 0, nivel: 'nuevo', razon: 'x' }).success).toBe(true)
    expect(CustomerScoreSchema.safeParse({ score: 100, nivel: 'vip', razon: 'x' }).success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CarrierScoreSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('CarrierScoreSchema', () => {
  it('validates a correct carrier score', () => {
    const valid = {
      carrier: 'dropi',
      score: 92,
      onTimeRate: 0.95,
      issues: ['delay_north'],
    }
    expect(CarrierScoreSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects score > 100', () => {
    const invalid = { carrier: 'dropi', score: 150, onTimeRate: 0.9, issues: [] }
    expect(CarrierScoreSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects onTimeRate > 1', () => {
    const invalid = { carrier: 'dropi', score: 90, onTimeRate: 1.5, issues: [] }
    expect(CarrierScoreSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects onTimeRate < 0', () => {
    const invalid = { carrier: 'dropi', score: 90, onTimeRate: -0.1, issues: [] }
    expect(CarrierScoreSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts an empty issues array', () => {
    const valid = { carrier: 'dropi', score: 100, onTimeRate: 1, issues: [] }
    expect(CarrierScoreSchema.safeParse(valid).success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AddressAnalysisSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('AddressAnalysisSchema', () => {
  it('validates a correct address analysis', () => {
    const valid = {
      valid: true,
      ciudad: 'Bogotá',
      barrio: 'Chapinero',
      sugerencia: 'Dirección verificada',
    }
    expect(AddressAnalysisSchema.safeParse(valid).success).toBe(true)
  })

  it('validates with only the required `valid` field', () => {
    const valid = { valid: false }
    expect(AddressAnalysisSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a missing `valid` field', () => {
    const invalid = { ciudad: 'Bogotá' }
    expect(AddressAnalysisSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a non-boolean `valid`', () => {
    const invalid = { valid: 'yes' }
    expect(AddressAnalysisSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// VisionSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('VisionSchema', () => {
  it('validates a correct vision output', () => {
    const valid = {
      producto: 'Camiseta algodón',
      categoria: 'Ropa',
      atributos: { color: 'azul', talla: 'M' },
      altText: 'Camiseta azul de algodón talla M',
    }
    expect(VisionSchema.safeParse(valid).success).toBe(true)
  })

  it('validates with only the required `producto` field', () => {
    const valid = { producto: 'Producto desconocido' }
    expect(VisionSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a missing producto', () => {
    const invalid = { categoria: 'x' }
    expect(VisionSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts an empty atributos object', () => {
    const valid = { producto: 'x', atributos: {} }
    expect(VisionSchema.safeParse(valid).success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// NovedadesSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('NovedadesSchema', () => {
  it('validates a correct novedad', () => {
    const valid = {
      tipo: 'direccion_incompleta',
      severidad: 'media',
      accion: 'Contactar al cliente para confirmar dirección',
    }
    expect(NovedadesSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts all 3 valid severidad values', () => {
    for (const severidad of ['baja', 'media', 'alta']) {
      const valid = { tipo: 'x', severidad, accion: 'y' }
      expect(NovedadesSchema.safeParse(valid).success).toBe(true)
    }
  })

  it('rejects an invalid severidad', () => {
    const invalid = { tipo: 'x', severidad: 'critical', accion: 'y' }
    expect(NovedadesSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a missing accion', () => {
    const invalid = { tipo: 'x', severidad: 'baja' }
    expect(NovedadesSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RemarketingSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('RemarketingSchema', () => {
  it('validates a correct remarketing message', () => {
    const valid = {
      mensaje: '¡Tu carrito te espera! Termina tu compra ahora.',
      canal: 'whatsapp',
      momento: '24h después del abandono',
    }
    expect(RemarketingSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts all 3 valid canal values', () => {
    for (const canal of ['whatsapp', 'messenger', 'instagram']) {
      const valid = { mensaje: 'x', canal, momento: 'y' }
      expect(RemarketingSchema.safeParse(valid).success).toBe(true)
    }
  })

  it('rejects an invalid canal', () => {
    const invalid = { mensaje: 'x', canal: 'email', momento: 'y' }
    expect(RemarketingSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a missing momento', () => {
    const invalid = { mensaje: 'x', canal: 'whatsapp' }
    expect(RemarketingSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AGENT_OUTPUT_SCHEMAS registry
// ─────────────────────────────────────────────────────────────────────────────
describe('AGENT_OUTPUT_SCHEMAS registry', () => {
  it('registers exactly 11 agent schemas', () => {
    expect(Object.keys(AGENT_OUTPUT_SCHEMAS)).toHaveLength(11)
  })

  it('registers all 11 expected agent names', () => {
    const expected = [
      'profile',
      'quote',
      'cart_builder',
      'buyer_behavior',
      'guide_tracking',
      'customer_score',
      'carrier_score',
      'address_analysis',
      'vision',
      'novedades',
      'remarketing',
    ]
    expect(Object.keys(AGENT_OUTPUT_SCHEMAS).sort()).toEqual(expected.sort())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// hasOutputSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('hasOutputSchema', () => {
  it('returns true for all 11 registered agent names', () => {
    for (const name of [
      'profile',
      'quote',
      'cart_builder',
      'buyer_behavior',
      'guide_tracking',
      'customer_score',
      'carrier_score',
      'address_analysis',
      'vision',
      'novedades',
      'remarketing',
    ]) {
      expect(hasOutputSchema(name)).toBe(true)
    }
  })

  it('returns false for text-only agents (speech, catalog, theme, objection, etc.)', () => {
    const textOnlyAgents = [
      'speech',
      'catalog',
      'theme',
      'objection',
      'address',
      'logistics',
      'checkout',
      'guide_alert',
      'sales_retainer',
      'logistics_notifier',
      'product_enrichment',
      'marketplace',
      'affiliator',
      'traffic_orchestrator',
    ]
    for (const name of textOnlyAgents) {
      expect(hasOutputSchema(name)).toBe(false)
    }
  })

  it('returns false for an unknown / made-up agent name', () => {
    expect(hasOutputSchema('does_not_exist')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseAgentOutput
// ─────────────────────────────────────────────────────────────────────────────
describe('parseAgentOutput', () => {
  it('extracts JSON from a text-wrapped response', () => {
    const raw = 'Here is the result: {"tipo":"mayorista","confianza":0.8,"razon":"test"} done'
    const result = parseAgentOutput('profile', raw)
    expect(result).toEqual({ tipo: 'mayorista', confianza: 0.8, razon: 'test' })
  })

  it('parses a pure-JSON response (no surrounding prose)', () => {
    const raw = '{"tipo":"detal","confianza":0.5,"razon":"x"}'
    const result = parseAgentOutput('profile', raw)
    expect(result).toEqual({ tipo: 'detal', confianza: 0.5, razon: 'x' })
  })

  it('parses JSON wrapped in markdown code fences', () => {
    const raw = '```json\n{"tipo":"mayorista","confianza":0.7,"razon":"y"}\n```'
    const result = parseAgentOutput('profile', raw)
    expect(result).toEqual({ tipo: 'mayorista', confianza: 0.7, razon: 'y' })
  })

  it('returns null for invalid JSON', () => {
    const result = parseAgentOutput('profile', 'not json at all')
    expect(result).toBeNull()
  })

  it('returns null when JSON is valid but does not match the schema', () => {
    // Valid JSON, but `tipo` is not a valid enum value.
    const raw = '{"tipo":"unknown","confianza":0.8,"razon":"test"}'
    const result = parseAgentOutput('profile', raw)
    expect(result).toBeNull()
  })

  it('returns null for an agent without a schema (text-only agent)', () => {
    const result = parseAgentOutput('speech', '{"anything":"goes"}')
    expect(result).toBeNull()
  })

  it('returns null for an unknown agent name', () => {
    const result = parseAgentOutput('does_not_exist', '{"x":1}')
    expect(result).toBeNull()
  })

  it('uses greedy regex — multiple JSON blocks in one response produce an invalid combined match (returns null)', () => {
    // The regex `/\{[\s\S]*\}/` is greedy — it matches from the first `{`
    // to the LAST `}`, capturing BOTH JSON blocks as one string. JSON.parse
    // then fails on the concatenated result, so parseAgentOutput returns null.
    // This is a documented limitation of the tolerant parser, not a contract
    // requirement — the LLM is expected to emit a single JSON block.
    const raw =
      'First: {"tipo":"mayorista","confianza":0.9,"razon":"a"} then {"tipo":"detal","confianza":0.1,"razon":"b"}'
    const result = parseAgentOutput('profile', raw)
    expect(result).toBeNull()
  })

  it('parses a quote with nested items array', () => {
    const raw = JSON.stringify({
      total: 150000,
      moneda: 'COP',
      items: [
        { sku: 'SKU-1', nombre: 'P1', precio: 50000, cantidad: 2, subtotal: 100000 },
      ],
    })
    const result = parseAgentOutput('quote', raw) as { total: number; items: unknown[] }
    expect(result.total).toBe(150000)
    expect(result.items).toHaveLength(1)
  })

  it('logs a warning when validation fails (non-blocking)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseAgentOutput('profile', '{"tipo":"unknown","confianza":0.8,"razon":"x"}')
    expect(warnSpy).toHaveBeenCalled()
  })
})
