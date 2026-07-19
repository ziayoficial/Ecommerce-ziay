// ZIAY — /api/agents/budget (admin-only)
//
// IA-2 (agent-hardening) — surfaces the new token+USD budget manager
// (alongside the existing `/api/llm/budget` USD-only endpoint).
//
// GET  /api/agents/budget?tenantId=X
//   Returns the current daily / monthly / per-conversation budget status
//   for the tenant — tokens used, tokens remaining, cost spent, cost
//   remaining, plan, last reset.
//
// POST /api/agents/budget
//   Body: { tenantId, dailyTokens?, monthlyTokens?, dailyCostUsd?, monthlyCostUsd? }
//   Overrides the plan-derived defaults for the tenant. Persists to the
//   `Setting` table (keys `agent_budget::{tenantId}::{period}::{field}`)
//   and refreshes the in-memory cache immediately.
//
// Auth: admin-only. Token budgets directly affect cost — only platform
// admins should set them. Tenant users can read their own budget via the
// GET endpoint (scoped by `requireTenantAccess`).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTenantId, requireRole } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { budgetManager, PLAN_BY_MONETIZATION, PLAN_LIMITS, type BudgetPlan } from '@/lib/agents/budget'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/agents/budget?tenantId=X
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId requerido para consultar el presupuesto' },
      { status: 400 },
    )
  }

  const status = await budgetManager.getStatus(tenantId)

  // Resolve the plan name + defaults for context (so the admin UI can
  // show "Plan: Business — defaults 250K/day, 5M/month, $20/day, $400/month").
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { planMonetizacion: true, nombreNegocio: true, slug: true },
  })
  const plan: BudgetPlan =
    PLAN_BY_MONETIZATION[tenant?.planMonetizacion ?? 'conecta'] ?? 'starter'
  const planDefaults = PLAN_LIMITS[plan]

  return NextResponse.json({
    tenantId,
    tenant: tenant
      ? { slug: tenant.slug, nombreNegocio: tenant.nombreNegocio, planMonetizacion: tenant.planMonetizacion }
      : null,
    plan,
    planDefaults,
    daily: status.daily,
    monthly: status.monthly,
    conversation: status.conversation,
  })
})

// POST /api/agents/budget
const SetLimitsBody = z.object({
  tenantId: z.string().min(1),
  dailyTokens: z.number().int().nonnegative().optional(),
  monthlyTokens: z.number().int().nonnegative().optional(),
  dailyCostUsd: z.number().nonnegative().optional(),
  monthlyCostUsd: z.number().nonnegative().optional(),
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const { error } = await requireRole(['admin'])
  if (error) return error

  const body = SetLimitsBody.safeParse(await req.json())
  if (!body.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: body.error.issues },
      { status: 400 },
    )
  }
  const { tenantId, ...limits } = body.data

  // Make sure the tenant exists before writing settings — otherwise an
  // admin typo creates orphan Setting rows that silently never match.
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  })
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  await budgetManager.setLimits(tenantId, limits)

  const status = await budgetManager.getStatus(tenantId)
  return NextResponse.json({ ok: true, tenantId, limits, status })
})
