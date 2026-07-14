import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { marketplaceService } from '@/lib/services'

// Marketplace — MarketplaceListing, LeadShareConfig, LeadReferral.
//
// GET /api/marketplace?tenantId=X
//   listings (other tenants, active=true), myListings, leadConfig,
//   referrals { sent, received }, stats
//
// POST /api/marketplace { action, ...payload }
//   publish_listing | update_config | create_referral
//
// SPRINT8-SERVICES-REST-001 — migrated the 6-way Promise.all (listings,
// myListings, leadConfig, sentReferrals, receivedReferrals, tenant) +
// the per-listing brand hydration + the three POST actions to
// `marketplaceService`. Response shapes unchanged.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    const [listings, myListings, leadConfig, referrals, currentTenant] = await Promise.all([
      marketplaceService.getListings(tenantId),
      marketplaceService.getMyListings(tenantId),
      marketplaceService.getLeadConfig(tenantId),
      marketplaceService.getReferrals(tenantId),
      marketplaceService.getCurrentTenantProfile(tenantId),
    ])

    // Attach tenant brand info to listings from other tenants.
    const otherTenantIds = Array.from(new Set(listings.map((l) => l.tenantId)))
    const tenantMap = await marketplaceService.getTenantBrands(otherTenantIds)
    const listingsWithBrand = listings.map((l) => ({
      ...l,
      tenantName: tenantMap.get(l.tenantId)?.marca ?? '—',
    }))

    // Connected tenants = distinct tenants that have at least one active
    // listing OR share a referral with this tenant (either direction).
    const referralTenantIds = new Set<string>([
      ...referrals.sent.map((r) => r.toTenantId),
      ...referrals.received.map((r) => r.fromTenantId),
    ])
    const connectedTenants = new Set<string>([
      ...otherTenantIds,
      ...referralTenantIds,
    ]).size

    return NextResponse.json({
      listings: listingsWithBrand,
      myListings,
      leadConfig,
      referrals: { sent: referrals.sent, received: referrals.received },
      currentTenant,
      stats: {
        totalListings: listingsWithBrand.length,
        myListingsCount: myListings.length,
        connectedTenants,
        totalReferrals: referrals.sent.length + referrals.received.length,
        sentReferrals: referrals.sent.length,
        receivedReferrals: referrals.received.length,
      },
    })
  } catch (err) {
    captureError(err as Error, { path: '/api/marketplace', method: 'GET', tenantId })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

const PublishListingSchema = z.object({
  action: z.literal('publish_listing'),
  tenantId: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  price: z.number(),
  imageUrl: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
})

const UpdateConfigSchema = z.object({
  action: z.literal('update_config'),
  tenantId: z.string().min(1),
  shareLeads: z.boolean(),
  commissionPct: z.number(),
})

const CreateReferralSchema = z.object({
  action: z.literal('create_referral'),
  fromTenantId: z.string().min(1),
  toTenantId: z.string().min(1),
  customerPhone: z.string().min(1),
  customerName: z.string().nullable().optional(),
  reason: z.string().min(1),
  commission: z.number().optional(),
})

const MarketplaceBodySchema = z.discriminatedUnion('action', [
  PublishListingSchema,
  UpdateConfigSchema,
  CreateReferralSchema,
])

export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = MarketplaceBodySchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const action = body.action

  const tenantId =
    action === 'create_referral' ? body.fromTenantId : body.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    if (action === 'publish_listing') {
      const listing = await marketplaceService.publishListing({
        tenantId: body.tenantId,
        sku: body.sku,
        name: body.name,
        price: body.price,
        imageUrl: body.imageUrl ?? null,
        productId: body.productId ?? null,
      })
      return NextResponse.json({ ok: true, listing })
    }

    if (action === 'update_config') {
      const config = await marketplaceService.upsertLeadConfig(body.tenantId, {
        shareLeads: body.shareLeads,
        commissionPct: body.commissionPct,
      })
      return NextResponse.json({ ok: true, config })
    }

    // create_referral
    if (body.fromTenantId === body.toTenantId) {
      return NextResponse.json(
        { error: 'fromTenantId and toTenantId must differ' },
        { status: 400 },
      )
    }
    const referral = await marketplaceService.createReferral({
      fromTenantId: body.fromTenantId,
      toTenantId: body.toTenantId,
      customerPhone: body.customerPhone,
      customerName: body.customerName ?? null,
      reason: body.reason,
      commission: typeof body.commission === 'number' ? body.commission : undefined,
    })
    return NextResponse.json({ ok: true, referral })
  } catch (e) {
    return NextResponse.json(
      { error: 'Operation failed', detail: (e as Error).message },
      { status: 500 },
    )
  }
}
