// ZIAY — Payments-config service layer.
//
// Wraps the DB access for the `/api/payments/config` route:
//   - Channel reads (the strategy fields: paymentStrategy, codFee, etc.).
//   - Setting reads (non-credential global thresholds: roas_kill_threshold,
//     cpa_target). Credential Setting rows (`cred::*`) are NEVER touched
//     here — they're managed by `credentialsService`.
//   - Channel strategy updates + global Setting upserts.
//
// The route keeps: auth, request parsing, the `cred::*` rejection guard,
// the response shaping (channel projection + masked global settings).
//
// SPRINT-BACKEND-FINAL-001 — service layer. Extracted from
// `/api/payments/config/route.ts`.

import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'

/** Whitelist of non-credential Setting keys that may be upserted via PATCH.
 *  Mirrors the route's `ALLOWED_SETTING_KEYS` constant — exported so the
 *  route + service stay in sync. */
export const ALLOWED_PAYMENTS_SETTING_KEYS = new Set([
  'roas_kill_threshold',
  'cpa_target',
])

export const paymentsConfigService = {
  /**
   * List all channels for a tenant (strategy fields only — the route
   * projects the response down to what the payments-config UI needs).
   * Used by `/api/payments/config` GET.
   */
  async listChannelsForTenant(tenantId: string) {
    try {
      return await db.channel.findMany({
        where: { tenantId },
        orderBy: { type: 'asc' },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'payments-config',
        method: 'listChannelsForTenant',
        tenantId,
      })
      throw new Error('Failed to fetch channels for payments config')
    }
  },

  /**
   * List ALL Setting rows. The route filters out `cred::*` rows + masks
   * any stray credential key before returning — this method just returns
   * the raw rows so the route can decide what to expose.
   */
  async listAllSettings() {
    try {
      return await db.setting.findMany()
    } catch (err) {
      captureError(err as Error, {
        service: 'payments-config',
        method: 'listAllSettings',
      })
      throw new Error('Failed to fetch settings')
    }
  },

  /**
   * Fetch a single channel by id. Used by PATCH for the tenant-ownership
   * check before any update.
   */
  async getChannelById(channelId: string) {
    try {
      return await db.channel.findUnique({ where: { id: channelId } })
    } catch (err) {
      captureError(err as Error, {
        service: 'payments-config',
        method: 'getChannelById',
        channelId,
      })
      throw new Error('Failed to fetch channel')
    }
  },

  /**
   * Update a channel's payment-strategy fields. The caller is responsible
   * for verifying tenant ownership before calling. Returns the updated
   * channel — the route returns it verbatim.
   */
  async updateChannelStrategy(
    channelId: string,
    data: Record<string, unknown>,
  ) {
    try {
      return await db.channel.update({
        where: { id: channelId },
        data,
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'payments-config',
        method: 'updateChannelStrategy',
        channelId,
      })
      throw new Error('Failed to update channel strategy')
    }
  },

  /**
   * Upsert a single global Setting row (key/value). The caller is
   * responsible for whitelisting the key against
   * `ALLOWED_PAYMENTS_SETTING_KEYS` + rejecting `cred::*` before calling.
   */
  async upsertSetting(key: string, value: string) {
    try {
      return await db.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'payments-config',
        method: 'upsertSetting',
        key,
      })
      throw new Error('Failed to upsert setting')
    }
  },
}

export type PaymentsConfigService = typeof paymentsConfigService
