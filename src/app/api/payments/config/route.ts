import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'

// Get payment strategy config per channel
//
// SPRINT8-SERVICES-REST-001 — left inline. Each method touches at most
// two unrelated tables (`Channel` for the strategy fields, `Setting` for
// global thresholds). Per rule #2 (1-2 simple db calls OK to leave),
// neither table warrants a dedicated service on its own — `Setting` is
// a tiny key/value table and `Channel` is a CRUD surface covered by the
// `/api/channels` route.
// TODO: migrate to service layer if more payment-strategy logic accumulates.
export async function GET() {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const channels = await db.channel.findMany({
      orderBy: { type: 'asc' },
    })
    const settings = await db.setting.findMany()
    return NextResponse.json({
      channels: channels.map(ch => ({
        id: ch.id,
        type: ch.type,
        name: ch.name,
        displayName: ch.displayName,
        country: ch.country,
        paymentStrategy: ch.paymentStrategy,
        requirePrepayMin: ch.requirePrepayMin,
        prepayDiscountPct: ch.prepayDiscountPct,
        codFee: ch.codFee,
      })),
      global: Object.fromEntries(settings.map(s => [s.key, s.value])),
    })
  } catch (err) {
    captureError(err as Error, { path: '/api/payments/config', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

// Update a channel's payment strategy
export async function PATCH(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const body = await req.json()
    const { channelId, ...fields } = body
    if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

    const data: Record<string, unknown> = {}
    if (fields.paymentStrategy) data.paymentStrategy = fields.paymentStrategy
    if (fields.requirePrepayMin !== undefined) data.requirePrepayMin = fields.requirePrepayMin
    if (fields.prepayDiscountPct !== undefined) data.prepayDiscountPct = fields.prepayDiscountPct
    if (fields.codFee !== undefined) data.codFee = fields.codFee

    const updated = await db.channel.update({ where: { id: channelId }, data })

    // Persist global settings too if provided
    if (fields.global) {
      for (const [k, v] of Object.entries(fields.global)) {
        await db.setting.upsert({ where: { key: k }, update: { value: String(v) }, create: { key: k, value: String(v) } })
      }
    }

    return NextResponse.json({ channel: updated })
  } catch (err) {
    captureError(err as Error, { path: '/api/payments/config', method: 'PATCH' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
