// ZIAY — Per-tenant daily + monthly LLM cost budget.
//
// SPRINT-AI-AGENTS-003 §3 — previene que un solo tenant dispare los costos
// de LLM (loop infinito de un agente, campaña de remarketing que martilla
// el provider, etc.). Cuando el gasto acumulado del día supera el
// presupuesto, las llamadas LLM se rechazan con 429 (ver caller sites en
// `/api/agents/[agentName]`, `/api/orchestrate`, `/api/ai-reply`).
//
// El presupuesto se configura por tenant vía `Setting` keys:
//   - `llm_daily_budget_usd::{tenantId}`   — cap diario (default $10/día).
//   - `llm_monthly_budget_usd::{tenantId}` — cap mensual (default $200/mes).
// Ver `/api/llm/budget/route.ts` para el endpoint admin.
//
// SPRINT-AI-FINAL-001 §2 — añadido el cap mensual además del diario. El
// cap diario acota el daño en una ventana corta (un agente en loop), el
// cap mensual acota el gasto total del tenant en su ciclo de facturación.
// Un tenant pequeño puede querer un cap mensual bajo ($50) sin tener un
// cap diario muy restrictivo — ambos se chequean en `checkBudgetBeforeCall`.
//
// Caching: el par {budget, spent} se cachea 5 min (diario) / 15 min
// (mensual) en memoria por tenant para no golpear la DB en cada llamada
// LLM. `invalidateBudgetCache(tenantId)` se invoca desde el endpoint de
// configuración para refrescar inmediatamente tras un cambio. La cuenta
// de `spent` puede quedar ligeramente desfasada respecto al DecisionLog
// real, pero el riesgo de over-spend en esa ventana es despreciable:
//   - Diario (5 min): 10 LLM calls/min × 5 min × ~$0.01 = $0.50 peor caso.
//   - Mensual (15 min): $1.50 peor caso — acceptable para un cap de $200.

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * Presupuesto diario por defecto cuando el tenant no tiene override en
 * `Setting`. $10/día cubre ~1000 llamadas LLM a glm-4.6 (~$0.01/call)
 * — suficiente para una operación normal de un solo tenant.
 */
const DEFAULT_DAILY_BUDGET_USD = 10

/**
 * SPRINT-AI-FINAL-001 §2 — presupuesto mensual por defecto. $200/mes
 * cubre ~20k llamadas LLM a glm-4.6 — suficiente para un tenant con
 * tráfico moderado (~600/día). Tenants con mayor volumen pueden subir
 * el cap vía `Setting` key `llm_monthly_budget_usd::{tenantId}`.
 */
const DEFAULT_MONTHLY_BUDGET_USD = 200

const BUDGET_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos (diario)
const MONTHLY_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutos (mensual — agregación más cara)

interface BudgetCache {
  budget: number
  spent: number
  fetchedAt: number
}

// Caches separados — el mensual se actualiza con menos frecuencia porque
// la agregación involucra más filas (todo el mes vs. solo hoy).
const budgetCache = new Map<string, BudgetCache>()
const monthlyBudgetCache = new Map<string, BudgetCache>()

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
 * SPRINT-AI-FINAL-001 §2 — devuelve el presupuesto mensual + gasto
 * acumulado en el mes actual + restante para un tenant. Resuelve el
 * budget desde `Setting` (override por tenant) o cae al default ($200).
 *
 * El "mes" se calcula con `new Date(now.getFullYear(), now.getMonth(), 1)`
 * — primer día del mes calendario local. Se reinicia automáticamente el
 * 1ro de cada mes (no se necesita cron).
 *
 * Cachea el resultado 15 min — la agregación mensual involucra más filas
 * en `DecisionLog` que la diaria (potencialmente miles vs. cientos), así
 * que la caché es más larga para no golpear la DB.
 */
export async function getTenantMonthlyBudget(tenantId: string): Promise<{ budget: number; spent: number; remaining: number }> {
  const now = Date.now()
  const cached = monthlyBudgetCache.get(tenantId)

  if (cached && now - cached.fetchedAt < MONTHLY_CACHE_TTL_MS) {
    return {
      budget: cached.budget,
      spent: cached.spent,
      remaining: Math.max(0, cached.budget - cached.spent),
    }
  }

  const budgetSetting = await db.setting.findFirst({
    where: { key: `llm_monthly_budget_usd::${tenantId}` },
  })
  const parsed = budgetSetting ? parseFloat(budgetSetting.value) : NaN
  const budget = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_BUDGET_USD

  const now2 = new Date()
  const monthStart = new Date(now2.getFullYear(), now2.getMonth(), 1)

  const result = await db.decisionLog.aggregate({
    where: {
      tenantId,
      createdAt: { gte: monthStart },
      costUsd: { not: null },
    },
    _sum: { costUsd: true },
  })

  const spent = result._sum.costUsd || 0

  monthlyBudgetCache.set(tenantId, { budget, spent, fetchedAt: now })

  return {
    budget,
    spent,
    remaining: Math.max(0, budget - spent),
  }
}

/**
 * SPRINT-AI-FINAL-001 §2 — verifica el presupuesto DIARIO antes de una
 * llamada LLM. Extraído del antiguo `checkBudgetBeforeCall` (que ahora
 * orquesta diario + mensual). Devuelve `{allowed, remaining, message?}`.
 *
 * No lanza — errores de DB se loguean y se permite la llamada (fail-open):
 * preferimos servir al usuario y arriesgar over-spend antes que bloquear
 * todo el tráfico de LLM por un problema transitorio de la DB.
 */
export async function checkDailyBudget(tenantId: string): Promise<{
  allowed: boolean
  remaining: number
  message?: string
}> {
  try {
    const { budget, spent, remaining } = await getTenantBudget(tenantId)

    if (remaining <= 0) {
      logger.warn({ tenantId, budget, spent }, 'LLM daily budget exceeded')
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
      'Daily budget check failed — failing open (allowing LLM call)',
    )
    return { allowed: true, remaining: Infinity }
  }
}

/**
 * SPRINT-AI-FINAL-001 §2 — verifica el presupuesto MENSUAL antes de una
 * llamada LLM. Mismo contrato que `checkDailyBudget`. Fail-open ante
 * errores de DB (igual que el diario).
 *
 * El `remaining` se reinicia el 1ro de cada mes (cuando `getTenantMonthlyBudget`
 * calcula un nuevo `monthStart`).
 */
export async function checkMonthlyBudget(tenantId: string): Promise<{
  allowed: boolean
  remaining: number
  message?: string
}> {
  try {
    const { budget, spent, remaining } = await getTenantMonthlyBudget(tenantId)

    if (remaining <= 0) {
      logger.warn({ tenantId, budget, spent }, 'LLM monthly budget exceeded')
      return {
        allowed: false,
        remaining: 0,
        message: `Presupuesto mensual de LLM excedido ($${spent.toFixed(4)}/$${budget.toFixed(2)}). Se reinicia el próximo mes.`,
      }
    }

    return { allowed: true, remaining }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId },
      'Monthly budget check failed — failing open (allowing LLM call)',
    )
    return { allowed: true, remaining: Infinity }
  }
}

/**
 * Verifica el presupuesto antes de una llamada LLM. El caller debe invocar
 * esto justo antes del `chat()` y abortar con 429 si `allowed === false`.
 *
 * SPRINT-AI-FINAL-001 §2 — ahora verifica AMBOS caps (diario + mensual):
 *   1. Si el diario falla (remaining <= 0), se rechaza con el mensaje
 *      diario (más urgente — se reinicia mañana).
 *   2. Si el mensual falla, se rechaza con el mensaje mensual.
 *   3. Si ambos pasan, se devuelve el `remaining` más restrictivo (mínimo
 *      entre diario y mensual) — útil para que el caller pueda mostrar
 *      "te quedan $X" sabiendo que es el cap más cercano a agotarse.
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
  const dailyCheck = await checkDailyBudget(tenantId)
  if (!dailyCheck.allowed) return dailyCheck

  const monthlyCheck = await checkMonthlyBudget(tenantId)
  if (!monthlyCheck.allowed) return monthlyCheck

  // Ambos pasaron — devolver el remaining más restrictivo. Si alguno
  // fail-open (Infinity), Math.min cae al finito del otro. Si ambos
  // fail-open (DB caída), devuelve Infinity — el caller puede usarlo como
  // señal de "no se pudo verificar, asumiendo ilimitado".
  return { allowed: true, remaining: Math.min(dailyCheck.remaining, monthlyCheck.remaining) }
}

/**
 * Invalida la entrada de cache para un tenant (o todo el cache si se llama
 * sin argumento). Se invoca desde el endpoint `/api/llm/budget` POST tras
 * actualizar el Setting, para que el siguiente check refleje el nuevo
 * presupuesto inmediatamente.
 *
 * SPRINT-AI-FINAL-001 §2 — ahora invalida AMBOS caches (diario + mensual)
 * porque el endpoint POST puede actualizar cualquiera de los dos (o ambos
 * en una sola llamada).
 */
export function invalidateBudgetCache(tenantId?: string): void {
  if (tenantId) {
    budgetCache.delete(tenantId)
    monthlyBudgetCache.delete(tenantId)
  } else {
    budgetCache.clear()
    monthlyBudgetCache.clear()
  }
}
