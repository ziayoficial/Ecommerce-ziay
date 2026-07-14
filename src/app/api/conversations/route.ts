import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveTenantId, requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { conversationService } from '@/lib/services'
import { emitToTenant } from '@/lib/chat-emit'

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
//
// FIX-SECURITY-AUTH-001 (#10) — tenantId is resolved + verified against the
// caller's session. Tenant users are pinned to their own tenantId
// (cross-tenant attempts return 403); platform admins can pass any tenantId
// or omit it for the legacy "all tenants" view.
export async function GET(req: NextRequest) {
  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error

  try {
    const status = req.nextUrl.searchParams.get('status') || undefined
    const channel = req.nextUrl.searchParams.get('channel') || undefined
    const q = req.nextUrl.searchParams.get('q') || undefined
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

// FIX-SECURITY-AUTH-001 (#4, #42) — POST: previously `requireAuth()` only,
// with a hardcoded `body.tenantId || 'ten-saramantha'` fallback that let any
// authed user write messages into any conversation of any tenant. Now:
//   - Fetch the conversation by id (no tenant filter — we need its tenantId).
//   - requireTenantAccess(conv.tenantId) — 403 for cross-tenant callers
//     unless they're platform admins.
//   - Use conv.tenantId for the message row (kills the hardcoded fallback).
//
// SPRINT-WHATSAPP-FUNCTIONAL-001 — POST now routes through
// `conversationService.sendMessage` so the message is ALSO delivered via
// the WhatsApp Cloud API adapter when the conversation's channel is
// `whatsapp`, and `conversation.firstReplyAt` is stamped (TTR). Previously
// the route only persisted a local Message row — the customer never
// received the agent's reply on WhatsApp.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { conversationId, body: text, direction = 'outbound' } = body
    if (!conversationId || !text) {
      return NextResponse.json({ error: 'conversationId and body required' }, { status: 400 })
    }

    // Fetch the conversation to learn its tenantId — never trust the body.
    // Also pull the channel type + customerPhone so we can decide whether
    // to deliver via the WhatsApp adapter and broadcast via socket.
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        tenantId: true,
        customerPhone: true,
        channel: { select: { type: true } },
      },
    })
    if (!conv) {
      return NextResponse.json({ error: 'conversation not found' }, { status: 404 })
    }

    const { error } = await requireTenantAccess(conv.tenantId)
    if (error) return error

    // Route through the conversation service so the WhatsApp Cloud API
    // adapter delivers the message + TTR is recorded. Delivery failures
    // are caught inside the service — the local Message row is still
    // persisted (status='failed') so the agent can retry.
    const msg = await conversationService.sendMessage({
      tenantId: conv.tenantId,
      conversationId,
      body: text,
      direction,
    })

    // Fire-and-forget realtime broadcast so other dashboards of the same
    // tenant see the agent's reply instantly. The agent's own dashboard
    // sees the message via the optimistic UI + the socket echo.
    emitToTenant(conv.tenantId, 'message:new', {
      conversationId,
      customerPhone: conv.customerPhone,
      direction,
      body: text,
      timestamp: new Date().toISOString(),
      messageId: msg.id,
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
