import { describe, it, expect } from 'vitest'
import {
  NUNCA_RULES,
  SIEMPRE_RULES,
  buildRulesBlock,
  buildRulesBlockVerbose,
  validateOutput,
  getRulesForCategory,
  getRulesStats,
} from '@/lib/agents/rules'

describe('Agent Rules System', () => {
  describe('Catálogo de reglas', () => {
    it('tiene 29 reglas NUNCA', () => {
      expect(NUNCA_RULES).toHaveLength(29)
    })

    it('tiene 17 reglas SIEMPRE', () => {
      expect(SIEMPRE_RULES).toHaveLength(17)
    })

    it('todas las reglas NUNCA tienen tipo "NUNCA"', () => {
      NUNCA_RULES.forEach(rule => {
        expect(rule.tipo).toBe('NUNCA')
      })
    })

    it('todas las reglas SIEMPRE tienen tipo "SIEMPRE"', () => {
      SIEMPRE_RULES.forEach(rule => {
        expect(rule.tipo).toBe('SIEMPRE')
      })
    })

    it('todas las reglas tienen id, label y desc', () => {
      ;[...NUNCA_RULES, ...SIEMPRE_RULES].forEach(rule => {
        expect(rule.id).toBeTruthy()
        expect(rule.label).toBeTruthy()
        expect(rule.desc).toBeTruthy()
      })
    })

    it('no hay IDs duplicados', () => {
      const allIds = [...NUNCA_RULES, ...SIEMPRE_RULES].map(r => r.id)
      const unique = new Set(allIds)
      expect(unique.size).toBe(allIds.length)
    })
  })

  describe('buildRulesBlock', () => {
    it('genera bloque compacto con NUNCA y SIEMPRE', () => {
      const block = buildRulesBlock()
      expect(block).toContain('# REGLAS ABSOLUTAS')
      expect(block).toContain('NUNCA:')
      expect(block).toContain('SIEMPRE:')
      expect(block).toContain('[N01]')
      expect(block).toContain('[S01]')
    })

    it('incluye reglas personalizadas', () => {
      const block = buildRulesBlock({
        nunca: ['ofrecer envío gratis en pedidos menores a $50.000'],
        siempre: ['mencionar garantía de 30 días'],
      })
      expect(block).toContain('[CN1]ofrecer envío gratis')
      expect(block).toContain('[CS1]mencionar garantía')
    })

    it('funciona sin reglas personalizadas', () => {
      const block = buildRulesBlock()
      expect(block).toContain('NUNCA:')
      expect(block).not.toContain('[CN1]')
    })
  })

  describe('buildRulesBlockVerbose', () => {
    it('genera formato legible', () => {
      const block = buildRulesBlockVerbose()
      expect(block).toContain('# REGLAS ABSOLUTAS')
      expect(block).toContain('## Comportamientos prohibidos (NUNCA)')
      expect(block).toContain('## Comportamientos obligatorios (SIEMPRE)')
      expect(block).toContain('NUNCA')
      expect(block).toContain('SIEMPRE')
    })
  })

  describe('validateOutput', () => {
    it('detecta violación de N01 (descuento)', () => {
      const violations = validateOutput('¡Tenemos un descuento especial para ti!')
      expect(violations).toHaveLength(1)
      expect(violations[0].id).toBe('N01')
    })

    it('detecta violación de N17 (con gusto)', () => {
      const violations = validateOutput('Con gusto te ayudo')
      expect(violations).toHaveLength(1)
      expect(violations[0].id).toBe('N17')
    })

    it('detecta violación de N30 (markdown)', () => {
      const violations = validateOutput('**Precio especial**')
      expect(violations.some(v => v.id === 'N30')).toBe(true)
    })

    it('detecta violación de N45 (lamentablemente)', () => {
      const violations = validateOutput('Lamentablemente no tenemos stock')
      expect(violations.some(v => v.id === 'N45')).toBe(true)
    })

    it('detecta violación de N13 (urgencia falsa)', () => {
      const violations = validateOutput('¡Solo hoy! Última oportunidad')
      expect(violations.some(v => v.id === 'N13')).toBe(true)
    })

    it('detecta violación de N50 (emojis tristes)', () => {
      const violations = validateOutput('Lo siento 😢')
      expect(violations.some(v => v.id === 'N50')).toBe(true)
    })

    it('no detecta violaciones en output limpio', () => {
      const violations = validateOutput('¡Claro! Te envío el catálogo 👇')
      expect(violations).toHaveLength(0)
    })

    it('detecta múltiples violaciones', () => {
      const violations = validateOutput('Con gusto te ofrezco un **descuento** 😢')
      expect(violations.length).toBeGreaterThanOrEqual(3) // N01, N17, N30, N50
    })
  })

  describe('getRulesForCategory', () => {
    it('filtra reglas para pre-venta', () => {
      const { nunca, siempre } = getRulesForCategory('pre-venta')
      expect(siempre.length).toBeGreaterThan(0)
      expect(siempre.every(r => r.tipo === 'SIEMPRE')).toBe(true)
    })

    it('filtra reglas para post-venta', () => {
      const { nunca, siempre } = getRulesForCategory('post-venta')
      expect(nunca.some(r => r.id === 'N11')).toBe(true) // derivar devoluciones
    })

    it('devuelve arrays vacíos para categoría desconocida', () => {
      const { nunca, siempre } = getRulesForCategory('inexistente' as any)
      expect(nunca).toHaveLength(0)
      expect(siempre).toHaveLength(0)
    })
  })

  describe('getRulesStats', () => {
    it('retorna estadísticas correctas', () => {
      const stats = getRulesStats()
      expect(stats.totalNunca).toBe(29)
      expect(stats.totalSiempre).toBe(17)
      expect(stats.total).toBe(46)
      expect(stats.agentesCubiertos).toBe(4)
    })
  })
})
