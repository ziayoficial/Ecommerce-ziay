import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { conversationService } from '@/lib/services'

// GET /api/conversations?tenantId=X&status=Y&channel=Z&q=...&cursor=ID&limit=N
//
// Cursor-based pagination (SPRINT6-SCALE-001). The `cursor` is the `id` of
// the last conversation on the previous page. Default page size 20, max 100.
//
// Backward compatible: when no `cursor` is given the first page is returned.
// Existing callers that only read `conversations` keep working — they just
// see the first page instead of every row.
//
// SPRINT7-POSTGRES-SERVICES-001 — GET migrated from `db.conversation.findMany`
// to `conversationService.getConversations`. The POST handler still uses
// `db.*` directly (out of scope for this task — it does a `db.message.create`
// + `db.conversation.update` that is logically a `sendMessage`, but the
// signature doesn't match `conversationService.sendMessage` exactly and
// migrating it would change response shape). Response shape is unchanged.
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const status = req.nextUrl.searchParams.get('status') || undefined
    const channel = req.nextUrl.searchParams.get('channel') || undefined
    const q = req.nextUrl.searchParams.get('q') || undefined
    const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined
    const cursor = req.nextUrl.searchParams.get('cursor') || undefined
    const parsedLimit = parseInt(req.nextUrl.searchParams.get('limit') || '20', 10)
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20

    const result = await conversationService.getConversations(tenantId, {
      status,
      channel,
      q,
      cursor,
      limit,
    })

    const hasNext = result.length > limit
    const items = hasNext ? result.slice(0, limit) : result
    const nextCursor = hasNext ? items[items.length - 1].id : null

    const conversations = items.map(c => ({
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

    return NextResponse.json({ conversations, nextCursor, hasMore: hasNext })
  } catch (err) {
    captureError(err as Error, { path: '/api/conversations', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
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
  } catch (err) {
    captureError(err as Error, { path: '/api/conversations', method: 'POST' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
