// ZIAY — Marketplace service layer.
//
// Wraps MarketplaceListing, LeadShareConfig, LeadReferral access.
// The marketplace is the inter-tenant layer — listings from other
// tenants, lead sharing, referral commissions.
//
// SPRINT6-ARCH-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:marketplace')

export interface PublishListingInput {
  tenantId: string
  sku: string
  name: string
  price: number
  imageUrl?: string | null
  productId?: string | null
}

export interface CreateReferralInput {
  fromTenantId: string
  toTenantId: string
  customerPhone: string
  customerName?: string | null
  reason: string
  commission?: number
}

export const marketplaceService = {
  /**
   * Listings from OTHER tenants (active only). Used by the marketplace
   * browse view. Capped at 60 so the page never renders thousands.
   */
  async getListings(excludeTenantId: string) {
    try {
      return await db.marketplaceListing.findMany({
        where: { tenantId: { not: excludeTenantId }, active: true },
        orderBy: { createdAt: 'desc' },
        take: 60,
      })
    } catch (err) {
      captureError(err as Error, { service: 'marketplace', method: 'getListings', excludeTenantId })
      throw new Error('Failed to fetch marketplace listings')
    }
  },

  /**
   * Hydrate tenant brand info (`marca` / `nombreNegocio`) for a set of
   * listing tenant ids. Returns a Map keyed by tenantId so the caller can
   * attach `tenantName` to each listing row in a single pass.
   *
   * Used by `/api/marketplace` GET to decorate the listings browse view.
   */
  async getTenantBrands(tenantIds: string[]) {
    try {
      if (tenantIds.length === 0) return new Map<string, { marca: string; nombreNegocio: string }>()
      const tenants = await db.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, marca: true, nombreNegocio: true },
      })
      return new Map(tenants.map((t) => [t.id, { marca: t.marca, nombreNegocio: t.nombreNegocio }]))
    } catch (err) {
      captureError(err as Error, {
        service: 'marketplace',
        method: 'getTenantBrands',
        count: tenantIds.length,
      })
      throw new Error('Failed to fetch tenant brands')
    }
  },

  /**
   * The current tenant's own marketplace profile row (slug + marca +
   * nombreNegocio). Used to render the "your brand" card on the browse view.
   */
  async getCurrentTenantProfile(tenantId: string) {
    try {
      return await db.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, slug: true, marca: true, nombreNegocio: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'marketplace',
        method: 'getCurrentTenantProfile',
        tenantId,
      })
      throw new Error('Failed to fetch current tenant profile')
    }
  },

  /**
   * Listings published by THIS tenant (active + inactive).
   */
  async getMyListings(tenantId: string) {
    try {
      return await db.marketplaceListing.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })
    } catch (err) {
      captureError(err as Error, { service: 'marketplace', method: 'getMyListings', tenantId })
      throw new Error('Failed to fetch my listings')
    }
  },

  /**
   * Lead-share config (toggle + commission %) for a tenant.
   */
  async getLeadConfig(tenantId: string) {
    try {
      return await db.leadShareConfig.findUnique({ where: { tenantId } })
    } catch (err) {
      captureError(err as Error, { service: 'marketplace', method: 'getLeadConfig', tenantId })
      throw new Error('Failed to fetch lead config')
    }
  },

  /**
   * Referrals sent FROM + received BY a tenant. Used by the dashboard's
   * referrals panel.
   */
  async getReferrals(tenantId: string) {
    try {
      const [sent, received] = await Promise.all([
        db.leadReferral.findMany({
          where: { fromTenantId: tenantId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.leadReferral.findMany({
          where: { toTenantId: tenantId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ])
      return { sent, received }
    } catch (err) {
      captureError(err as Error, { service: 'marketplace', method: 'getReferrals', tenantId })
      throw new Error('Failed to fetch referrals')
    }
  },

  /**
   * Publish a new listing for this tenant.
   */
  async publishListing(input: PublishListingInput) {
    try {
      const listing = await db.marketplaceListing.create({
        data: {
          tenantId: input.tenantId,
          productId: input.productId ?? null,
          sku: input.sku,
          name: input.name,
          price: input.price,
          imageUrl: input.imageUrl ?? null,
          active: true,
        },
      })
      log.info({ tenantId: input.tenantId, listingId: listing.id, sku: input.sku }, 'Listing published')
      return listing
    } catch (err) {
      captureError(err as Error, { service: 'marketplace', method: 'publishListing', tenantId: input.tenantId })
      throw new Error('Failed to publish listing')
    }
  },

  /**
   * Upsert lead-share config for a tenant.
   */
  async upsertLeadConfig(
    tenantId: string,
    patch: { shareLeads: boolean; commissionPct: number },
  ) {
    try {
      const config = await db.leadShareConfig.upsert({
        where: { tenantId },
        update: { shareLeads: patch.shareLeads, commissionPct: patch.commissionPct },
        create: {
          tenantId,
          shareLeads: patch.shareLeads,
          commissionPct: patch.commissionPct,
        },
      })
      return config
    } catch (err) {
      captureError(err as Error, { service: 'marketplace', method: 'upsertLeadConfig', tenantId })
      throw new Error('Failed to update lead config')
    }
  },

  /**
   * Create a referral from one tenant to another. Defaults commission to
   * the source tenant's lead config when not provided.
   */
  async createReferral(input: CreateReferralInput) {
    try {
      let commission = typeof input.commission === 'number' ? input.commission : 0
      if (commission === 0) {
        const cfg = await db.leadShareConfig.findUnique({
          where: { tenantId: input.fromTenantId },
        })
        if (cfg) commission = cfg.commissionPct
      }
      const referral = await db.leadReferral.create({
        data: {
          fromTenantId: input.fromTenantId,
          toTenantId: input.toTenantId,
          customerPhone: input.customerPhone,
          customerName: input.customerName ?? null,
          reason: input.reason,
          commission,
          status: 'pending',
        },
      })
      log.info(
        {
          from: input.fromTenantId,
          to: input.toTenantId,
          referralId: referral.id,
          commission,
        },
        'Referral created',
      )
      return referral
    } catch (err) {
      captureError(err as Error, { service: 'marketplace', method: 'createReferral' })
      throw new Error('Failed to create referral')
    }
  },
}

export type MarketplaceService = typeof marketplaceService
