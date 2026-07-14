import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getLogger } from '@/lib/logger'

const log = getLogger('api/remarketing')

// ───────────────────────────────────────────────────────────────────────────
// FIX-LEGAL-P0-001 L-3 — Consent enforcement on remarketing.
//
// AUDIT-LEGAL-COMPLIANCE-001 P0-3: this route scheduled WhatsApp marketing
// messages without checking `ConsentRecord` for `purpose: 'marketing'`.
// Direct violation of Ley 1581 Art 10 (no legal basis) + Meta Cloud API
// policy (marketing templates require explicit opt-in outside the 24h
// customer-service window).
//
// Every customer targeted by `schedule` or `auto_generate` now goes through
// `assertMarketingConsent()`. If the customer has no ConsentRecord with
// `purpose='marketing'`, `granted=true`, `revokedAt=null` — the message is
// SKIPPED and an AuditLog row is written with `action='remarketing.skipped_no_consent'`
// so the marketing dashboard can surface the silent skip to the tenant.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Returns the Customer row matching a (tenantId, phone) tuple, or null.
 * Phone lookup is the right path because `RemarketingMessage.customerPhone`
 * is the identifier on the schedule/auto-generate paths — there is no
 * `customerId` on the message row by design (the message can target a phone
 * that has not yet been linked to a Customer row).
 */
async function findCustomerByPhone(
  tenantId: string,
  phone: string,
): Promise<{ id: string; name: string | null } | null> {
  const customer = await db.customer.findFirst({
    where: { tenantId, phone },
    select: { id: true, name: true },
  })
  return customer ?? null
}

/**
 * Asserts that the customer has granted marketing consent (Ley 1581 Art 10).
 * Returns `true` if consent exists + is granted + not revoked; `false`
 * otherwise. On `false`, writes an AuditLog row so the marketing dashboard
 * can surface silent skips. AuditLog write is best-effort — a transient DB
 * error must NOT silently re-enable sending.
 */
async function assertMarketingConsent(
  tenantId: string,
  customerId: string,
): Promise<boolean> {
  const consent = await db.consentRecord.findFirst({
    where: {
      tenantId,
      dataSubjectId: customerId,
      dataSubjectType: 'customer',
      purpose: 'marketing',
      granted: true,
      revokedAt: null,
    },
    select: { id: true },
  })
  if (consent) return true
  // Best-effort audit log — failure to write it does NOT enable sending.
  try {
    await db.auditLog.create({
      data: {
        tenantId,
        action: 'remarketing.skipped_no_consent',
        entity: 'customer',
        entityId: customerId,
        meta: JSON.stringify({
          reason:
            'No ConsentRecord with purpose=marketing, granted=true, revokedAt=null',
          legalBasis:
            'Ley 1581 de 2012 Art 10 + Meta Cloud API marketing opt-in policy',
        }),
      },
    })
  } catch (auditErr) {
    log.error(
      { err: auditErr, tenantId, customerId },
      'remarketing: failed to write no-consent audit log',
    )
  }
  return false
}

// ───────────────────────────────────────────────────────────────────────────
// Body schemas (per-action discriminated unions for POST and PATCH)
// ───────────────────────────────────────────────────────────────────────────

const CreateCampaignSchema = z.object({
  action: z.literal('create_campaign'),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  trigger: z.enum(['abandoned_cart', 'no_response', 'post_purchase']),
  template: z.string().min(1),
})

const ScheduleSchema = z.object({
  action: z.literal('schedule'),
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  customerPhone: z.string().min(1),
  customerName: z.string().nullable().optional(),
  scheduledAt: z.string().min(1),
  body: z.string().nullable().optional(),
})

const AutoGenerateSchema = z.object({
  action: z.literal('auto_generate'),
  tenantId: z.string().min(1),
  trigger: z.enum(['abandoned_cart', 'no_response', 'post_purchase']).optional(),
  daysAgo: z.union([z.number(), z.string()]).optional(),
})

const PostBodySchema = z.discriminatedUnion('action', [
  CreateCampaignSchema,
  ScheduleSchema,
  AutoGenerateSchema,
])

const ToggleActiveSchema = z.object({
  action: z.literal('toggle_active'),
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  active: z.boolean(),
})

const MarkMessageSchema = z.object({
  action: z.literal('mark_message'),
  tenantId: z.string().min(1),
  messageId: z.string().min(1),
  status: z.enum(['pending', 'sent', 'delivered', 'failed']),
})

const PatchBodySchema = z.discriminatedUnion('action', [
  ToggleActiveSchema,
  MarkMessageSchema,
])

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

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = PostBodySchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const { action, tenantId } = body

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

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = PatchBodySchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const { action, tenantId } = body

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  if (action === 'toggle_active') {
    const { campaignId, active } = body
    const updated = await db.remarketingCampaign.update({
      where: { id: campaignId },
      data: { active },
    })
    return NextResponse.json({ campaign: updated })
  }

  // mark_message
  const { messageId, status } = body
  const updated = await db.remarketingMessage.update({
    where: { id: messageId },
    data: {
      status,
      sentAt: status === 'sent' || status === 'delivered' ? new Date() : undefined,
    },
  })
  return NextResponse.json({ message: updated })
}

// ────────────────────────────────────────────────────────────
// Action handlers
// ────────────────────────────────────────────────────────────

async function createCampaign(tenantId: string, body: z.infer<typeof CreateCampaignSchema>) {
  const { name, trigger, template } = body
  const campaign = await db.remarketingCampaign.create({
    data: { tenantId, name, trigger, template },
  })
  log.info({ tenantId, campaignId: campaign.id, trigger }, 'campaign created')
  return NextResponse.json({ campaign })
}

async function scheduleMessage(tenantId: string, body: z.infer<typeof ScheduleSchema>) {
  const { campaignId, customerPhone, customerName, scheduledAt } = body
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

  // FIX-LEGAL-P0-001 L-3 — enforce marketing consent before scheduling.
  // If the customer cannot be resolved by phone, OR has no marketing
  // consent, skip the schedule. Skipping is logged via AuditLog by
  // assertMarketingConsent(); we return a 403 so the caller knows.
  const customer = await findCustomerByPhone(tenantId, String(customerPhone))
  if (!customer) {
    log.warn(
      { tenantId, customerPhone },
      'remarketing.schedule: customer not found by phone — skipping (no data subject to consent)',
    )
    try {
      await db.auditLog.create({
        data: {
          tenantId,
          action: 'remarketing.skipped_no_customer',
          entity: 'customer',
          meta: JSON.stringify({
            phone: String(customerPhone),
            reason: 'No Customer row linked to this phone — cannot verify marketing consent',
          }),
        },
      })
    } catch {
      /* best-effort */
    }
    return NextResponse.json(
      {
        error:
          'No se pudo programar el mensaje: no existe un Customer para este teléfono. Registra al cliente primero y obtén su consentimiento de marketing (Ley 1581 Art 10).',
      },
      { status: 403 },
    )
  }
  const hasConsent = await assertMarketingConsent(tenantId, customer.id)
  if (!hasConsent) {
    return NextResponse.json(
      {
        error:
          'No se pudo programar el mensaje: el cliente no ha otorgado consentimiento de marketing (Ley 1581 de 2012 Art 10 + política de Meta Cloud API).',
        customerId: customer.id,
      },
      { status: 403 },
    )
  }

  const message = await db.remarketingMessage.create({
    data: {
      tenantId,
      campaignId,
      customerPhone: String(customerPhone),
      customerName: customerName ?? customer.name ?? null,
      scheduledAt: new Date(scheduledAt),
    },
  })
  return NextResponse.json({ message })
}

async function autoGenerate(tenantId: string, body: z.infer<typeof AutoGenerateSchema>) {
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
  let skipped = 0
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
          include: { customer: { select: { id: true, phone: true, name: true } } },
        })
      : []
    const convById = new Map(conversations.map((c) => [c.id, c]))
    const scheduledAt = new Date() // send ASAP
    for (const c of carts) {
      const conv = convById.get(c.conversationId)
      const phone = conv?.customer?.phone
      if (!phone) continue
      const customerId = conv?.customer?.id
      if (!customerId) {
        skipped++
        continue
      }
      // FIX-LEGAL-P0-001 L-3 — marketing consent gate.
      const hasConsent = await assertMarketingConsent(tenantId, customerId)
      if (!hasConsent) {
        skipped++
        continue
      }
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
      include: { customer: { select: { id: true, phone: true, name: true } } },
      take: 100,
    })
    const scheduledAt = new Date()
    for (const conv of conversations) {
      const phone = conv.customer?.phone
      if (!phone) continue
      const customerId = conv.customer?.id
      if (!customerId) {
        skipped++
        continue
      }
      const hasConsent = await assertMarketingConsent(tenantId, customerId)
      if (!hasConsent) {
        skipped++
        continue
      }
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
      include: { customer: { select: { id: true, phone: true, name: true } } },
      take: 100,
    })
    const scheduledAt = new Date()
    for (const o of orders) {
      const phone = o.customer?.phone
      if (!phone) continue
      const customerId = o.customer?.id
      if (!customerId) {
        skipped++
        continue
      }
      const hasConsent = await assertMarketingConsent(tenantId, customerId)
      if (!hasConsent) {
        skipped++
        continue
      }
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

  log.info(
    { tenantId, trigger, created, skipped },
    'auto-generated remarketing messages (with consent enforcement)',
  )
  return NextResponse.json({
    trigger,
    created,
    skipped,
    campaignId: campaign.id,
  })
}
