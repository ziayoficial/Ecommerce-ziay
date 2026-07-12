import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'

export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const status = req.nextUrl.searchParams.get('status') || undefined
  const channel = req.nextUrl.searchParams.get('channel') || undefined
  const q = req.nextUrl.searchParams.get('q') || undefined
  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined

  const conversations = await db.conversation.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      ...(status && status !== 'all' ? { status } : {}),
      ...(channel && channel !== 'all' ? { channelId: channel } : {}),
      ...(q ? { customer: { name: { contains: q } } } : {}),
    },
    include: {
      customer: true,
      channel: true,
      assignee: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { lastMessageAt: 'desc' },
  })

  const result = conversations.map(c => ({
    id: c.id,
    status: c.status,
    priority: c.priority,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt,
    utm: c.utm,
    sourceAdId: c.sourceAdId,
    sourceCampaign: c.sourceCampaign,
    customer: { id: c.customer.id, name: c.customer.name, phone: c.customer.phone, psid: c.customer.psid, country: c.customer.country, avatarUrl: null },
    channel: { id: c.channel.id, type: c.channel.type, displayName: c.channel.displayName, paymentStrategy: c.channel.paymentStrategy },
    assignee: c.assignee ? { id: c.assignee.id, name: c.assignee.name } : null,
    lastMessage: c.messages[0] ? { body: c.messages[0].body, direction: c.messages[0].direction, createdAt: c.messages[0].createdAt } : null,
  }))

  return NextResponse.json({ conversations: result })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const body = await req.json()
  const { conversationId, body: text, direction = 'outbound' } = body
  if (!conversationId || !text) {
    return NextResponse.json({ error: 'conversationId and body required' }, { status: 400 })
  }
  const msg = await db.message.create({
    data: { tenantId: body.tenantId || 'ten-saramantha', conversationId, direction, body: text, type: 'text', status: 'sent' },
  })
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), unreadCount: 0 },
  })
  return NextResponse.json({ message: msg })
}
