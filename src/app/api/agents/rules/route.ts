/**
 * GET /api/agents/rules
 *
 * Expone el catálogo completo de reglas NUNCA/SIEMPRE.
 * Usado por: n8n, Generador HTML, ChateaPro, y cualquier cliente externo.
 *
 * @see docs/GUIA-COMPORTAMIENTO-AGENTES.md
 * @security Requiere autenticación (cualquier rol)
 */
import { NextResponse } from 'next/server'
import { NUNCA_RULES, SIEMPRE_RULES, getRulesStats, getRulesForCategory, buildRulesBlock, buildRulesBlockVerbose } from '@/lib/agents/rules'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { requireAuth } from '@/lib/auth-helpers'

export const GET = withErrorHandling(async () => {
  // AUDIT-FIX F-02: route claimed @security "Requiere autenticación" but
  // withErrorHandling does NOT include auth — it only wraps try/catch.
  // Added requireAuth() to match the documented security contract.
  const { error } = await requireAuth()
  if (error) return error

  const stats = getRulesStats()

  return NextResponse.json({
    version: '1.0.0',
    stats: {
      totalNunca: stats.totalNunca,
      totalSiempre: stats.totalSiempre,
      total: stats.total,
      agentesCubiertos: stats.agentesCubiertos,
    },
    nunca: NUNCA_RULES,
    siempre: SIEMPRE_RULES,
    categories: {
      'pre-venta': getRulesForCategory('pre-venta'),
      'post-venta': getRulesForCategory('post-venta'),
      'inteligencia': getRulesForCategory('inteligencia'),
      'especializados': getRulesForCategory('especializados'),
    },
    formats: {
      compact: buildRulesBlock(),
      verbose: buildRulesBlockVerbose().slice(0, 500) + '...(truncado, usar /api/agents/rules?format=verbose para ver completo)',
    },
  })
})
