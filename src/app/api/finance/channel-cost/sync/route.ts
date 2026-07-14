import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { recordDailyChannelCosts } from '@/lib/services/channel-cost.service'

const log = getLogger('api:finance:channel-cost:sync')

// POST /api/finance/channel-cost/sync
//
// Manually trigger the daily channel-cost backfill for a tenant (study §14.1
// — "costo operativo del canal"). Intended to be wired to a cron job AND
// exposed as a manual "Sync now" button in the finance dashboard.
//
// Body:
//   { tenantId: string, date?: string /* YYYY-MM-DD, default = today */ }
//
// Response:
//   200 { ok: true, tenantId, date, channels: 4 }
//   400 { error: '...' }                 — invalid body / date
//   401 { error: 'Unauthorized' }        — no session
//   403 { error: 'Forbidden: ...' }      — tenant mismatch OR non-admin role
//
// Auth: `requireTenantAccess(tenantId)` + admin role. The sync is a
// destructive upsert (overwrites the day's row) so we gate it tighter than
// the read-only `/api/finance/channel-contribution` endpoint.
//
// SPRINT-FINANCE-META-001
const SyncSchema = z.object({
  tenantId: z.string().min(1, 'tenantId es requerido'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe tener formato YYYY-MM-DD')
    .optional(),
})

export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }

  const parsed = SyncSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  // Tenant scope — platform admins (no tenantId on session) can pass any
  // tenantId; tenant users are pinned to their own.
  const { session, error } = await requireTenantAccess(body.tenantId)
  if (error) return error

  // Role gate — admin only. The sync overwrites the day's `ChannelCost` row
  // so we don't want agents/traffickers triggering it.
  const role = session?.user?.role
  if (role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: se requiere rol admin para disparar la sincronización' },
      { status: 403 },
    )
  }

  // Parse the optional date. Default to today (local). Validate the
  // YYYY-MM-DD form strictly (Zod already did the regex, but the date
  // constructor silently rolls invalid months/days over — sanity check).
  let targetDate: Date
  if (body.date) {
    const parsed = parseDayStart(body.date)
    if (!parsed) {
      return NextResponse.json(
        { error: 'date no es una fecha de calendario válida' },
        { status: 400 },
      )
    }
    targetDate = parsed
  } else {
    targetDate = new Date()
  }

  try {
    await recordDailyChannelCosts(body.tenantId, targetDate)
    const dayBucket = new Date(targetDate)
    dayBucket.setHours(0, 0, 0, 0)
    log.info(
      { tenantId: body.tenantId, date: dayBucket.toISOString(), triggeredBy: session?.user?.email },
      'Channel cost daily sync completed',
    )
    return NextResponse.json({
      ok: true,
      tenantId: body.tenantId,
      date: dayBucket.toISOString(),
      channels: 4, // whatsapp | messenger | instagram | tiktok
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/finance/channel-cost/sync',
      method: 'POST',
      tenantId: body.tenantId,
    })
    return NextResponse.json(
      {
        error: 'No se pudo sincronizar los costos del canal',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

/** Parse `YYYY-MM-DD` to a `Date` at 00:00:00 local; null on roll-over. */
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
