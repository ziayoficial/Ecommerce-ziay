// ZIAY — Channels service layer.
//
// Wraps ALL DB access for the channel CRUD surface: `Channel` writes +
// the corresponding `AuditLog` rows that record each mutation. The
// `/api/channels` route keeps auth, request parsing, response shaping,
// and the per-type required-field validation; the actual persistence +
// audit-log write live here so future callers (channel verification
// flows, a tenant-onboarding wizard) can share the same seam.
//
// SPRINT-BACKEND-FINAL-001 — service layer. Extracted from
// `/api/channels/route.ts`.

import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'

const log = getLogger('service:channels')

/** Fields a caller is allowed to mutate on PATCH. Mirrors the route's
 *  `allowedFields` list — exported so the route + service stay in sync. */
export const CHANNEL_UPDATABLE_FIELDS = [
  'name', 'displayName', 'accountId', 'verified', 'active', 'country',
  'paymentStrategy', 'requirePrepayMin', 'prepayDiscountPct', 'codFee',
  'wabaId', 'phoneNumberId', 'whatsappToken', 'pageId', 'pageAccessToken',
  'igAccountId', 'verifyToken', 'appSecret',
] as const

export interface CreateChannelInput {
  tenantId: string
  type: string
  name: string
  displayName: string
  accountId?: string | null
  verified?: boolean
  active?: boolean
  country?: string | null
  paymentStrategy?: string
  requirePrepayMin?: number | null
  prepayDiscountPct?: number
  codFee?: number
  wabaId?: string | null
  phoneNumberId?: string | null
  whatsappToken?: string | null
  pageId?: string | null
  pageAccessToken?: string | null
  igAccountId?: string | null
  verifyToken?: string | null
  appSecret?: string | null
}

export const channelsService = {
  /**
   * List all channels for a tenant, ordered by type. Used by
   * `/api/channels` GET (which masks the credential fields before
   * returning).
   */
  async listForTenant(tenantId: string) {
    try {
      return await db.channel.findMany({
        where: { tenantId },
        orderBy: { type: 'asc' },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'channels',
        method: 'listForTenant',
        tenantId,
      })
      throw new Error('Failed to fetch channels')
    }
  },

  /**
   * Create a new channel + an `AuditLog` row recording the creation.
   * Returns the created channel — the route maps it to
   * `{ id, type, name }` for the response.
   */
  async createChannel(input: CreateChannelInput) {
    try {
      const channel = await db.channel.create({
        data: {
          tenantId: input.tenantId,
          type: input.type,
          name: input.name,
          displayName: input.displayName,
          accountId: input.accountId || null,
          verified: input.verified || false,
          active: input.active !== false,
          country: input.country || null,
          paymentStrategy: input.paymentStrategy || 'hybrid',
          requirePrepayMin: input.requirePrepayMin || null,
          prepayDiscountPct: input.prepayDiscountPct || 0,
          codFee: input.codFee || 0,
          // Credentials by type
          wabaId: input.wabaId || null,
          phoneNumberId: input.phoneNumberId || null,
          whatsappToken: input.whatsappToken || null,
          pageId: input.pageId || null,
          pageAccessToken: input.pageAccessToken || null,
          igAccountId: input.igAccountId || null,
          verifyToken: input.verifyToken || null,
          appSecret: input.appSecret || null,
        },
      })

      await db.auditLog.create({
        data: {
          tenantId: input.tenantId,
          action: 'channel.created',
          entity: 'Channel',
          entityId: channel.id,
          metadata: JSON.stringify({ type: input.type, name: input.name }),
        },
      })

      log.info(
        { tenantId: input.tenantId, channelId: channel.id, type: input.type },
        'Channel created',
      )
      return channel
    } catch (err) {
      captureError(err as Error, {
        service: 'channels',
        method: 'createChannel',
        tenantId: input.tenantId,
      })
      throw new Error('Failed to create channel')
    }
  },

  /**
   * Fetch a single channel by id. Used by PATCH + DELETE for the
   * tenant-ownership check before any mutation.
   */
  async getById(channelId: string) {
    try {
      return await db.channel.findUnique({ where: { id: channelId } })
    } catch (err) {
      captureError(err as Error, {
        service: 'channels',
        method: 'getById',
        channelId,
      })
      throw new Error('Failed to fetch channel')
    }
  },

  /**
   * Update a channel with the supplied field map + write an AuditLog row
   * recording which fields changed. The caller is responsible for
   * filtering `fields` against `CHANNEL_UPDATABLE_FIELDS` before calling.
   */
  async updateChannel(
    channelId: string,
    tenantId: string,
    fields: Record<string, unknown>,
  ) {
    try {
      const channel = await db.channel.update({
        where: { id: channelId },
        data: fields,
      })
      await db.auditLog.create({
        data: {
          tenantId,
          action: 'channel.updated',
          entity: 'Channel',
          entityId: channelId,
          metadata: JSON.stringify(Object.keys(fields)),
        },
      })
      log.info(
        { tenantId, channelId, changedFields: Object.keys(fields) },
        'Channel updated',
      )
      return channel
    } catch (err) {
      captureError(err as Error, {
        service: 'channels',
        method: 'updateChannel',
        channelId,
        tenantId,
      })
      throw new Error('Failed to update channel')
    }
  },

  /**
   * Soft-delete (deactivate) a channel + write an AuditLog row. Preserves
   * conversation history — the row stays, only `active` flips to false.
   */
  async deactivateChannel(channelId: string, tenantId: string, channelName: string) {
    try {
      await db.channel.update({
        where: { id: channelId },
        data: { active: false },
      })
      await db.auditLog.create({
        data: {
          tenantId,
          action: 'channel.deactivated',
          entity: 'Channel',
          entityId: channelId,
          metadata: JSON.stringify({ name: channelName }),
        },
      })
      log.info({ tenantId, channelId }, 'Channel deactivated')
    } catch (err) {
      captureError(err as Error, {
        service: 'channels',
        method: 'deactivateChannel',
        channelId,
        tenantId,
      })
      throw new Error('Failed to deactivate channel')
    }
  },
}

export type ChannelsService = typeof channelsService
