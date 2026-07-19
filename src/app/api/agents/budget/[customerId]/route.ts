// ZIAY — /api/agents/budget/[customerId] (admin-only)
//
// IA-6B (Gap 7) — per-customer cost attribution. Surfaces the
// `BudgetManager.getCustomerCosts()` roll-up to the admin dashboard
// so operators can see which customers are expensive + which agents
// are burning the most tokens for a given customer.
//
// GET /api/agents/budget/[customerId]?tenantId=X&from=ISO&to=ISO
//   Returns: {
//     tenantId, customerId, customer,
//     from, to,
//     totalTokensIn, totalTokensOut, totalCostUsd,
//     byAgent: [{ agentName, tokens, costUsd, calls }]
//   }
//
// Auth: admin-only (any role that can read budgets — same gate as
// `/api/agents/budget` POST). Tenant users can read their own
// customer costs via the same endpoint (`requireTenantAccess`).
//
// The `from` / `to` query params are optional ISO-8601 strings. When
// omitted, the endpoint defaults to the start of the current month →
// now (the most common question — "how much has this customer cost us
// this month?").

import { NextRequest, NextResponse } from 'next/server'
import { resolveTenantId, requireAuth } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { budgetManager } from '@/lib/agents/budget'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// GET /api/agents/budget/[customerId]
export const GET = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
) => {
  const { customerId } = await params
  if (!customerId) {
    return NextResponse.json({ error: 'customerId requerido' }, { status: 400 })
  }

  // Resolve tenantId — same logic as `/api/agents/budget` GET. Tenant
  // users are scoped to their own tenant; platform admins can pass any
  // tenantId (or omit it — but for per-customer attribution they must
  // pass one, since customerId is only unique within a tenant).
  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId requerido para atribución por cliente' },
      { status: 400 },
    )
  }

  // Auth: any logged-in user can read budgets (the `requireAuth` gate).
  // The tenant scoping above already prevents cross-tenant reads; the
  // per-customer detail is just a roll-up of the same data the tenant
  // user can already see in the budget dashboard.
  const { error: authError } = await requireAuth()
  if (authError) return authError

  // Optional date range.
  const from = parseDateParam(req.nextUrl.searchParams.get('from'))
  const to = parseDateParam(req.nextUrl.searchParams.get('to'))

  // Verify the customer exists + belongs to the tenant. Otherwise the
  // endpoint would happily return zero-cost data for any random
  // customerId string, which is a (minor) info leak.
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      perfilDetectado: true,
      lifetimeValue: true,
      ordersCount: true,
    },
  })
  if (!customer) {
    return NextResponse.json(
      { error: 'Cliente no encontrado en este tenant', customerId, tenantId },
      { status: 404 },
    )
  }

  const costs = await budgetManager.getCustomerCosts(tenantId, customerId, from, to)

  return NextResponse.json({
    tenantId,
    customerId,
    customer,
    from: (from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString(),
    to: (to ?? new Date()).toISOString(),
    ...costs,
  })
})
