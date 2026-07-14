import { NextRequest, NextResponse } from 'next/server'
import { resolveTenantId } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { db } from '@/lib/db'

// GET /api/llm/costs?tenantId=X&days=30
//
// SPRINT-AI-AGENTS-002 §2 — dashboard de costos LLM. Agrega UsageEvent
// (en realidad DecisionLog, que es donde persiste el route handler de
// /api/agents/[agentName] — §A-6 de SPRINT-AI-LLM-ADAPTER-001) por agente,
// modelo, y día, más totales del periodo.
//
// Respuesta:
//   {
//     period: { days, startDate, endDate },
//     total: { costUsd, totalTokens, promptTokens, completionTokens,
//              callCount, avgLatencyMs },
//     byAgent: [{ agent, costUsd, totalTokens, callCount }],
//     byModel: [{ model, costUsd, totalTokens, callCount }],
//     byDay:   [{ date, costUsd, totalTokens, callCount }]
//   }
//
// Notas:
//   - Filtrado por tenant vía `resolveTenantId` (tenant users → su propio
//     tenant; platform admins → cualquier tenant o agregado "all tenants").
//   - `byDay` se calcula en memoria desde findMany (Prisma no soporta
//     `date_trunc` de forma portable entre SQLite y Postgres). Para
//     rangos largos (>180 días) considerar migrar a `$queryRaw` con SQL
//     específico del provider.
//   - `model: { not: null }` en byModel para no agrupar filas de fallback
//     (cuando el LLM falló antes de responder, model queda en null).
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error

  const days = Number(req.nextUrl.searchParams.get('days') || '30')
  const startDate = new Date(Date.now() - days * 86_400_000)

  // Filtro base por tenant + rango. Si `tenantId` es undefined (platform
  // admin sin parámetro), agregamos a través de todos los tenants.
  const where = {
    ...(tenantId ? { tenantId } : {}),
    createdAt: { gte: startDate },
  }

  // ── Agregados por agente ─────────────────────────────────────────────────
  const byAgentRows = await db.decisionLog.groupBy({
    by: ['agentName'],
    where,
    _sum: { costUsd: true, totalTokens: true },
    _count: true,
    orderBy: { _sum: { costUsd: 'desc' } },
  })

  // ── Agregados por modelo ─────────────────────────────────────────────────
  // Excluye filas de fallback (model IS NULL — el LLM no respondió).
  const byModelRows = await db.decisionLog.groupBy({
    by: ['model'],
    where: { ...where, model: { not: null } },
    _sum: { costUsd: true, totalTokens: true },
    _count: true,
    orderBy: { _sum: { costUsd: 'desc' } },
  })

  // ── Agregados por día (en memoria) ───────────────────────────────────────
  // Prisma no soporta `date_trunc` de forma portable. Para rangos cortos
  // (≤90 días, el caso típico del dashboard) el costo de traer las filas
  // y agregar en JS es despreciable (<10k filas).
  const dailyRows = await db.decisionLog.findMany({
    where,
    select: {
      createdAt: true,
      costUsd: true,
      totalTokens: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const byDayMap = new Map<string, { costUsd: number; totalTokens: number; callCount: number }>()
  for (const row of dailyRows) {
    const dayKey = row.createdAt.toISOString().slice(0, 10) // YYYY-MM-DD
    const entry = byDayMap.get(dayKey) ?? { costUsd: 0, totalTokens: 0, callCount: 0 }
    entry.costUsd += row.costUsd ?? 0
    entry.totalTokens += row.totalTokens ?? 0
    entry.callCount += 1
    byDayMap.set(dayKey, entry)
  }

  // ── Totales del periodo ──────────────────────────────────────────────────
  const total = await db.decisionLog.aggregate({
    where,
    _sum: {
      costUsd: true,
      totalTokens: true,
      promptTokens: true,
      completionTokens: true,
    },
    _count: true,
  })

  // Latencia promedio — excluye filas sin latencyMs (LLM no respondió).
  const avgLatency = await db.decisionLog.aggregate({
    where: { ...where, latencyMs: { not: null } },
    _avg: { latencyMs: true },
  })

  return NextResponse.json({
    period: { days, startDate, endDate: new Date() },
    total: {
      costUsd: total._sum.costUsd ?? 0,
      totalTokens: total._sum.totalTokens ?? 0,
      promptTokens: total._sum.promptTokens ?? 0,
      completionTokens: total._sum.completionTokens ?? 0,
      callCount: total._count,
      avgLatencyMs: avgLatency._avg.latencyMs ?? 0,
    },
    byAgent: byAgentRows.map((a) => ({
      agent: a.agentName,
      costUsd: a._sum.costUsd ?? 0,
      totalTokens: a._sum.totalTokens ?? 0,
      callCount: a._count,
    })),
    byModel: byModelRows.map((m) => ({
      model: m.model,
      costUsd: m._sum.costUsd ?? 0,
      totalTokens: m._sum.totalTokens ?? 0,
      callCount: m._count,
    })),
    byDay: Array.from(byDayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  })
})
