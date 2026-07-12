import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'

// Marketplace — MarketplaceListing, LeadShareConfig, LeadReferral.
//
// GET /api/marketplace?tenantId=X
//   listings (other tenants, active=true), myListings, leadConfig,
//   referrals { sent, received }, stats
//
// POST /api/marketplace { action, ...payload }
//   publish_listing | update_config | create_referral
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const [listings, myListings, leadConfig, sentReferrals, receivedReferrals, tenant] = await Promise.all([
    db.marketplaceListing.findMany({
      where: {
        tenantId: { not: tenantId },
        active: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    }),
    db.marketplaceListing.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }),
    db.leadShareConfig.findUnique({ where: { tenantId } }),
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
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, marca: true, nombreNegocio: true },
    }),
  ])

  // Attach tenant brand info to listings from other tenants
  const otherTenantIds = Array.from(new Set(listings.map((l) => l.tenantId)))
  const tenants = otherTenantIds.length
    ? await db.tenant.findMany({
        where: { id: { in: otherTenantIds } },
        select: { id: true, marca: true, nombreNegocio: true },
      })
    : []
  const tenantMap = new Map(tenants.map((t) => [t.id, t]))
  const listingsWithBrand = listings.map((l) => ({
    ...l,
    tenantName: tenantMap.get(l.tenantId)?.marca ?? '—',
  }))

  // Connected tenants = distinct tenants that have at least one active listing
  // OR share a referral with this tenant (either direction).
  const referralTenantIds = new Set<string>([
    ...sentReferrals.map((r) => r.toTenantId),
    ...receivedReferrals.map((r) => r.fromTenantId),
  ])
  const connectedTenants = new Set<string>([
    ...otherTenantIds,
    ...referralTenantIds,
  ]).size

  return NextResponse.json({
    listings: listingsWithBrand,
    myListings,
    leadConfig,
    referrals: { sent: sentReferrals, received: receivedReferrals },
    currentTenant: tenant,
    stats: {
      totalListings: listingsWithBrand.length,
      myListingsCount: myListings.length,
      connectedTenants,
      totalReferrals: sentReferrals.length + receivedReferrals.length,
      sentReferrals: sentReferrals.length,
      receivedReferrals: receivedReferrals.length,
    },
  })
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
      const listing = await db.marketplaceListing.create({
        data: {
          tenantId: p.tenantId,
          productId: p.productId ?? null,
          sku: p.sku,
          name: p.name,
          price: p.price,
          imageUrl: p.imageUrl ?? null,
          active: true,
        },
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
      const config = await db.leadShareConfig.upsert({
        where: { tenantId: p.tenantId },
        update: {
          shareLeads: p.shareLeads,
          commissionPct: p.commissionPct,
        },
        create: {
          tenantId: p.tenantId,
          shareLeads: p.shareLeads,
          commissionPct: p.commissionPct,
        },
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
    // Look up the receiving tenant's commission config to default the
    // commission if not provided.
    let commission = typeof p.commission === 'number' ? p.commission : 0
    if (commission === 0) {
      const cfg = await db.leadShareConfig.findUnique({
        where: { tenantId: p.fromTenantId },
      })
      if (cfg) commission = cfg.commissionPct
    }
    const referral = await db.leadReferral.create({
      data: {
        fromTenantId: p.fromTenantId,
        toTenantId: p.toTenantId,
        customerPhone: p.customerPhone,
        customerName: p.customerName ?? null,
        reason: p.reason,
        commission,
        status: 'pending',
      },
    })
    return NextResponse.json({ ok: true, referral })
  } catch (e) {
    return NextResponse.json(
      { error: 'Operation failed', detail: (e as Error).message },
      { status: 500 },
    )
  }
}
