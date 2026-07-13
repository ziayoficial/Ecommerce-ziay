import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getLogger } from '@/lib/logger'

const log = getLogger('api/remarketing')

// Remarketing — abandoned-cart / no-response / post-purchase flows.
//
// SPRINT8-SERVICES-REST-001 — left inline. Most handlers do 1-2 db calls
// (create_campaign, schedule, toggle_active, mark_message — each touches
// one or two rows). The `auto_generate` handler is more complex (per-trigger
// loops that look up carts / conversations / orders and create many
// RemarketingMessage rows), but it lives entirely within this route —
// no other caller shares its read paths. Per rule #2 (1-2 simple db calls
// OK to leave) and the 3-new-service-file cap, a `remarketing.service.ts`
// wasn't created in this sprint.
// TODO: migrate to service layer when the remarketing worker (queue
// handler) is added — that will be the second caller and will justify
// the service.

// GET /api/remarketing?tenantId=X
// Devuelve las RemarketingCampaign del tenant + mensajes pendientes + stats.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId is required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const [campaigns, pendingMessages, statsRows] = await Promise.all([
    db.remarketingCampaign.findMany({
      where: { tenantId },
      include: {
        messages: {
          orderBy: { scheduledAt: 'desc' },
          take: 50,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.remarketingMessage.findMany({
      where: { tenantId, status: 'pending' },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: { campaign: { select: { name: true, trigger: true } } },
    }),
    db.remarketingMessage.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    }),
  ])

  const stats: Record<string, number> = {
    pending: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
  }
  for (const s of statsRows) stats[s.status] = s._count._all

  return NextResponse.json({ campaigns, pendingMessages, stats })
}

// POST /api/remarketing
// Acciones (body.action):
//   - create_campaign: { action, tenantId, name, trigger, template }
//   - schedule: { action, tenantId, campaignId, customerPhone, customerName, scheduledAt, body? }
//   - auto_generate: { action, tenantId, trigger?, daysAgo? }
//     Genera mensajes automáticos para carritos abandonados / no-respuesta / post-purchase
//     según el trigger. Para abandoned_cart, busca ConversationalCart en estado
//     'building' sin update reciente y los programa.
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 60,
    windowMs: 60_000,
    namespace: 'api:remarketing:post',
  })
  if (limited) return limited

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, tenantId } = body ?? {}
  if (!action || !tenantId) {
    return NextResponse.json(
      { error: 'action and tenantId are required' },
      { status: 400 },
    )
  }

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  switch (action) {
    case 'create_campaign':
      return await createCampaign(tenantId, body)
    case 'schedule':
      return await scheduleMessage(tenantId, body)
    case 'auto_generate':
      return await autoGenerate(tenantId, body)
    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      )
  }
}

// PATCH /api/remarketing
// Body: { action: 'toggle_active', campaignId, active }
//    or { action: 'mark_message', messageId, status }
export async function PATCH(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 120,
    windowMs: 60_000,
    namespace: 'api:remarketing:patch',
  })
  if (limited) return limited

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, tenantId } = body ?? {}
  if (!action || !tenantId) {
    return NextResponse.json(
      { error: 'action and tenantId are required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  if (action === 'toggle_active') {
    const { campaignId, active } = body
    if (!campaignId || typeof active !== 'boolean') {
      return NextResponse.json(
        { error: 'campaignId and active (boolean) are required' },
        { status: 400 },
      )
    }
    const updated = await db.remarketingCampaign.update({
      where: { id: campaignId },
      data: { active },
    })
    return NextResponse.json({ campaign: updated })
  }

  if (action === 'mark_message') {
    const { messageId, status } = body
    if (!messageId || !status) {
      return NextResponse.json(
        { error: 'messageId and status are required' },
        { status: 400 },
      )
    }
    const valid = ['pending', 'sent', 'delivered', 'failed']
    if (!valid.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${valid.join(', ')}` },
        { status: 400 },
      )
    }
    const updated = await db.remarketingMessage.update({
      where: { id: messageId },
      data: {
        status,
        sentAt: status === 'sent' || status === 'delivered' ? new Date() : undefined,
      },
    })
    return NextResponse.json({ message: updated })
  }

  return NextResponse.json(
    { error: `Unknown action: ${action}` },
    { status: 400 },
  )
}

// ────────────────────────────────────────────────────────────
// Action handlers
// ────────────────────────────────────────────────────────────

async function createCampaign(tenantId: string, body: any) {
  const { name, trigger, template } = body
  if (!name || !trigger || !template) {
    return NextResponse.json(
      { error: 'name, trigger, template are required' },
      { status: 400 },
    )
  }
  const validTriggers = ['abandoned_cart', 'no_response', 'post_purchase']
  if (!validTriggers.includes(trigger)) {
    return NextResponse.json(
      { error: `trigger must be one of: ${validTriggers.join(', ')}` },
      { status: 400 },
    )
  }
  const campaign = await db.remarketingCampaign.create({
    data: { tenantId, name, trigger, template },
  })
  log.info({ tenantId, campaignId: campaign.id, trigger }, 'campaign created')
  return NextResponse.json({ campaign })
}

async function scheduleMessage(tenantId: string, body: any) {
  const { campaignId, customerPhone, customerName, scheduledAt } = body
  if (!campaignId || !customerPhone || !scheduledAt) {
    return NextResponse.json(
      {
        error: 'campaignId, customerPhone, scheduledAt are required',
      },
      { status: 400 },
    )
  }
  // Verify campaign belongs to tenant
  const campaign = await db.remarketingCampaign.findFirst({
    where: { id: campaignId, tenantId },
  })
  if (!campaign) {
    return NextResponse.json(
      { error: 'Campaign not found in this tenant' },
      { status: 404 },
    )
  }
  const message = await db.remarketingMessage.create({
    data: {
      tenantId,
      campaignId,
      customerPhone: String(customerPhone),
      customerName: customerName ?? null,
      scheduledAt: new Date(scheduledAt),
    },
  })
  return NextResponse.json({ message })
}

async function autoGenerate(tenantId: string, body: any) {
  const trigger = body.trigger ?? 'abandoned_cart'
  const daysAgo = Number(body.daysAgo ?? 1)
  const since = new Date()
  since.setDate(since.getDate() - daysAgo)

  // Find a campaign matching the trigger (active)
  const campaign = await db.remarketingCampaign.findFirst({
    where: { tenantId, trigger, active: true },
  })
  if (!campaign) {
    return NextResponse.json(
      { error: `No active campaign for trigger '${trigger}'` },
      { status: 404 },
    )
  }

  let created = 0
  if (trigger === 'abandoned_cart') {
    // Find ConversationalCarts in 'building' status not updated recently.
    // ConversationalCart only has `conversationId` (no relation), so we look
    // up the conversations + customers separately to get the phone.
    const carts = await db.conversationalCart.findMany({
      where: { tenantId, status: 'building', updatedAt: { lt: since } },
      take: 100,
      select: { id: true, conversationId: true },
    })
    const conversationIds = Array.from(
      new Set(carts.map((c) => c.conversationId)),
    )
    const conversations = conversationIds.length
      ? await db.conversation.findMany({
          where: { id: { in: conversationIds } },
          include: { customer: { select: { phone: true, name: true } } },
        })
      : []
    const convById = new Map(conversations.map((c) => [c.id, c]))
    const scheduledAt = new Date() // send ASAP
    for (const c of carts) {
      const conv = convById.get(c.conversationId)
      const phone = conv?.customer?.phone
      if (!phone) continue
      await db.remarketingMessage.create({
        data: {
          tenantId,
          campaignId: campaign.id,
          customerPhone: phone,
          customerName: conv?.customer?.name ?? null,
          scheduledAt,
        },
      })
      created += 1
    }
  } else if (trigger === 'no_response') {
    // Find conversations without a customer reply in the last `daysAgo` days
    const conversations = await db.conversation.findMany({
      where: { tenantId, updatedAt: { lt: since } },
      include: { customer: { select: { phone: true, name: true } } },
      take: 100,
    })
    const scheduledAt = new Date()
    for (const conv of conversations) {
      const phone = conv.customer?.phone
      if (!phone) continue
      await db.remarketingMessage.create({
        data: {
          tenantId,
          campaignId: campaign.id,
          customerPhone: phone,
          customerName: conv.customer?.name ?? null,
          scheduledAt,
        },
      })
      created += 1
    }
  } else if (trigger === 'post_purchase') {
    // Find orders delivered within the window
    const orders = await db.order.findMany({
      where: { tenantId, status: 'delivered', updatedAt: { lt: since } },
      include: { customer: { select: { phone: true, name: true } } },
      take: 100,
    })
    const scheduledAt = new Date()
    for (const o of orders) {
      const phone = o.customer?.phone
      if (!phone) continue
      await db.remarketingMessage.create({
        data: {
          tenantId,
          campaignId: campaign.id,
          customerPhone: phone,
          customerName: o.customer?.name ?? null,
          scheduledAt,
        },
      })
      created += 1
    }
  }

  log.info({ tenantId, trigger, created }, 'auto-generated remarketing messages')
  return NextResponse.json({ trigger, created, campaignId: campaign.id })
}
