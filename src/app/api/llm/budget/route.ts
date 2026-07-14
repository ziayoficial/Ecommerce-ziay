import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTenantId, requireRole, requireTenantAccess } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { db } from '@/lib/db'
// SPRINT-AI-AGENTS-003 §3 — endpoint para consultar + configurar el
// presupuesto diario de LLM por tenant. Lee/escribe el Setting
// `llm_daily_budget_usd::{tenantId}` que consume `getTenantBudget`.
import {
  getTenantBudget,
  invalidateBudgetCache,
} from '@/lib/llm/budget'

// GET /api/llm/budget?tenantId=X
//
// Devuelve el presupuesto diario configurado para el tenant + el gasto
// acumulado hoy + el restante. Tenant users → siempre su propio tenant;
// platform admins → pueden consultar cualquier tenant vía `?tenantId=`.
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

  const { budget, spent, remaining } = await getTenantBudget(tenantId)

  return NextResponse.json({
    tenantId,
    budget,
    spent,
    remaining,
    resetAt: nextResetIso(),
  })
})

// POST /api/llm/budget
// Body: { tenantId: string, budgetUsd: number }
//
// Admin-only. Actualiza el presupuesto diario del tenant. Crea o actualiza
// el Setting `llm_daily_budget_usd::{tenantId}`. Invalida el cache para
// que el siguiente check refleje el cambio inmediatamente.
const SetBudgetSchema = z.object({
  tenantId: z.string().min(1),
  budgetUsd: z.number().positive().max(10_000),
}).strict()

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

  const { tenantId, budgetUsd } = parsed.data

  // Verificar que el admin pertenece al tenant que intenta modificar
  // (requireRole ya valida que sea admin, pero `requireTenantAccess`
  // adicionalmente valida la pertenencia al tenant).
  const { error: tenantError } = await requireTenantAccess(tenantId)
  if (tenantError) return tenantError

  const key = `llm_daily_budget_usd::${tenantId}`
  // Upsert: si el Setting ya existe (key es @unique), lo actualiza; si no,
  // lo crea. El valor se guarda como string (el schema de Setting es
  // `value String` — no es numérico).
  await db.setting.upsert({
    where: { key },
    update: { value: String(budgetUsd) },
    create: { key, value: String(budgetUsd) },
  })

  // Invalidar el cache para que el siguiente checkBudgetBeforeCall refleje
  // el nuevo presupuesto sin esperar los 5 min del TTL.
  invalidateBudgetCache(tenantId)

  const { budget, spent, remaining } = await getTenantBudget(tenantId)

  return NextResponse.json({
    ok: true,
    tenantId,
    budget,
    spent,
    remaining,
    resetAt: nextResetIso(),
  })
})

/**
 * Devuelve la fecha ISO de la próxima medianoche local (cuando se reinicia
 * el contador diario). Útil para que el dashboard muestre "reinicia en X
 * horas" al admin.
 */
function nextResetIso(): string {
  const next = new Date()
  next.setHours(24, 0, 0, 0) // próxima medianoche local
  return next.toISOString()
}
