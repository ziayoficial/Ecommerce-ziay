// Agent eval harness — golden cases
// TASK: SPRINT-WEBHOOK-TESTS-EVAL-001
//
// Document §A-7 of AUDIT-AI-AGENTS-001 flagged: "0 test files reference any
// agent; 0 golden cases". This harness closes that gap.
//
// These tests verify that the agent output schemas (defined in
// `src/lib/agents/schemas.ts`) accept known-good outputs and reject known-bad
// outputs. They do NOT call the LLM (that would be expensive + non-deterministic
// — a separate `bun run eval:live` script will exercise the LLM directly).
// Instead, they validate the schema layer that sits between the LLM and the
// persistence layer (DecisionLog + downstream consumers).
//
// A regression here means the fallback path (confidence 0.3, §A-3) silently
// kicks in, degrading agent quality without operator visibility. Golden cases
// make regressions visible at CI time.
//
// Coverage:
//   - 11 schema-backed agents (profile, quote, cart_builder, buyer_behavior,
//     guide_tracking, customer_score, carrier_score, address_analysis,
//     vision, novedades, remarketing) — each with ≥1 accept case + ≥1 reject
//     case.
//   - parseAgentOutput JSON extraction — text-wrapped, markdown-fenced, pure
//     JSON, malformed JSON, unknown agent.
//
// Adding a new agent? Add a golden case here. Adding a new field to an existing
// schema? Add an accept case + a reject case for the new field's validation
// rule (e.g. enum, range, required).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseAgentOutput } from '@/lib/agents/schemas'

// parseAgentOutput uses `console.warn` for non-blocking failure logging.
// Silence the noise so the test output stays clean.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ─────────────────────────────────────────────────────────────────────────────
// profile agent — buyer classification (mayorista / emprendedor / detal)
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — profile', () => {
  it('accepts valid mayorista profile', () => {
    const output = {
      tipo: 'mayorista',
      confianza: 0.85,
      razon: 'Compra 50+ unidades, pregunta por precios mayoristas',
    }
    expect(parseAgentOutput('profile', JSON.stringify(output))).toEqual(output)
  })

  it('accepts valid emprendedor profile', () => {
    const output = {
      tipo: 'emprendedor',
      confianza: 0.7,
      razon: 'Compra para revender, pregunta por catálogo completo',
    }
    expect(parseAgentOutput('profile', JSON.stringify(output))).toEqual(output)
  })

  it('accepts valid detal profile', () => {
    const output = {
      tipo: 'detal',
      confianza: 0.4,
      razon: 'Compra 1-2 unidades para uso personal',
    }
    expect(parseAgentOutput('profile', JSON.stringify(output))).toEqual(output)
  })

  it('rejects invalid tipo', () => {
    const output = { tipo: 'unknown', confianza: 0.5, razon: 'test' }
    expect(parseAgentOutput('profile', JSON.stringify(output))).toBeNull()
  })

  it('rejects confianza > 1', () => {
    const output = { tipo: 'mayorista', confianza: 1.5, razon: 'test' }
    expect(parseAgentOutput('profile', JSON.stringify(output))).toBeNull()
  })

  it('rejects confianza < 0', () => {
    const output = { tipo: 'mayorista', confianza: -0.2, razon: 'test' }
    expect(parseAgentOutput('profile', JSON.stringify(output))).toBeNull()
  })

  it('rejects missing razon', () => {
    const output = { tipo: 'mayorista', confianza: 0.8 }
    expect(parseAgentOutput('profile', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// quote agent — cart quote with items + total
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — quote', () => {
  it('accepts valid quote with items', () => {
    const output = {
      total: 150000,
      moneda: 'COP',
      items: [
        { sku: 'PIJ-001', nombre: 'Short Tira', precio: 16500, cantidad: 10, subtotal: 165000 },
      ],
      envio: 8000,
    }
    // `parseAgentOutput` is typed as `T | null` (T defaults to `unknown`) —
    // cast to a typed shape so property access type-checks. Same pattern as
    // tests/unit/agent-schemas.test.ts.
    const result = parseAgentOutput('quote', JSON.stringify(output)) as {
      total: number
      items: Array<{ sku: string; nombre: string; precio: number; cantidad: number; subtotal: number }>
    } | null
    expect(result).not.toBeNull()
    expect(result?.total).toBe(150000)
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0]).toEqual({
      sku: 'PIJ-001',
      nombre: 'Short Tira',
      precio: 16500,
      cantidad: 10,
      subtotal: 165000,
    })
  })

  it('accepts quote without optional envio field', () => {
    const output = {
      total: 99000,
      moneda: 'COP',
      items: [{ sku: 'SKU-1', nombre: 'P1', precio: 99000, cantidad: 1, subtotal: 99000 }],
    }
    expect(parseAgentOutput('quote', JSON.stringify(output))).not.toBeNull()
  })

  it('rejects quote with item missing subtotal', () => {
    const output = {
      total: 100,
      moneda: 'COP',
      items: [{ sku: 'SKU-1', nombre: 'P1', precio: 100, cantidad: 1 }],
    }
    expect(parseAgentOutput('quote', JSON.stringify(output))).toBeNull()
  })

  it('rejects quote with missing total', () => {
    const output = {
      moneda: 'COP',
      items: [{ sku: 'SKU-1', nombre: 'P1', precio: 100, cantidad: 1, subtotal: 100 }],
    }
    expect(parseAgentOutput('quote', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// cart_builder agent — lightweight cart (sku + cantidad per item)
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — cart_builder', () => {
  it('accepts valid cart', () => {
    const output = {
      items: [
        { sku: 'PIJ-001', cantidad: 5 },
        { sku: 'PIJ-002', cantidad: 3 },
      ],
      total: 120000,
    }
    expect(parseAgentOutput('cart_builder', JSON.stringify(output))).not.toBeNull()
  })

  it('rejects negative quantity', () => {
    const output = {
      items: [{ sku: 'PIJ-001', cantidad: -5 }],
      total: 0,
    }
    expect(parseAgentOutput('cart_builder', JSON.stringify(output))).toBeNull()
  })

  it('rejects zero quantity (must be positive)', () => {
    const output = {
      items: [{ sku: 'PIJ-001', cantidad: 0 }],
      total: 0,
    }
    expect(parseAgentOutput('cart_builder', JSON.stringify(output))).toBeNull()
  })

  it('rejects non-integer quantity', () => {
    const output = {
      items: [{ sku: 'PIJ-001', cantidad: 1.5 }],
      total: 100,
    }
    expect(parseAgentOutput('cart_builder', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buyer_behavior agent — purchase intent classification
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — buyer_behavior', () => {
  it('accepts valid compra intent', () => {
    const output = {
      intencion: 'compra',
      signals: ['pregunta_precio', 'pregunta_stock', 'confirma_compra'],
      recomendacion: 'Proceder con checkout',
    }
    expect(parseAgentOutput('buyer_behavior', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts all 4 valid intents', () => {
    for (const intencion of ['compra', 'compara', 'navega', 'abandona']) {
      const output = { intencion, signals: [], recomendacion: 'x' }
      expect(parseAgentOutput('buyer_behavior', JSON.stringify(output))).not.toBeNull()
    }
  })

  it('rejects invalid intent', () => {
    const output = {
      intencion: 'unknown',
      signals: [],
      recomendacion: 'test',
    }
    expect(parseAgentOutput('buyer_behavior', JSON.stringify(output))).toBeNull()
  })

  it('rejects missing recomendacion', () => {
    const output = { intencion: 'compra', signals: [] }
    expect(parseAgentOutput('buyer_behavior', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// guide_tracking agent — shipping guide status
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — guide_tracking', () => {
  it('accepts en_transito status', () => {
    const output = {
      estado: 'en_transito',
      fechaEstimada: '2026-07-20',
      ultimaActualizacion: '2026-07-15T10:30:00Z',
    }
    expect(parseAgentOutput('guide_tracking', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts entregado status', () => {
    const output = {
      estado: 'entregado',
      fechaEstimada: '2026-07-18',
    }
    expect(parseAgentOutput('guide_tracking', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts devuelto / perdido / desconocido statuses', () => {
    for (const estado of ['devuelto', 'perdido', 'desconocido']) {
      const output = { estado }
      expect(parseAgentOutput('guide_tracking', JSON.stringify(output))).not.toBeNull()
    }
  })

  it('rejects English status "delivered" (must be Spanish "entregado")', () => {
    const output = { estado: 'delivered' }
    expect(parseAgentOutput('guide_tracking', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// customer_score agent — VIP / regular / en_riesgo / nuevo
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — customer_score', () => {
  it('accepts valid VIP score', () => {
    const output = {
      score: 92,
      nivel: 'vip',
      razon: 'Cliente recurrente con alto ticket promedio',
    }
    expect(parseAgentOutput('customer_score', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts all 4 valid nivel values', () => {
    for (const nivel of ['vip', 'regular', 'en_riesgo', 'nuevo']) {
      const output = { score: 50, nivel, razon: 'x' }
      expect(parseAgentOutput('customer_score', JSON.stringify(output))).not.toBeNull()
    }
  })

  it('rejects score > 100', () => {
    const output = { score: 150, nivel: 'vip', razon: 'test' }
    expect(parseAgentOutput('customer_score', JSON.stringify(output))).toBeNull()
  })

  it('rejects score < 0', () => {
    const output = { score: -1, nivel: 'vip', razon: 'test' }
    expect(parseAgentOutput('customer_score', JSON.stringify(output))).toBeNull()
  })

  it('accepts boundary scores 0 and 100', () => {
    expect(
      parseAgentOutput('customer_score', JSON.stringify({ score: 0, nivel: 'nuevo', razon: 'x' })),
    ).not.toBeNull()
    expect(
      parseAgentOutput('customer_score', JSON.stringify({ score: 100, nivel: 'vip', razon: 'x' })),
    ).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// carrier_score agent — transportadora on-time rate
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — carrier_score', () => {
  it('accepts valid carrier score', () => {
    const output = {
      carrier: 'dropi',
      score: 92,
      onTimeRate: 0.95,
      issues: ['delay_north'],
    }
    expect(parseAgentOutput('carrier_score', JSON.stringify(output))).not.toBeNull()
  })

  it('rejects onTimeRate > 1', () => {
    const output = { carrier: 'dropi', score: 90, onTimeRate: 1.5, issues: [] }
    expect(parseAgentOutput('carrier_score', JSON.stringify(output))).toBeNull()
  })

  it('rejects score > 100', () => {
    const output = { carrier: 'dropi', score: 200, onTimeRate: 0.9, issues: [] }
    expect(parseAgentOutput('carrier_score', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// address_analysis agent — Bogotá / Medellín address validation
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — address_analysis', () => {
  it('accepts valid address', () => {
    const output = {
      valid: true,
      ciudad: 'Bogotá',
      barrio: 'Chapinero',
      sugerencia: 'Dirección verificada',
    }
    expect(parseAgentOutput('address_analysis', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts invalid address with suggestion', () => {
    const output = {
      valid: false,
      sugerencia: 'La dirección no existe en Bogotá. ¿Quizás es Calle 100 #15-20?',
    }
    expect(parseAgentOutput('address_analysis', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts minimal address (only `valid` field)', () => {
    const output = { valid: true }
    expect(parseAgentOutput('address_analysis', JSON.stringify(output))).not.toBeNull()
  })

  it('rejects missing `valid` field', () => {
    const output = { ciudad: 'Bogotá' }
    expect(parseAgentOutput('address_analysis', JSON.stringify(output))).toBeNull()
  })

  it('rejects non-boolean `valid`', () => {
    const output = { valid: 'yes' }
    expect(parseAgentOutput('address_analysis', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// vision agent — product image recognition (study §12 vision pipeline)
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — vision', () => {
  it('accepts valid vision output with attributes + altText', () => {
    const output = {
      producto: 'Camiseta algodón',
      categoria: 'Ropa',
      atributos: { color: 'azul', talla: 'M' },
      altText: 'Camiseta azul de algodón talla M',
    }
    expect(parseAgentOutput('vision', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts minimal vision output (only `producto`)', () => {
    const output = { producto: 'Producto desconocido' }
    expect(parseAgentOutput('vision', JSON.stringify(output))).not.toBeNull()
  })

  it('rejects missing `producto`', () => {
    const output = { categoria: 'Ropa' }
    expect(parseAgentOutput('vision', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// novedades agent — shipping incident classification
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — novedades', () => {
  it('accepts valid novedad', () => {
    const output = {
      tipo: 'devolucion',
      severidad: 'media',
      accion: 'Coordinar recolección con transportadora',
    }
    expect(parseAgentOutput('novedades', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts all 3 valid severidad values', () => {
    for (const severidad of ['baja', 'media', 'alta']) {
      const output = { tipo: 'x', severidad, accion: 'y' }
      expect(parseAgentOutput('novedades', JSON.stringify(output))).not.toBeNull()
    }
  })

  it('rejects invalid severidad', () => {
    const output = { tipo: 'devolucion', severidad: 'critical', accion: 'test' }
    expect(parseAgentOutput('novedades', JSON.stringify(output))).toBeNull()
  })

  it('rejects missing accion', () => {
    const output = { tipo: 'x', severidad: 'baja' }
    expect(parseAgentOutput('novedades', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// remarketing agent — abandoned cart recovery message
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — remarketing', () => {
  it('accepts valid WhatsApp remarketing', () => {
    const output = {
      mensaje: '¡Hola! Vimos que dejaste productos en tu carrito. ¿Te ayudo a completar la compra?',
      canal: 'whatsapp',
      momento: '2h después del abandono',
    }
    expect(parseAgentOutput('remarketing', JSON.stringify(output))).not.toBeNull()
  })

  it('accepts all 3 valid canal values', () => {
    for (const canal of ['whatsapp', 'messenger', 'instagram']) {
      const output = { mensaje: 'x', canal, momento: 'y' }
      expect(parseAgentOutput('remarketing', JSON.stringify(output))).not.toBeNull()
    }
  })

  it('rejects invalid canal', () => {
    const output = { mensaje: 'test', canal: 'sms', momento: 'now' }
    expect(parseAgentOutput('remarketing', JSON.stringify(output))).toBeNull()
  })

  it('rejects missing momento', () => {
    const output = { mensaje: 'test', canal: 'whatsapp' }
    expect(parseAgentOutput('remarketing', JSON.stringify(output))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseAgentOutput — JSON extraction from LLM prose
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — parseAgentOutput JSON extraction', () => {
  it('extracts JSON from text-wrapped response', () => {
    const raw = `Aquí está el análisis: {"tipo":"mayorista","confianza":0.8,"razon":"test"} ¿Te ayudo?`
    const result = parseAgentOutput('profile', raw)
    expect(result).toEqual({ tipo: 'mayorista', confianza: 0.8, razon: 'test' })
  })

  it('extracts JSON from markdown code block', () => {
    const raw = '```json\n{"tipo":"mayorista","confianza":0.8,"razon":"test"}\n```'
    const result = parseAgentOutput('profile', raw)
    expect(result).not.toBeNull()
    expect(result).toEqual({ tipo: 'mayorista', confianza: 0.8, razon: 'test' })
  })

  it('parses pure JSON response (no surrounding prose)', () => {
    const raw = '{"tipo":"detal","confianza":0.5,"razon":"x"}'
    const result = parseAgentOutput('profile', raw)
    expect(result).toEqual({ tipo: 'detal', confianza: 0.5, razon: 'x' })
  })

  it('returns null for non-JSON response', () => {
    expect(parseAgentOutput('profile', 'No JSON here')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseAgentOutput('profile', '{invalid json}')).toBeNull()
  })

  it('returns null for agent without schema (text-only agent)', () => {
    // `speech`, `catalog`, `theme`, etc. — agents without JSON contracts.
    expect(parseAgentOutput('speech', '{"any":"thing"}')).toBeNull()
    expect(parseAgentOutput('catalog', '{"any":"thing"}')).toBeNull()
    expect(parseAgentOutput('theme', '{"any":"thing"}')).toBeNull()
  })

  it('returns null for unknown agent name', () => {
    expect(parseAgentOutput('unknown_agent', '{"any":"thing"}')).toBeNull()
  })

  it('returns null when JSON is valid but does not match the schema', () => {
    // Valid JSON, but `tipo` is not a valid enum value.
    const raw = '{"tipo":"unknown","confianza":0.8,"razon":"test"}'
    expect(parseAgentOutput('profile', raw)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases — boundary values
// ─────────────────────────────────────────────────────────────────────────────
describe('Agent golden cases — boundary values', () => {
  it('accepts profile with confianza boundary 0 and 1', () => {
    expect(
      parseAgentOutput('profile', JSON.stringify({ tipo: 'detal', confianza: 0, razon: 'x' })),
    ).not.toBeNull()
    expect(
      parseAgentOutput('profile', JSON.stringify({ tipo: 'detal', confianza: 1, razon: 'x' })),
    ).not.toBeNull()
  })

  it('accepts customer_score with boundary 0 and 100', () => {
    expect(
      parseAgentOutput(
        'customer_score',
        JSON.stringify({ score: 0, nivel: 'nuevo', razon: 'x' }),
      ),
    ).not.toBeNull()
    expect(
      parseAgentOutput(
        'customer_score',
        JSON.stringify({ score: 100, nivel: 'vip', razon: 'x' }),
      ),
    ).not.toBeNull()
  })

  it('accepts carrier_score with empty issues array', () => {
    expect(
      parseAgentOutput(
        'carrier_score',
        JSON.stringify({ carrier: 'x', score: 50, onTimeRate: 0.5, issues: [] }),
      ),
    ).not.toBeNull()
  })

  it('strips unknown fields (Zod default behavior is .strip)', () => {
    // Zod's default behavior is to strip unknown keys (not strict). Verify the
    // parser returns the schema-shaped data without the unknown field.
    const raw = JSON.stringify({
      tipo: 'mayorista',
      confianza: 0.8,
      razon: 'x',
      unknownField: 'should be stripped',
    })
    const result = parseAgentOutput('profile', raw)
    expect(result).toEqual({ tipo: 'mayorista', confianza: 0.8, razon: 'x' })
    expect(result).not.toHaveProperty('unknownField')
  })
})
