import { NextRequest, NextResponse } from 'next/server'
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

type PublishListingPayload = {
  tenantId: string
  sku: string
  name: string
  price: number
  imageUrl?: string | null
  productId?: string | null
}

type UpdateConfigPayload = {
  tenantId: string
  shareLeads: boolean
  commissionPct: number
}

type CreateReferralPayload = {
  fromTenantId: string
  toTenantId: string
  customerPhone: string
  customerName?: string | null
  reason: string
  commission?: number
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body?.action as string | undefined
  if (!action || !['publish_listing', 'update_config', 'create_referral'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const tenantId =
    action === 'create_referral' ? body?.fromTenantId : body?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    if (action === 'publish_listing') {
      const p = body as PublishListingPayload
      if (!p.sku || !p.name || typeof p.price !== 'number') {
        return NextResponse.json(
          { error: 'sku, name, price are required' },
          { status: 400 },
        )
      }
      const listing = await marketplaceService.publishListing({
        tenantId: p.tenantId,
        sku: p.sku,
        name: p.name,
        price: p.price,
        imageUrl: p.imageUrl ?? null,
        productId: p.productId ?? null,
      })
      return NextResponse.json({ ok: true, listing })
    }

    if (action === 'update_config') {
      const p = body as UpdateConfigPayload
      if (typeof p.shareLeads !== 'boolean' || typeof p.commissionPct !== 'number') {
        return NextResponse.json(
          { error: 'shareLeads (bool) and commissionPct (number) are required' },
          { status: 400 },
        )
      }
      const config = await marketplaceService.upsertLeadConfig(p.tenantId, {
        shareLeads: p.shareLeads,
        commissionPct: p.commissionPct,
      })
      return NextResponse.json({ ok: true, config })
    }

    // create_referral
    const p = body as CreateReferralPayload
    if (!p.fromTenantId || !p.toTenantId || !p.customerPhone || !p.reason) {
      return NextResponse.json(
        { error: 'fromTenantId, toTenantId, customerPhone, reason are required' },
        { status: 400 },
      )
    }
    if (p.fromTenantId === p.toTenantId) {
      return NextResponse.json(
        { error: 'fromTenantId and toTenantId must differ' },
        { status: 400 },
      )
    }
    const referral = await marketplaceService.createReferral({
      fromTenantId: p.fromTenantId,
      toTenantId: p.toTenantId,
      customerPhone: p.customerPhone,
      customerName: p.customerName ?? null,
      reason: p.reason,
      commission: typeof p.commission === 'number' ? p.commission : undefined,
    })
    return NextResponse.json({ ok: true, referral })
  } catch (e) {
    return NextResponse.json(
      { error: 'Operation failed', detail: (e as Error).message },
      { status: 500 },
    )
  }
}
