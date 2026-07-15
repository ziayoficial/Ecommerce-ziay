import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTenantId, requireRole, requireTenantAccess } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { db } from '@/lib/db'
// SPRINT-AI-AGENTS-003 §3 — endpoint para consultar + configurar el
// presupuesto diario de LLM por tenant. Lee/escribe los Settings
// `llm_daily_budget_usd::{tenantId}` y `llm_monthly_budget_usd::{tenantId}`
// que consumen `getTenantBudget` y `getTenantMonthlyBudget`.
//
// SPRINT-AI-FINAL-001 §2 — añadido soporte para el cap mensual además
// del diario. El GET ahora devuelve ambos blocks (`daily` + `monthly`).
// El POST acepta `budgetUsd` (diario, existente) y `monthlyBudgetUsd`
// (mensual, nuevo, opcional). Se puede actualizar uno solo o ambos en
// una sola llamada.
import {
  getTenantBudget,
  getTenantMonthlyBudget,
  invalidateBudgetCache,
} from '@/lib/llm/budget'

// GET /api/llm/budget?tenantId=X
//
// Devuelve los presupuestos diario + mensual configurados para el tenant
// + el gasto acumulado + el restante para cada uno. Tenant users → siempre
// su propio tenant; platform admins → pueden consultar cualquier tenant
// vía `?tenantId=`.
//
// Respuesta:
//   {
//     tenantId,
//     // Top-level (backward-compat con Sprint 6B): diario.
//     budget, spent, remaining, resetAt,
//     // SPRINT-AI-FINAL-001 §2 — bloque mensual adicional.
//     monthly: { budget, spent, remaining, resetAt }
//   }
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error

  // Platform admin sin parámetro → no tiene sentido consultar "presupuesto
  // agregado" (cada tenant tiene el suyo). Pedimos el parámetro.
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId requerido para consultar el presupuesto' },
      { status: 400 },
    )
  }

  const daily = await getTenantBudget(tenantId)
  const monthly = await getTenantMonthlyBudget(tenantId)

  return NextResponse.json({
    tenantId,
    // Top-level: daily (backward-compat — Sprint 6B devolvía estos campos).
    budget: daily.budget,
    spent: daily.spent,
    remaining: daily.remaining,
    resetAt: nextDailyResetIso(),
    // SPRINT-AI-FINAL-001 §2 — bloque mensual. Mismo shape que el daily.
    monthly: {
      budget: monthly.budget,
      spent: monthly.spent,
      remaining: monthly.remaining,
      resetAt: nextMonthlyResetIso(),
    },
  })
})

// POST /api/llm/budget
// Body: { tenantId: string, budgetUsd?: number, monthlyBudgetUsd?: number }
//
// Admin-only. Actualiza uno o ambos presupuestos del tenant. Crea o actualiza
// los Settings `llm_daily_budget_usd::{tenantId}` y/o
// `llm_monthly_budget_usd::{tenantId}`. Invalida los caches para que el
// siguiente check refleje el cambio inmediatamente.
//
// Al menos uno de `budgetUsd` o `monthlyBudgetUsd` debe estar presente.
// Los dos son opcionales individualmente para soportar updates parciales
// (cambiar solo el diario, solo el mensual, o ambos en una sola llamada).
const SetBudgetSchema = z.object({
  tenantId: z.string().min(1),
  budgetUsd: z.number().positive().max(10_000).optional(),
  monthlyBudgetUsd: z.number().positive().max(100_000).optional(),
}).strict().refine(
  (data) => data.budgetUsd !== undefined || data.monthlyBudgetUsd !== undefined,
  { message: 'Debe proporcionar al menos budgetUsd o monthlyBudgetUsd' },
)

export const POST = withErrorHandling(async (req: NextRequest) => {
  // Admin-only: cambiar el presupuesto de LLM puede tener impacto financiero
  // (un tenant con budget alto puede disparar costos). Restringido a
  // `admin` (super-user tenant-bound) — los platform roles no tienen
  // override aquí por diseño.
  const { error: roleError } = await requireRole(['admin'])
  if (roleError) return roleError

  const raw = await req.json().catch(() => ({}))
  const parsed = SetBudgetSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validación fallida', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { tenantId, budgetUsd, monthlyBudgetUsd } = parsed.data

  // Verificar que el admin pertenece al tenant que intenta modificar
  // (requireRole ya valida que sea admin, pero `requireTenantAccess`
  // adicionalmente valida la pertenencia al tenant).
  const { error: tenantError } = await requireTenantAccess(tenantId)
  if (tenantError) return tenantError

  // Upsert del Setting diario (si se proporcionó). El valor se guarda como
  // string (el schema de Setting es `value String` — no es numérico).
  if (budgetUsd !== undefined) {
    const dailyKey = `llm_daily_budget_usd::${tenantId}`
    await db.setting.upsert({
      where: { key: dailyKey },
      update: { value: String(budgetUsd) },
      create: { key: dailyKey, value: String(budgetUsd) },
    })
  }

  // Upsert del Setting mensual (si se proporcionó).
  if (monthlyBudgetUsd !== undefined) {
    const monthlyKey = `llm_monthly_budget_usd::${tenantId}`
    await db.setting.upsert({
      where: { key: monthlyKey },
      update: { value: String(monthlyBudgetUsd) },
      create: { key: monthlyKey, value: String(monthlyBudgetUsd) },
    })
  }

  // Invalidar AMBOS caches para que el siguiente checkBudgetBeforeCall
  // refleje el nuevo presupuesto sin esperar los TTLs (5 min diario,
  // 15 min mensual).
  invalidateBudgetCache(tenantId)

  // Devolver el estado actualizado (ambos budgets).
  const daily = await getTenantBudget(tenantId)
  const monthly = await getTenantMonthlyBudget(tenantId)

  return NextResponse.json({
    ok: true,
    tenantId,
    budget: daily.budget,
    spent: daily.spent,
    remaining: daily.remaining,
    resetAt: nextDailyResetIso(),
    monthly: {
      budget: monthly.budget,
      spent: monthly.spent,
      remaining: monthly.remaining,
      resetAt: nextMonthlyResetIso(),
    },
  })
})

/**
 * Devuelve la fecha ISO de la próxima medianoche local (cuando se reinicia
 * el contador diario). Útil para que el dashboard muestre "reinicia en X
 * horas" al admin.
 */
function nextDailyResetIso(): string {
  const next = new Date()
  next.setHours(24, 0, 0, 0) // próxima medianoche local
  return next.toISOString()
}

/**
 * SPRINT-AI-FINAL-001 §2 — devuelve la fecha ISO del primer día del mes
 * siguiente (cuando se reinicia el contador mensual). Ej: si hoy es
 * 2024-03-15, devuelve 2024-04-01T00:00:00 (en TZ local, expresado como
 * ISO UTC).
 */
function nextMonthlyResetIso(): string {
  const now = new Date()
  // Primer día del mes siguiente. Si estamos en diciembre (mes 11),
  // `setMonth(12)` automáticamente pasa al enero del año siguiente.
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0)
  return next.toISOString()
}
