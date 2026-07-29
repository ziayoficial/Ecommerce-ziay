// ZIAY — Remarketing service layer.
//
// Wraps ALL DB access for the remarketing domain: RemarketingCampaign,
// RemarketingMessage, ConsentRecord (marketing consent gate), Customer
// (phone→id lookup), ConversationalCart / Conversation / Order (auto-
// generate triggers). API routes that touch these tables should migrate
// to call this service.
//
// SPRINT-BACKEND-FINAL-001 — service layer. Extracted from
// `/api/remarketing/route.ts` so the upcoming remarketing-send queue
// worker can share the same read paths (consent enforcement, customer
// lookup, campaign fetch) without re-implementing them. Business logic
// (which trigger fires for which scenario, the per-trigger loops) stays
// in the route — only the DB access patterns live here.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:remarketing')

/** Shape returned by `findCustomerByPhone` — minimal projection. */
export interface CustomerPhoneLookup {
  id: string
  name: string | null
}

export const remarketingService = {
  // ─────────────────────────────────────────────────────────────────────────
  // Consent enforcement (Ley 1581 Art 10 + Meta Cloud API policy).
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve a Customer row by (tenantId, phone). Used by the schedule +
   * auto-generate paths to find the data-subject that must have granted
   * marketing consent before any message is queued. Returns null when no
   * Customer matches — the route treats that as a 403 (no data subject to
   * consent against).
   */
  async findCustomerByPhone(
    tenantId: string,
    phone: string,
  ): Promise<CustomerPhoneLookup | null> {
    try {
      const customer = await db.customer.findFirst({
        where: { tenantId, phone },
        select: { id: true, name: true },
      })
      return customer ?? null
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'findCustomerByPhone',
        tenantId,
      })
      throw new Error('Failed to fetch customer by phone')
    }
  },

  /**
   * Assert that the customer has granted marketing consent (Ley 1581 Art 10).
   * Returns `true` if a ConsentRecord with `purpose='marketing'`,
   * `granted=true`, `revokedAt=null` exists; `false` otherwise.
   *
   * On `false`, writes an AuditLog row so the marketing dashboard can
   * surface silent skips. AuditLog write is best-effort — a transient DB
   * error must NOT silently re-enable sending.
   */
  async assertMarketingConsent(
    tenantId: string,
    customerId: string,
  ): Promise<boolean> {
    try {
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
            metadata: JSON.stringify({
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
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'assertMarketingConsent',
        tenantId,
        customerId,
      })
      throw new Error('Failed to assert marketing consent')
    }
  },

  /**
   * Best-effort audit-log row recording that a schedule/auto-generate
   * skipped a phone because no Customer row was linked to it (so consent
   * could not be verified). Failure to write the audit row is swallowed —
   * the caller has already decided to skip.
   */
  async logSkippedNoCustomer(tenantId: string, phone: string): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          tenantId,
          action: 'remarketing.skipped_no_customer',
          entity: 'customer',
          metadata: JSON.stringify({
            phone,
            reason: 'No Customer row linked to this phone — cannot verify marketing consent',
          }),
        },
      })
    } catch (err) {
      // Best-effort — non-blocking.
      log.error(
        { err, tenantId, phone },
        'remarketing: failed to write no-customer audit log',
      )
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/remarketing — list campaigns + pending messages + stats.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch the dashboard payload: campaigns with their 50 most recent
   * messages, the 100 oldest pending messages, and per-status counts.
   * Used by `/api/remarketing` GET.
   */
  async getRemarketingDashboard(tenantId: string) {
    try {
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

      return { campaigns, pendingMessages, stats }
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'getRemarketingDashboard',
        tenantId,
      })
      throw new Error('Failed to fetch remarketing dashboard')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // POST actions — create_campaign / schedule / auto_generate.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a RemarketingCampaign row. Returns the created row — the route
   * wraps it as `{ campaign }`.
   */
  async createCampaign(input: {
    tenantId: string
    name: string
    trigger: string
    template: string
  }) {
    try {
      const campaign = await db.remarketingCampaign.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          trigger: input.trigger,
          template: input.template,
        },
      })
      log.info(
        { tenantId: input.tenantId, campaignId: campaign.id, trigger: input.trigger },
        'campaign created',
      )
      return campaign
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'createCampaign',
        tenantId: input.tenantId,
      })
      throw new Error('Failed to create remarketing campaign')
    }
  },

  /**
   * Find an active campaign for a tenant + trigger. Used by `auto_generate`
   * to resolve which campaign the auto-generated messages should be
   * attached to. Returns null when no active campaign matches — the route
   * maps that to a 404.
   */
  async findActiveCampaignByTrigger(
    tenantId: string,
    trigger: string,
  ) {
    try {
      return await db.remarketingCampaign.findFirst({
        where: { tenantId, trigger, active: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'findActiveCampaignByTrigger',
        tenantId,
        trigger,
      })
      throw new Error('Failed to fetch active campaign')
    }
  },

  /**
   * Verify that a campaign belongs to the tenant before scheduling a
   * message against it. Returns the campaign row (without messages) or
   * null when not found / cross-tenant.
   */
  async findCampaignForTenant(tenantId: string, campaignId: string) {
    try {
      return await db.remarketingCampaign.findFirst({
        where: { id: campaignId, tenantId },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'findCampaignForTenant',
        tenantId,
        campaignId,
      })
      throw new Error('Failed to fetch campaign for tenant')
    }
  },

  /**
   * Persist a single scheduled RemarketingMessage row.
   */
  async scheduleMessage(input: {
    tenantId: string
    campaignId: string
    customerPhone: string
    customerName: string | null
    scheduledAt: Date
  }) {
    try {
      return await db.remarketingMessage.create({
        data: {
          tenantId: input.tenantId,
          campaignId: input.campaignId,
          customerPhone: String(input.customerPhone),
          customerName: input.customerName ?? null,
          scheduledAt: input.scheduledAt,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'scheduleMessage',
        tenantId: input.tenantId,
        campaignId: input.campaignId,
      })
      throw new Error('Failed to schedule remarketing message')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-generate — per-trigger source rows.
  //
  // Each trigger reads a different source table (ConversationalCart for
  // abandoned_cart, Conversation for no_response, Order for post_purchase)
  // and returns the rows + their customer context so the route can loop
  // + apply the consent gate before scheduling.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find ConversationalCarts in 'building' status not updated since `since`,
   * with their conversation + customer hydrated (phone, id, name). Caps at
   * 100 carts — matches the prior inline route logic.
   */
  async getAbandonedCarts(tenantId: string, since: Date) {
    try {
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
      return carts.map((c) => ({
        cart: c,
        conversation: convById.get(c.conversationId) ?? null,
      }))
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'getAbandonedCarts',
        tenantId,
      })
      throw new Error('Failed to fetch abandoned carts')
    }
  },

  /**
   * Find conversations without a customer reply since `since` (no_response
   * trigger). Hydrates customer (id/phone/name). Caps at 100.
   */
  async getNoResponseConversations(tenantId: string, since: Date) {
    try {
      return await db.conversation.findMany({
        where: { tenantId, updatedAt: { lt: since } },
        include: { customer: { select: { id: true, phone: true, name: true } } },
        take: 100,
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'getNoResponseConversations',
        tenantId,
      })
      throw new Error('Failed to fetch no-response conversations')
    }
  },

  /**
   * Find orders delivered but not updated since `since` (post_purchase
   * trigger). Hydrates customer (id/phone/name). Caps at 100.
   */
  async getDeliveredOrders(tenantId: string, since: Date) {
    try {
      return await db.order.findMany({
        where: { tenantId, status: 'delivered', updatedAt: { lt: since } },
        include: { customer: { select: { id: true, phone: true, name: true } } },
        take: 100,
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'getDeliveredOrders',
        tenantId,
      })
      throw new Error('Failed to fetch delivered orders')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH actions — toggle_active / mark_message.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Toggle the `active` flag on a campaign. Returns the updated row.
   */
  async setCampaignActive(campaignId: string, active: boolean) {
    try {
      return await db.remarketingCampaign.update({
        where: { id: campaignId },
        data: { active },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'setCampaignActive',
        campaignId,
      })
      throw new Error('Failed to toggle campaign active flag')
    }
  },

  /**
   * Update a message's status. Stamps `sentAt` when transitioning to
   * `sent` or `delivered` (matches prior inline route logic).
   */
  async updateMessageStatus(
    messageId: string,
    status: 'pending' | 'sent' | 'delivered' | 'failed',
  ) {
    try {
      return await db.remarketingMessage.update({
        where: { id: messageId },
        data: {
          status,
          sentAt: status === 'sent' || status === 'delivered' ? new Date() : undefined,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'remarketing',
        method: 'updateMessageStatus',
        messageId,
      })
      throw new Error('Failed to update message status')
    }
  },
}

export type RemarketingService = typeof remarketingService
