// ZIAY — Per-tenant daily LLM cost budget.
//
// SPRINT-AI-AGENTS-003 §3 — previene que un solo tenant dispare los costos
// de LLM (loop infinito de un agente, campaña de remarketing que martilla
// el provider, etc.). Cuando el gasto acumulado del día supera el
// presupuesto, las llamadas LLM se rechazan con 429 (ver caller sites en
// `/api/agents/[agentName]`, `/api/orchestrate`, `/api/ai-reply`).
//
// El presupuesto se configura por tenant vía `Setting` key
// `llm_daily_budget_usd::{tenantId}` (ver `/api/llm/budget/route.ts` para
// el endpoint admin). Default: $10/día.
//
// Caching: el par {budget, spent} se cachea 5 min en memoria por tenant
// para no golpear la DB en cada llamada LLM. `invalidateBudgetCache(tenantId)`
// se invoca desde el endpoint de configuración para refrescar
// inmediatamente tras un cambio. La cuenta de `spent` puede quedar
// ligeramente desfasada (hasta 5 min) respecto al DecisionLog real, pero
// el riesgo de over-spend en esa ventana es despreciable: en 5 min un
// tenant no puede acumular más que su rate-limit de 10 LLM calls/min/IP ×
// 5 min × ~$0.01/call = $0.50 en el peor caso.

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * Presupuesto diario por defecto cuando el tenant no tiene override en
 * `Setting`. $10/día cubre ~1000 llamadas LLM a glm-4.6 (~$0.01/call)
 * — suficiente para una operación normal de un solo tenant.
 */
const DEFAULT_DAILY_BUDGET_USD = 10
const BUDGET_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos

interface BudgetCache {
  budget: number
  spent: number
  fetchedAt: number
}

const budgetCache = new Map<string, BudgetCache>()

/**
 * Devuelve el presupuesto diario + gasto acumulado hoy + restante para un
 * tenant. Resuelve el budget desde `Setting` (override por tenant) o cae
 * al default. El gasto se agrega desde `DecisionLog` (donde persisten las
 * 3 rutas LLM según §A-6 de SPRINT-AI-LLM-ADAPTER-001).
 *
 * Cachea el resultado 5 min para no leer la DB en cada llamada LLM.
 */
export async function getTenantBudget(tenantId: string): Promise<{ budget: number; spent: number; remaining: number }> {
  const now = Date.now()
  const cached = budgetCache.get(tenantId)

  if (cached && now - cached.fetchedAt < BUDGET_CACHE_TTL_MS) {
    return {
      budget: cached.budget,
      spent: cached.spent,
      remaining: Math.max(0, cached.budget - cached.spent),
    }
  }

  // Override por tenant en Setting (key: llm_daily_budget_usd::{tenantId}).
  // Si no existe o el valor no es parseable, cae al default.
  const budgetSetting = await db.setting.findFirst({
    where: { key: `llm_daily_budget_usd::${tenantId}` },
  })
  const parsed = budgetSetting ? parseFloat(budgetSetting.value) : NaN
  const budget = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_BUDGET_USD

  // Gasto acumulado hoy (desde medianoche local). DecisionLog.createdAt es
  // UTC — usamos `new Date()` con setHours(0,0,0,0) que respeta la TZ local
  // del servidor. Para Colombia (UTC-5) el "hoy" del tenant coincide con
  // el "hoy" del servidor en la mayoría de despliegues.
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const result = await db.decisionLog.aggregate({
    where: {
      tenantId,
      createdAt: { gte: today },
      costUsd: { not: null },
    },
    _sum: { costUsd: true },
  })

  const spent = result._sum.costUsd || 0

  budgetCache.set(tenantId, { budget, spent, fetchedAt: now })

  return {
    budget,
    spent,
    remaining: Math.max(0, budget - spent),
  }
}

/**
 * Verifica el presupuesto antes de una llamada LLM. El caller debe invocar
 * esto justo antes del `chat()` y abortar con 429 si `allowed === false`.
 *
 * No lanza — errores de DB se loguean y se permite la llamada (fail-open):
 * preferimos servir al usuario y arriesgar over-spend antes que bloquear
 * todo el tráfico de LLM por un problema transitorio de la DB.
 */
export async function checkBudgetBeforeCall(tenantId: string): Promise<{
  allowed: boolean
  remaining: number
  message?: string
}> {
  try {
    const { budget, spent, remaining } = await getTenantBudget(tenantId)

    if (remaining <= 0) {
      logger.warn({ tenantId, budget, spent }, 'LLM budget exceeded')
      return {
        allowed: false,
        remaining: 0,
        message: `Presupuesto diario de LLM excedido ($${spent.toFixed(4)}/$${budget.toFixed(2)}). Reinicia mañana.`,
      }
    }

    return { allowed: true, remaining }
  } catch (err) {
    // Fail-open: si no podemos verificar el presupuesto (DB caída, etc.),
    // permitimos la llamada para no bloquear todo el tráfico LLM. El
    // over-spend se detecta después en el siguiente check cuando la DB
    // vuelva a estar disponible.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId },
      'Budget check failed — failing open (allowing LLM call)',
    )
    return { allowed: true, remaining: Infinity }
  }
}

/**
 * Invalida la entrada de cache para un tenant (o todo el cache si se llama
 * sin argumento). Se invoca desde el endpoint `/api/llm/budget` POST tras
 * actualizar el Setting, para que el siguiente check refleje el nuevo
 * presupuesto inmediatamente.
 */
export function invalidateBudgetCache(tenantId?: string): void {
  if (tenantId) {
    budgetCache.delete(tenantId)
  } else {
    budgetCache.clear()
  }
}
