import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Get payment strategy config per channel
export async function GET() {
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
}

// Update a channel's payment strategy
export async function PATCH(req: NextRequest) {
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
}
