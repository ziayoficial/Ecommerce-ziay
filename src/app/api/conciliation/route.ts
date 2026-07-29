import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'

// GET /api/conciliation?tenantId=...
// Anti-fuga conciliation (Saramantha §17.9): compares GMV reported by the agent
// (orders with origen='agente_whatsapp') against total sales the tenant reports
// (passed as externalGmv in query, or 0 if not provided).
// A sustained gap is the early signal of order leakage (fuga).
//
// AUDIT-FINTECH R-4 — the previous handler did NOT call `requireTenantAccess`,
// so anyone with a `tenantId` could query the GMV of any tenant. Now we
// authenticate + scope the request to the caller's tenant before touching
// the DB. Mirrors the pattern used by every other tenant-scoped route
// (e.g. `/api/payments/local`, `/api/payments/create-link`).
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const externalGmv = Number(req.nextUrl.searchParams.get('externalGmv') || '0')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  // AUDIT-FINTECH R-4 — auth + tenant access check BEFORE any DB query so a
  // caller without a valid session, or with a tenant mismatch, gets 401/403
  // instead of leaking cross-tenant GMV.
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const agentOrders = await db.order.findMany({
    where: { tenantId, origen: 'agente_whatsapp' },
    select: { total: true, status: true, createdAt: true },
  })
  const agentGmv = agentOrders.reduce((s, o) => s + o.total, 0)

  // If externalGmv provided (from tenant's own cash register / bank / ecommerce backend),
  // compute the gap. If not, we just report the agent GMV and flag that conciliation
  // requires the external number.
  const gap = externalGmv - agentGmv
  const gapPct = externalGmv > 0 ? (gap / externalGmv) * 100 : 0
  const riskLevel = externalGmv === 0 ? 'no_data' : Math.abs(gapPct) < 5 ? 'low' : Math.abs(gapPct) < 15 ? 'medium' : 'high'

  // Per-status breakdown to identify where leakage might occur
  const byStatus: Record<string, { count: number; gmv: number }> = {}
  for (const o of agentOrders) {
    if (!byStatus[o.status]) byStatus[o.status] = { count: 0, gmv: 0 }
    byStatus[o.status].count++
    byStatus[o.status].gmv += o.total
  }

  return NextResponse.json({
    tenantId,
    agentGmv: Math.round(agentGmv),
    agentOrders: agentOrders.length,
    externalGmv: externalGmv > 0 ? externalGmv : null,
    gap: externalGmv > 0 ? Math.round(gap) : null,
    gapPct: externalGmv > 0 ? Number(gapPct.toFixed(1)) : null,
    riskLevel,
    riskLabel: riskLevel === 'no_data' ? 'Sin dato externo — pide al tenant su GMV de caja/banco para conciliar'
      : riskLevel === 'low' ? 'Brecha < 5% — sin fuga significativa'
      : riskLevel === 'medium' ? 'Brecha 5-15% — investigar pedidos fuera del sistema'
      : 'Brecha > 15% — fuga probable, activar mitigaciones',
    byStatus,
    mitigations: riskLevel === 'high' ? [
      '1. Un solo número público por tenant (todas las pautas apuntan a la WABA)',
      '2. Conciliación periódica GMV agente vs caja/banco del cliente',
      '3. Activar log completo de conversación (ya activo en Message model)',
      '4. Fricción de proceso a favor del canal oficial (checkout guiado + guía auto)',
      '5. Cláusula contractual explícita sobre fuga de pedidos',
    ] : [],
  })
}
