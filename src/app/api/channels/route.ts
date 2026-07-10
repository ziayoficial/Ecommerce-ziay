import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/channels?tenantId=... — list channels for a tenant
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const channels = await db.channel.findMany({
    where: tenantId ? { tenantId } : {},
    orderBy: { type: 'asc' },
  })
  // Mask tokens — return hasToken flags instead of actual values
  const result = channels.map((c) => ({
    id: c.id, tenantId: c.tenantId, type: c.type, name: c.name, displayName: c.displayName,
    accountId: c.accountId, verified: c.verified, active: c.active, country: c.country,
    paymentStrategy: c.paymentStrategy, requirePrepayMin: c.requirePrepayMin,
    prepayDiscountPct: c.prepayDiscountPct, codFee: c.codFee,
    wabaId: c.wabaId, phoneNumberId: c.phoneNumberId, pageId: c.pageId, igAccountId: c.igAccountId,
    verifyToken: c.verifyToken, appSecret: c.appSecret ? '***' : null,
    hasWhatsappToken: !!c.whatsappToken,
    hasPageAccessToken: !!c.pageAccessToken,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  }))
  return NextResponse.json({ channels: result })
}

// POST /api/channels — create a new channel (e.g., add a new WhatsApp line)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { tenantId, type, name, displayName } = body
  if (!tenantId || !type || !name || !displayName) {
    return NextResponse.json({ error: 'tenantId, type, name, displayName required' }, { status: 400 })
  }

  const validTypes = ['whatsapp', 'messenger', 'instagram', 'telegram']
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `type must be one of: ${validTypes.join(', ')}` }, { status: 400 })
  }

  // Validate required fields by type
  if (type === 'whatsapp' && !body.wabaId) {
    return NextResponse.json({ error: 'WhatsApp channels require wabaId' }, { status: 400 })
  }
  if (type === 'messenger' && !body.pageId) {
    return NextResponse.json({ error: 'Messenger channels require pageId' }, { status: 400 })
  }
  if (type === 'instagram' && !body.igAccountId) {
    return NextResponse.json({ error: 'Instagram channels require igAccountId' }, { status: 400 })
  }

  const channel = await db.channel.create({
    data: {
      tenantId, type, name, displayName,
      accountId: body.accountId || null,
      verified: body.verified || false,
      active: body.active !== false,
      country: body.country || null,
      paymentStrategy: body.paymentStrategy || 'hybrid',
      requirePrepayMin: body.requirePrepayMin || null,
      prepayDiscountPct: body.prepayDiscountPct || 0,
      codFee: body.codFee || 0,
      // Credentials by type
      wabaId: body.wabaId || null,
      phoneNumberId: body.phoneNumberId || null,
      whatsappToken: body.whatsappToken || null,
      pageId: body.pageId || null,
      pageAccessToken: body.pageAccessToken || null,
      igAccountId: body.igAccountId || null,
      verifyToken: body.verifyToken || null,
      appSecret: body.appSecret || null,
    },
  })

  await db.auditLog.create({
    data: { tenantId, action: 'channel.created', entity: 'Channel', entityId: channel.id, meta: JSON.stringify({ type, name }) }
  })

  return NextResponse.json({ channel: { id: channel.id, type: channel.type, name: channel.name } })
}

// PATCH /api/channels — update a channel (e.g., update credentials)
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { channelId, ...fields } = body
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  // Build update data — only update provided fields
  const updateData: Record<string, unknown> = {}
  const allowedFields = [
    'name', 'displayName', 'accountId', 'verified', 'active', 'country',
    'paymentStrategy', 'requirePrepayMin', 'prepayDiscountPct', 'codFee',
    'wabaId', 'phoneNumberId', 'whatsappToken', 'pageId', 'pageAccessToken',
    'igAccountId', 'verifyToken', 'appSecret'
  ]
  for (const f of allowedFields) {
    if (fields[f] !== undefined) updateData[f] = fields[f]
  }

  const channel = await db.channel.update({ where: { id: channelId }, data: updateData })

  await db.auditLog.create({
    data: { tenantId: channel.tenantId, action: 'channel.updated', entity: 'Channel', entityId: channelId, meta: JSON.stringify(Object.keys(updateData)) }
  })

  return NextResponse.json({ channel: { id: channel.id, name: channel.name, updated: Object.keys(updateData) } })
}

// DELETE /api/channels — delete (deactivate) a channel
export async function DELETE(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId')
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  const channel = await db.channel.findUnique({ where: { id: channelId } })
  if (!channel) return NextResponse.json({ error: 'channel not found' }, { status: 404 })

  // Soft delete — deactivate instead of hard delete to preserve conversation history
  await db.channel.update({ where: { id: channelId }, data: { active: false } })

  await db.auditLog.create({
    data: { tenantId: channel.tenantId, action: 'channel.deactivated', entity: 'Channel', entityId: channelId, meta: JSON.stringify({ name: channel.name }) }
  })

  return NextResponse.json({ ok: true, deactivated: channelId })
}
