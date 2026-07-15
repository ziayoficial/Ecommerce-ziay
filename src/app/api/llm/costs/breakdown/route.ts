import { NextRequest, NextResponse } from 'next/server'
import { resolveTenantId } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { db } from '@/lib/db'

// GET /api/llm/costs/breakdown?tenantId=X&days=30
//
// SPRINT-AI-FINAL-001 §4 — endpoint para el dashboard de costos LLM con
// granularidad diaria + por agente. A diferencia de `/api/llm/costs` (que
// devuelve agregados por agente + modelo + día), este endpoint devuelve
// una serie temporal diaria + un breakdown por agente — el shape exacto
// que necesita un chart de Recharts en el dashboard.
//
// Respuesta:
//   {
//     period: { days, startDate, endDate },
//     byDay:   [{ date, costUsd, totalTokens, callCount, avgLatencyMs }],
//     byAgent: [{ agent, costUsd, totalTokens, callCount }],
//     total:   { costUsd, totalTokens, callCount }
//   }
//
// Notas:
//   - Filtrado por tenant vía `resolveTenantId` (tenant users → su propio
//     tenant; platform admins → cualquier tenant vía `?tenantId=`). Si no
//     se proporciona `tenantId` (platform admin sin parámetro), se
//     devuelve 400 — el breakdown no agrega a través de tenants.
//   - `byDay` se calcula en memoria desde findMany (Prisma no soporta
//     `date_trunc` de forma portable entre SQLite y Postgres). Para
//     rangos largos (>180 días) considerar migrar a `$queryRaw` con SQL
//     específico del provider — ver Next Actions en worklog Sprint 5B.
//   - `costUsd` se redondea a 4 decimales (1/100 de centavo) para evitar
//     ruido de punto flotante en el chart.
/**
 * GET /api/llm/costs/breakdown
 *
 * Daily + per-agent LLM cost breakdown for charting.
 *
 * @security Requires authentication + tenant access
 * @returns Daily time series + per-agent aggregation + period totals
 */
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error

  // Platform admin sin parámetro → no tiene sentido hacer "breakdown
  // agregado" a través de tenants (cada tenant tiene su propia serie
  // temporal). Pedimos el parámetro.
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId requerido para el breakdown de costos' },
      { status: 400 },
    )
  }

  const days = Number(req.nextUrl.searchParams.get('days') || '30')
  const startDate = new Date(Date.now() - days * 86_400_000)

  // Get all decision logs in the period — los necesitamos para bucketing
  // por día + por agente. Seleccionamos solo los campos necesarios para
  // no transferir más datos de los que usaremos (input/output JSON pueden
  // ser grandes).
  const logs = await db.decisionLog.findMany({
    where: {
      tenantId,
      createdAt: { gte: startDate },
      costUsd: { not: null },
    },
    select: {
      createdAt: true,
      costUsd: true,
      totalTokens: true,
      agentName: true,
      model: true,
      latencyMs: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // Group by day (YYYY-MM-DD) + por agente — dos agregaciones en una sola
  // pasada para no iterar dos veces.
  const byDay: Record<string, { cost: number; tokens: number; calls: number; totalLatency: number }> = {}
  const byAgent: Record<string, { cost: number; tokens: number; calls: number }> = {}

  for (const log of logs) {
    const day = log.createdAt.toISOString().slice(0, 10) // YYYY-MM-DD
    if (!byDay[day]) byDay[day] = { cost: 0, tokens: 0, calls: 0, totalLatency: 0 }
    byDay[day].cost += log.costUsd ?? 0
    byDay[day].tokens += log.totalTokens ?? 0
    byDay[day].calls += 1
    byDay[day].totalLatency += log.latencyMs ?? 0

    if (!byAgent[log.agentName]) byAgent[log.agentName] = { cost: 0, tokens: 0, calls: 0 }
    byAgent[log.agentName].cost += log.costUsd ?? 0
    byAgent[log.agentName].tokens += log.totalTokens ?? 0
    byAgent[log.agentName].calls += 1
  }

  return NextResponse.json({
    period: { days, startDate, endDate: new Date() },
    // Serie temporal diaria — ordenada por fecha asc (relevante para
    // charts de líneas/área). Redondeo a 4 decimales para evitar ruido
    // de punto flotante.
    byDay: Object.entries(byDay)
      .map(([day, data]) => ({
        date: day,
        costUsd: Math.round(data.cost * 10000) / 10000,
        totalTokens: data.tokens,
        callCount: data.calls,
        // Latencia promedio del día — útil para correlacionar picos de
        // costo con picos de latencia (p.ej. si el provider está lento).
        avgLatencyMs: data.calls > 0 ? Math.round(data.totalLatency / data.calls) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    // Breakdown por agente — ordenado por costo desc (el agente más
    // caro primero — útil para identificar quick wins de optimización).
    byAgent: Object.entries(byAgent)
      .map(([agent, data]) => ({
        agent,
        costUsd: Math.round(data.cost * 10000) / 10000,
        totalTokens: data.tokens,
        callCount: data.calls,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    // Totales del periodo — un solo objeto para que el dashboard muestre
    // "Total: $X (Y llamadas, Z tokens)" sin tener que agregar client-side.
    total: {
      costUsd: Math.round(logs.reduce((s, l) => s + (l.costUsd ?? 0), 0) * 10000) / 10000,
      totalTokens: logs.reduce((s, l) => s + (l.totalTokens ?? 0), 0),
      callCount: logs.length,
    },
  })
})
