import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { getChannelContributions } from '@/lib/services/channel-cost.service'

const log = getLogger('api:finance:channel-contribution')

// GET /api/finance/channel-contribution?tenantId=X&startDate=2026-01-01&endDate=2026-01-31
//
// Returns the net contribution margin per channel for a tenant over an
// inclusive date range (study §14.1 — "margen neto de contribución por
// canal"). Each row is a `ChannelContribution` with:
//   - revenue, ordersCount, aov (average order value)
//   - cost breakdown: messageCost / aiTokenCost / adSpend / supportCost /
//     logisticsCost / paymentFee
//   - totalCost, netContribution, marginPct
//   - cac / cpl (proxied on ordersCount until a dedicated leads table exists)
//
// Auth: tenant-scoped via `requireTenantAccess`. Platform admins with no
// tenantId on their session can pass any `tenantId` (legacy "all tenants"
// super-user view).
//
// SPRINT-FINANCE-META-001
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId es requerido' },
      { status: 400 },
    )
  }

  const startDateStr = req.nextUrl.searchParams.get('startDate')
  const endDateStr = req.nextUrl.searchParams.get('endDate')
  if (!startDateStr || !endDateStr) {
    return NextResponse.json(
      { error: 'startDate y endDate son requeridos (formato YYYY-MM-DD)' },
      { status: 400 },
    )
  }

  // Parse + validate dates. Reject anything that isn't a real calendar day.
  const startDate = parseDayStart(startDateStr)
  const endDate = parseDayEnd(endDateStr)
  if (!startDate || !endDate) {
    return NextResponse.json(
      {
        error:
          'startDate y endDate deben ser fechas válidas en formato YYYY-MM-DD',
      },
      { status: 400 },
    )
  }
  if (startDate > endDate) {
    return NextResponse.json(
      { error: 'startDate no puede ser posterior a endDate' },
      { status: 400 },
    )
  }

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    const contributions = await getChannelContributions(
      tenantId,
      startDate,
      endDate,
    )
    log.info(
      { tenantId, startDate: startDate.toISOString(), endDate: endDate.toISOString(), channels: contributions.length },
      'Channel contribution report generated',
    )
    return NextResponse.json({
      tenantId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      channels: contributions,
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/finance/channel-contribution',
      method: 'GET',
      tenantId,
    })
    return NextResponse.json(
      {
        error: 'No se pudo generar el reporte de contribución por canal',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

/**
 * Parse a `YYYY-MM-DD` string into a `Date` at 00:00:00.000 local time.
 * Returns `null` on any parse failure — callers should 400 the request.
 *
 * We use a strict regex + a roll-over sanity check because the `Date`
 * constructor happily coerces `2026-13-40` into `2027-02-09`.
 */
function parseDayStart(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
  if (
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null
  }
  return d
}

/** Same as `parseDayStart` but at 23:59:59.999 (inclusive upper bound). */
function parseDayEnd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    23,
    59,
    59,
    999,
  )
  if (
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null
  }
  return d
}
