import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getLogger } from '@/lib/logger'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { remarketingService } from '@/lib/services'

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
// `remarketingService.assertMarketingConsent()`. If the customer has no
// ConsentRecord with `purpose='marketing'`, `granted=true`, `revokedAt=null`
// — the message is SKIPPED and an AuditLog row is written with
// `action='remarketing.skipped_no_consent'` so the marketing dashboard can
// surface the silent skip to the tenant.
// ───────────────────────────────────────────────────────────────────────────

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
// SPRINT-BACKEND-FINAL-001 — DB access migrated to `remarketingService`.
// The route owns: request parsing, response shaping, the per-trigger
// loops (which call the service for each row). Business logic stays here;
// only the DB access patterns (findMany, create, update, groupBy) live
// in the service.

// GET /api/remarketing?tenantId=X
// Devuelve las RemarketingCampaign del tenant + mensajes pendientes + stats.
/**
 * GET /api/remarketing
 *
 * Devuelve las campañas de remarketing del tenant + mensajes pendientes +
 * estadísticas de conversión. Filtra por `tenantId` (requerido) y opcionalmente
 * por `status` (active | paused | completed).
 *
 * @security sessionAuth + requireTenantAccess(tenantId)
 * @returns 200 con `{ campaigns, pendingMessages, stats }`
 */
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId is required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const { campaigns, pendingMessages, stats } =
    await remarketingService.getRemarketingDashboard(tenantId)

  return NextResponse.json({ campaigns, pendingMessages, stats })

})

// POST /api/remarketing
// Acciones (body.action):
//   - create_campaign: { action, tenantId, name, trigger, template }
//   - schedule: { action, tenantId, campaignId, customerPhone, customerName, scheduledAt, body? }
//   - auto_generate: { action, tenantId, trigger?, daysAgo? }
//     Genera mensajes automáticos para carritos abandonados / no-respuesta / post-purchase
//     según el trigger. Para abandoned_cart, busca ConversationalCart en estado
//     'building' sin update reciente y los programa.
/**
 * POST /api/remarketing
 *
 * Crea o programa mensajes de remarketing. Acciones soportadas:
 * `schedule` (mensaje individual programado) y `auto_generate` (generación
 * automática para carritos abandonados / no-respuesta / post-purchase).
 *
 * FIX-LEGAL-P0-001 L-3: toda acción pasa por
 * `remarketingService.assertMarketingConsent()` — los clientes sin
 * `ConsentRecord` con `purpose='marketing'` son SKIPPED y se registra en
 * `AuditLog` con `action='remarketing.skipped_no_consent'`.
 *
 * @security sessionAuth + requireTenantAccess(tenantId) + rateLimit(60/min)
 * @returns 200 con `{ scheduled: N, skipped: N }` o 422 si el body no valida.
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

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

})

// PATCH /api/remarketing
// Body: { action: 'toggle_active', campaignId, active }
//    or { action: 'mark_message', messageId, status }
/**
 * PATCH /api/remarketing
 *
 * Mutaciones sobre campañas y mensajes existentes. Acciones soportadas:
 * `toggle_active` (activa/pausa una campaña) y `mark_message` (marca el
 * estado de un mensaje: sent | failed | skipped).
 *
 * @security sessionAuth + requireTenantAccess(tenantId) + rateLimit(120/min)
 * @returns 200 con la campaña/mensaje actualizado, o 422 si el body no valida.
 */
export const PATCH = withErrorHandling(async (req: NextRequest) => {

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
    const updated = await remarketingService.setCampaignActive(campaignId, active)
    return NextResponse.json({ campaign: updated })
  }

  // mark_message
  const { messageId, status } = body
  const updated = await remarketingService.updateMessageStatus(messageId, status)
  return NextResponse.json({ message: updated })

})

// ────────────────────────────────────────────────────────────
// Action handlers
// ────────────────────────────────────────────────────────────

async function createCampaign(tenantId: string, body: z.infer<typeof CreateCampaignSchema>) {
  const { name, trigger, template } = body
  const campaign = await remarketingService.createCampaign({
    tenantId,
    name,
    trigger,
    template,
  })
  return NextResponse.json({ campaign })
}

async function scheduleMessage(tenantId: string, body: z.infer<typeof ScheduleSchema>) {
  const { campaignId, customerPhone, customerName, scheduledAt } = body
  // Verify campaign belongs to tenant
  const campaign = await remarketingService.findCampaignForTenant(tenantId, campaignId)
  if (!campaign) {
    return NextResponse.json(
      { error: 'Campaign not found in this tenant' },
      { status: 404 },
    )
  }

  // FIX-LEGAL-P0-001 L-3 — enforce marketing consent before scheduling.
  // If the customer cannot be resolved by phone, OR has no marketing
  // consent, skip the schedule. Skipping is logged via AuditLog by
  // the service; we return a 403 so the caller knows.
  const customer = await remarketingService.findCustomerByPhone(tenantId, String(customerPhone))
  if (!customer) {
    log.warn(
      { tenantId, customerPhone },
      'remarketing.schedule: customer not found by phone — skipping (no data subject to consent)',
    )
    await remarketingService.logSkippedNoCustomer(tenantId, String(customerPhone))
    return NextResponse.json(
      {
        error:
          'No se pudo programar el mensaje: no existe un Customer para este teléfono. Registra al cliente primero y obtén su consentimiento de marketing (Ley 1581 Art 10).',
      },
      { status: 403 },
    )
  }
  const hasConsent = await remarketingService.assertMarketingConsent(tenantId, customer.id)
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

  const message = await remarketingService.scheduleMessage({
    tenantId,
    campaignId,
    customerPhone: String(customerPhone),
    customerName: customerName ?? customer.name ?? null,
    scheduledAt: new Date(scheduledAt),
  })
  return NextResponse.json({ message })
}

async function autoGenerate(tenantId: string, body: z.infer<typeof AutoGenerateSchema>) {
  const trigger = body.trigger ?? 'abandoned_cart'
  const daysAgo = Number(body.daysAgo ?? 1)
  const since = new Date()
  since.setDate(since.getDate() - daysAgo)

  // Find a campaign matching the trigger (active)
  const campaign = await remarketingService.findActiveCampaignByTrigger(tenantId, trigger)
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
    // The service hydrates the conversation + customer so we can apply
    // the consent gate without a second round-trip per cart.
    const carts = await remarketingService.getAbandonedCarts(tenantId, since)
    const scheduledAt = new Date() // send ASAP
    for (const { conversation: conv } of carts) {
      const phone = conv?.customer?.phone
      if (!phone) continue
      const customerId = conv?.customer?.id
      if (!customerId) {
        skipped++
        continue
      }
      // FIX-LEGAL-P0-001 L-3 — marketing consent gate.
      const hasConsent = await remarketingService.assertMarketingConsent(tenantId, customerId)
      if (!hasConsent) {
        skipped++
        continue
      }
      await remarketingService.scheduleMessage({
        tenantId,
        campaignId: campaign.id,
        customerPhone: phone,
        customerName: conv?.customer?.name ?? null,
        scheduledAt,
      })
      created += 1
    }
  } else if (trigger === 'no_response') {
    // Find conversations without a customer reply in the last `daysAgo` days
    const conversations = await remarketingService.getNoResponseConversations(tenantId, since)
    const scheduledAt = new Date()
    for (const conv of conversations) {
      const phone = conv.customer?.phone
      if (!phone) continue
      const customerId = conv.customer?.id
      if (!customerId) {
        skipped++
        continue
      }
      const hasConsent = await remarketingService.assertMarketingConsent(tenantId, customerId)
      if (!hasConsent) {
        skipped++
        continue
      }
      await remarketingService.scheduleMessage({
        tenantId,
        campaignId: campaign.id,
        customerPhone: phone,
        customerName: conv.customer?.name ?? null,
        scheduledAt,
      })
      created += 1
    }
  } else if (trigger === 'post_purchase') {
    // Find orders delivered within the window
    const orders = await remarketingService.getDeliveredOrders(tenantId, since)
    const scheduledAt = new Date()
    for (const o of orders) {
      const phone = o.customer?.phone
      if (!phone) continue
      const customerId = o.customer?.id
      if (!customerId) {
        skipped++
        continue
      }
      const hasConsent = await remarketingService.assertMarketingConsent(tenantId, customerId)
      if (!hasConsent) {
        skipped++
        continue
      }
      await remarketingService.scheduleMessage({
        tenantId,
        campaignId: campaign.id,
        customerPhone: phone,
        customerName: o.customer?.name ?? null,
        scheduledAt,
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
