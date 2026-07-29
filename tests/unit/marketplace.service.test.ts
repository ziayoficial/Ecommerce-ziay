// Unit tests for src/lib/services/marketplace.service.ts
// TASK: SPRINT-TESTS-001
//
// Covers the 5 task-listed methods (mapped to actual method names where they
// differ from the task description):
//   - getListings        → cross-tenant listings (active, exclude caller tenant)
//   - getMyListings      → tenant-scoped listings (active + inactive)
//   - publishListing     → creates a new listing (task called this `createListing`)
//   - upsertLeadConfig   → toggles shareLeads boolean (task called this `toggleListing`;
//                        actual service has no `toggleListing` method — the
//                        closest semantic match is `upsertLeadConfig` which
//                        toggles `shareLeads` on the tenant's LeadShareConfig)
//   - createReferral     → creates a LeadReferral, defaults commission from
//                        LeadShareConfig when not provided
//
// Mock pattern mirrors wallet.service.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    marketplaceListing: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    tenant: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    leadShareConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    leadReferral: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Stub logger so tests don't print pino output.
const { loggerMock } = vi.hoisted(() => {
  const m: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
    child: () => unknown
  } = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => m,
  }
  return { loggerMock: m }
})
vi.mock('@/lib/logger', () => ({
  getLogger: () => loggerMock,
  logger: loggerMock,
  default: loggerMock,
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

import { marketplaceService } from '@/lib/services/marketplace.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getListings
// ─────────────────────────────────────────────────────────────────────────────
describe('marketplaceService.getListings', () => {
  it('returns cross-tenant active listings, capped at 60', async () => {
    const listings = [
      {
        id: 'ml-1',
        tenantId: 'ten-2',
        sku: 'SKU-1',
        name: 'Product 1',
        price: 10000,
        active: true,
      },
      {
        id: 'ml-2',
        tenantId: 'ten-3',
        sku: 'SKU-2',
        name: 'Product 2',
        price: 20000,
        active: true,
      },
    ]
    db.marketplaceListing.findMany.mockResolvedValue(listings)

    const result = await marketplaceService.getListings('ten-1')

    expect(result).toEqual(listings)
    // The caller tenant is EXCLUDED — only listings from OTHER tenants
    // (active only) are returned.
    expect(db.marketplaceListing.findMany).toHaveBeenCalledWith({
      where: { tenantId: { not: 'ten-1' }, active: true },
      orderBy: { createdAt: 'desc' },
      take: 60,
    })
  })

  it('returns an empty array when no other tenants have listings', async () => {
    db.marketplaceListing.findMany.mockResolvedValue([])
    const result = await marketplaceService.getListings('ten-1')
    expect(result).toEqual([])
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.marketplaceListing.findMany.mockRejectedValue(new Error('boom'))
    await expect(marketplaceService.getListings('ten-1')).rejects.toThrow(
      'Failed to fetch marketplace listings',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getMyListings
// ─────────────────────────────────────────────────────────────────────────────
describe('marketplaceService.getMyListings', () => {
  it('returns the tenant-owned listings (active + inactive), capped at 200', async () => {
    const listings = [
      {
        id: 'ml-1',
        tenantId: 'ten-1',
        sku: 'SKU-A',
        name: 'My Product 1',
        price: 5000,
        active: true,
      },
      {
        id: 'ml-2',
        tenantId: 'ten-1',
        sku: 'SKU-B',
        name: 'My Product 2',
        price: 8000,
        active: false, // inactive listings are included for the owner view
      },
    ]
    db.marketplaceListing.findMany.mockResolvedValue(listings)

    const result = await marketplaceService.getMyListings('ten-1')

    expect(result).toEqual(listings)
    // Tenant-scoped — no `active` filter (owner sees both active + inactive).
    expect(db.marketplaceListing.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.marketplaceListing.findMany.mockRejectedValue(new Error('boom'))
    await expect(marketplaceService.getMyListings('ten-1')).rejects.toThrow(
      'Failed to fetch my listings',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// publishListing (task called this `createListing`)
// ─────────────────────────────────────────────────────────────────────────────
describe('marketplaceService.publishListing', () => {
  it('creates a listing with active=true and the provided fields', async () => {
    const created = {
      id: 'ml-new',
      tenantId: 'ten-1',
      sku: 'SKU-NEW',
      name: 'Brand New Product',
      price: 15000,
      imageUrl: 'https://example.com/img.jpg',
      active: true,
    }
    db.marketplaceListing.create.mockResolvedValue(created)

    const result = await marketplaceService.publishListing({
      tenantId: 'ten-1',
      sku: 'SKU-NEW',
      name: 'Brand New Product',
      price: 15000,
      imageUrl: 'https://example.com/img.jpg',
      productId: 'prod-1',
    })

    expect(result).toEqual(created)
    expect(db.marketplaceListing.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        productId: 'prod-1',
        sku: 'SKU-NEW',
        name: 'Brand New Product',
        price: 15000,
        imageUrl: 'https://example.com/img.jpg',
        active: true,
      },
    })
  })

  it('defaults productId and imageUrl to null when not provided', async () => {
    db.marketplaceListing.create.mockResolvedValue({ id: 'ml-2' })

    await marketplaceService.publishListing({
      tenantId: 'ten-1',
      sku: 'SKU-X',
      name: 'Minimal Product',
      price: 1000,
    })

    expect(db.marketplaceListing.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'ten-1',
        productId: null,
        sku: 'SKU-X',
        name: 'Minimal Product',
        price: 1000,
        imageUrl: null,
        active: true,
      },
    })
  })

  it('throws a wrapped Error when create rejects', async () => {
    db.marketplaceListing.create.mockRejectedValue(new Error('dup'))
    await expect(
      marketplaceService.publishListing({
        tenantId: 'ten-1',
        sku: 'SKU-DUP',
        name: 'Dup',
        price: 100,
      }),
    ).rejects.toThrow('Failed to publish listing')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// upsertLeadConfig (task called this `toggleListing` — closest actual match
// is the lead-share toggle, which flips `shareLeads` boolean on the tenant's
// LeadShareConfig)
// ─────────────────────────────────────────────────────────────────────────────
describe('marketplaceService.upsertLeadConfig', () => {
  it('upserts the lead-share config (toggles shareLeads + sets commissionPct)', async () => {
    const config = {
      id: 'lsc-1',
      tenantId: 'ten-1',
      shareLeads: true,
      commissionPct: 7.5,
    }
    db.leadShareConfig.upsert.mockResolvedValue(config)

    const result = await marketplaceService.upsertLeadConfig('ten-1', {
      shareLeads: true,
      commissionPct: 7.5,
    })

    expect(result).toEqual(config)
    expect(db.leadShareConfig.upsert).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      update: { shareLeads: true, commissionPct: 7.5 },
      create: {
        tenantId: 'ten-1',
        shareLeads: true,
        commissionPct: 7.5,
      },
    })
  })

  it('can deactivate lead-sharing (shareLeads=false)', async () => {
    db.leadShareConfig.upsert.mockResolvedValue({
      id: 'lsc-2',
      shareLeads: false,
      commissionPct: 0,
    })

    await marketplaceService.upsertLeadConfig('ten-1', {
      shareLeads: false,
      commissionPct: 0,
    })

    expect(db.leadShareConfig.upsert).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
      update: { shareLeads: false, commissionPct: 0 },
      create: {
        tenantId: 'ten-1',
        shareLeads: false,
        commissionPct: 0,
      },
    })
  })

  it('throws a wrapped Error when the upsert rejects', async () => {
    db.leadShareConfig.upsert.mockRejectedValue(new Error('db'))
    await expect(
      marketplaceService.upsertLeadConfig('ten-1', {
        shareLeads: true,
        commissionPct: 5,
      }),
    ).rejects.toThrow('Failed to update lead config')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createReferral
// ─────────────────────────────────────────────────────────────────────────────
describe('marketplaceService.createReferral', () => {
  it('creates a referral with the explicitly provided commission', async () => {
    const referral = {
      id: 'lr-1',
      fromTenantId: 'ten-1',
      toTenantId: 'ten-2',
      customerPhone: '5712345678',
      customerName: 'Jane Doe',
      reason: 'out_of_stock',
      commission: 8.0,
      status: 'pending',
    }
    db.leadReferral.create.mockResolvedValue(referral)

    const result = await marketplaceService.createReferral({
      fromTenantId: 'ten-1',
      toTenantId: 'ten-2',
      customerPhone: '5712345678',
      customerName: 'Jane Doe',
      reason: 'out_of_stock',
      commission: 8.0,
    })

    expect(result).toEqual(referral)
    // When commission is provided, LeadShareConfig is NOT queried.
    expect(db.leadShareConfig.findUnique).not.toHaveBeenCalled()

    expect(db.leadReferral.create).toHaveBeenCalledWith({
      data: {
        fromTenantId: 'ten-1',
        toTenantId: 'ten-2',
        customerPhone: '5712345678',
        customerName: 'Jane Doe',
        reason: 'out_of_stock',
        commission: 8.0,
        status: 'pending',
      },
    })
  })

  it('defaults commission from the source tenant LeadShareConfig when not provided', async () => {
    db.leadShareConfig.findUnique.mockResolvedValue({
      id: 'lsc-1',
      tenantId: 'ten-1',
      shareLeads: true,
      commissionPct: 5,
    })
    db.leadReferral.create.mockResolvedValue({ id: 'lr-2', commission: 5 })

    await marketplaceService.createReferral({
      fromTenantId: 'ten-1',
      toTenantId: 'ten-2',
      customerPhone: '572',
      reason: 'no_coverage',
    })

    // Looked up the source tenant's LeadShareConfig for the default commission.
    expect(db.leadShareConfig.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1' },
    })
    // create was called with commission=5 (from LeadShareConfig).
    expect(db.leadReferral.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ commission: 5 }),
    })
  })

  it('defaults commission to 0 when no LeadShareConfig exists for the source tenant', async () => {
    db.leadShareConfig.findUnique.mockResolvedValue(null)
    db.leadReferral.create.mockResolvedValue({ id: 'lr-3' })

    await marketplaceService.createReferral({
      fromTenantId: 'ten-1',
      toTenantId: 'ten-2',
      customerPhone: '573',
      reason: 'no_coverage',
    })

    expect(db.leadReferral.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ commission: 0 }),
    })
  })

  it('defaults customerName to null when not provided', async () => {
    db.leadShareConfig.findUnique.mockResolvedValue(null)
    db.leadReferral.create.mockResolvedValue({ id: 'lr-4' })

    await marketplaceService.createReferral({
      fromTenantId: 'ten-1',
      toTenantId: 'ten-2',
      customerPhone: '574',
      reason: 'no_coverage',
    })

    expect(db.leadReferral.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerName: null }),
    })
  })

  it('throws a wrapped Error when create rejects', async () => {
    db.leadShareConfig.findUnique.mockResolvedValue(null)
    db.leadReferral.create.mockRejectedValue(new Error('db'))
    await expect(
      marketplaceService.createReferral({
        fromTenantId: 'ten-1',
        toTenantId: 'ten-2',
        customerPhone: '575',
        reason: 'r',
      }),
    ).rejects.toThrow('Failed to create referral')
  })
})
