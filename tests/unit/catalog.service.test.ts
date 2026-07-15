// Unit tests for src/lib/services/catalog.service.ts
// TASK: SPRINT-TESTS-COMPLETE-001
//
// Covers the 6 task-listed methods (mapped to actual method names where they
// differ from the task description):
//   - getProducts        → paginated (take: 200) product list with search +
//                          explicit `select` (FIX-PERFORMANCE-001).
//   - getProductBySku    → lookup by composite key (tenantId, sku).
//   - createProduct      → no `createProduct` method exists on the service;
//                          the closest equivalent is `syncCatalog` (bulk
//                          upsert from an adapter). Covered below as the
//                          "create" surface.
//   - updateProduct      → no `updateProduct` method exists; `syncCatalog`
//                          handles upserts (the closest equivalent).
//   - getEnrichments     → ProductEnrichment rows for a tenant + the set of
//                          enriched SKUs (take: 200 on both queries).
//   - sendToChat         → persists an outbound `order_card` Message into a
//                          conversation + bumps the conversation's
//                          lastMessageAt / unreadCount.
//
// Mock pattern mirrors wallet.service.test.ts / logistics.service.test.ts —
// vi.hoisted + deep vi.fn mock for every db delegate the service touches.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    productEnrichment: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    message: {
      create: vi.fn(),
    },
    conversation: {
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
    },
    // syncCatalog uses the array form of $transaction (rows.map(upsert)).
    $transaction: vi.fn(async (promises: Promise<unknown>[]) => Promise.all(promises)),
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Stub logger so tests don't print pino output. captureError calls logger
// internally — silence it. Must export BOTH named `logger` (used by
// capture-error.ts) and `getLogger` + `default` (used by services).
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

import { catalogService } from '@/lib/services/catalog.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// getProducts — pagination + search + select (take: 200)
// ─────────────────────────────────────────────────────────────────────────────
describe('catalogService.getProducts', () => {
  it('returns active products for a tenant capped at 200 with the fixed select shape', async () => {
    const products = [
      {
        id: 'p-1',
        sku: 'SKU-001',
        name: 'Camiseta Básica',
        price: 25000,
        stock: 100,
        tenantId: 'ten-1',
      },
    ]
    db.product.findMany.mockResolvedValue(products)

    const result = await catalogService.getProducts('ten-1')

    expect(result).toEqual(products)
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', active: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        price: true,
        cost: true,
        imageUrl: true,
        stock: true,
        diseno: true,
        categoria: true,
        imagenMetadataVisible: true,
        fuenteSincronizacion: true,
        tenantId: true,
      },
    })
  })

  it('builds an OR search clause across name / sku / diseno / categoria when q is provided', async () => {
    db.product.findMany.mockResolvedValue([])

    await catalogService.getProducts('ten-1', 'camiseta')

    const call = db.product.findMany.mock.calls[0][0] as {
      where: { OR: Array<Record<string, { contains: string }>> }
    }
    expect(call.where.OR).toEqual([
      { name: { contains: 'camiseta' } },
      { sku: { contains: 'camiseta' } },
      { diseno: { contains: 'camiseta' } },
      { categoria: { contains: 'camiseta' } },
    ])
  })

  it('omits the OR clause when q is not provided', async () => {
    db.product.findMany.mockResolvedValue([])

    await catalogService.getProducts('ten-1')

    const call = db.product.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>
    }
    expect(call.where.OR).toBeUndefined()
  })

  it('returns an empty array when the tenant has no active products', async () => {
    db.product.findMany.mockResolvedValue([])
    const result = await catalogService.getProducts('ten-empty')
    expect(result).toEqual([])
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.product.findMany.mockRejectedValue(new Error('boom'))
    await expect(catalogService.getProducts('ten-1')).rejects.toThrow(
      'Failed to fetch products',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getProductBySku — composite key lookup
// ─────────────────────────────────────────────────────────────────────────────
describe('catalogService.getProductBySku', () => {
  it('returns the product when (tenantId, sku) matches', async () => {
    const product = { id: 'p-1', tenantId: 'ten-1', sku: 'SKU-001', name: 'Camiseta' }
    db.product.findUnique.mockResolvedValue(product)

    const result = await catalogService.getProductBySku('ten-1', 'SKU-001')

    expect(result).toEqual(product)
    expect(db.product.findUnique).toHaveBeenCalledWith({
      where: { tenantId_sku: { tenantId: 'ten-1', sku: 'SKU-001' } },
    })
  })

  it('returns null when the (tenantId, sku) does not match any product', async () => {
    db.product.findUnique.mockResolvedValue(null)

    const result = await catalogService.getProductBySku('ten-1', 'MISSING')

    expect(result).toBeNull()
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.product.findUnique.mockRejectedValue(new Error('db down'))

    await expect(
      catalogService.getProductBySku('ten-1', 'SKU-001'),
    ).rejects.toThrow('Failed to fetch product')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createProduct / updateProduct — service exposes `syncCatalog` (bulk upsert)
// rather than single-row create/update. Both flows are tested below.
// ─────────────────────────────────────────────────────────────────────────────
describe('catalogService.syncCatalog (createProduct / updateProduct surface)', () => {
  it('upserts each product by (tenantId, sku) compound key inside a $transaction', async () => {
    const products = [
      {
        tenantId: 'ten-1',
        sku: 'SKU-001',
        name: 'Camiseta',
        price: 25000,
        cost: 12000,
        imageUrl: 'https://cdn/img/1.jpg',
        stock: 100,
        diseno: 'liso',
        categoria: 'ropa',
        fuenteSincronizacion: 'woocommerce',
      },
    ]
    db.product.upsert.mockResolvedValue({ id: 'p-1', ...products[0] })

    const result = await catalogService.syncCatalog('ten-1', products)

    expect(result).toEqual([{ id: 'p-1', ...products[0] }])
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.product.upsert).toHaveBeenCalledTimes(1)

    // Verify the upsert shape — same payload for update + create.
    expect(db.product.upsert).toHaveBeenCalledWith({
      where: { tenantId_sku: { tenantId: 'ten-1', sku: 'SKU-001' } },
      update: {
        name: 'Camiseta',
        description: null,
        price: 25000,
        cost: 12000,
        imageUrl: 'https://cdn/img/1.jpg',
        stock: 100,
        diseno: 'liso',
        categoria: 'ropa',
        fuenteSincronizacion: 'woocommerce',
      },
      create: {
        tenantId: 'ten-1',
        sku: 'SKU-001',
        name: 'Camiseta',
        description: null,
        price: 25000,
        cost: 12000,
        imageUrl: 'https://cdn/img/1.jpg',
        stock: 100,
        diseno: 'liso',
        categoria: 'ropa',
        fuenteSincronizacion: 'woocommerce',
      },
    })
  })

  it('defaults cost/stock to 0 + nullable fields to null when omitted', async () => {
    db.product.upsert.mockResolvedValue({ id: 'p-2' })

    await catalogService.syncCatalog('ten-1', [
      {
        tenantId: 'ten-1',
        sku: 'SKU-002',
        name: 'Producto',
        price: 1000,
      },
    ])

    expect(db.product.upsert).toHaveBeenCalledWith({
      where: { tenantId_sku: { tenantId: 'ten-1', sku: 'SKU-002' } },
      update: expect.objectContaining({
        cost: 0,
        stock: 0,
        imageUrl: null,
        diseno: null,
        categoria: null,
        fuenteSincronizacion: null,
        description: null,
      }),
      create: expect.objectContaining({
        cost: 0,
        stock: 0,
        imageUrl: null,
        diseno: null,
        categoria: null,
        fuenteSincronizacion: null,
        description: null,
      }),
    })
  })

  it('throws a wrapped Error when the $transaction rejects', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('tx aborted'))

    await expect(
      catalogService.syncCatalog('ten-1', [
        { tenantId: 'ten-1', sku: 'X', name: 'X', price: 1 },
      ]),
    ).rejects.toThrow('Failed to sync catalog')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getEnrichments — take: 200 on BOTH parallel queries
// ─────────────────────────────────────────────────────────────────────────────
describe('catalogService.getEnrichments', () => {
  it('returns enrichments + enrichedSkus (both capped at 200) in parallel', async () => {
    const enrichments = [
      { id: 'e-1', tenantId: 'ten-1', sku: 'SKU-001', tags: '["red"]', enrichmentScore: 0.9 },
    ]
    const enrichedSkus = [{ sku: 'SKU-001' }, { sku: 'SKU-002' }]
    // First call → enrichments, second call → enrichedSkus
    db.productEnrichment.findMany
      .mockResolvedValueOnce(enrichments)
      .mockResolvedValueOnce(enrichedSkus)

    const result = await catalogService.getEnrichments('ten-1')

    expect(result).toEqual({ enrichments, enrichedSkus })
    expect(db.productEnrichment.findMany).toHaveBeenCalledTimes(2)

    // First call — enrichments list (take: 200, ordered by updatedAt desc)
    expect(db.productEnrichment.findMany).toHaveBeenNthCalledWith(1, {
      where: { tenantId: 'ten-1' },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    // Second call — enriched SKUs (select sku, take: 200)
    expect(db.productEnrichment.findMany).toHaveBeenNthCalledWith(2, {
      where: { tenantId: 'ten-1' },
      select: { sku: true },
      take: 200,
    })
  })

  it('returns empty arrays when the tenant has no enrichments', async () => {
    db.productEnrichment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await catalogService.getEnrichments('ten-empty')

    expect(result).toEqual({ enrichments: [], enrichedSkus: [] })
  })

  it('throws a wrapped Error when the underlying db call rejects', async () => {
    db.productEnrichment.findMany.mockRejectedValue(new Error('db down'))

    await expect(catalogService.getEnrichments('ten-1')).rejects.toThrow(
      'Failed to fetch enrichments',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sendToChat — sends a catalog item to a conversation as an outbound order_card
// ─────────────────────────────────────────────────────────────────────────────
describe('catalogService.sendToChat', () => {
  it('persists an outbound order_card message + bumps conversation lastMessageAt + clears unread', async () => {
    const product = {
      id: 'p-1',
      tenantId: 'ten-1',
      sku: 'SKU-001',
      name: 'Camiseta Básica',
      price: 25000,
      diseno: 'estampado',
      description: 'Algodón premium',
      imageUrl: 'https://cdn/img/1.jpg',
    }
    db.product.findUnique.mockResolvedValue(product)
    const message = {
      id: 'm-1',
      conversationId: 'c-1',
      direction: 'outbound',
      type: 'order_card',
      body: expect.stringContaining('Camiseta Básica'),
    }
    db.message.create.mockResolvedValue(message)
    db.conversation.update.mockResolvedValue({ id: 'c-1' })

    const result = await catalogService.sendToChat('ten-1', 'c-1', 'SKU-001')

    // sendToChat returns `{ message, product } | null` — assert non-null first
    // so TypeScript narrows the type for the property accesses below.
    expect(result).not.toBeNull()
    expect(result!.message).toEqual(message)
    expect(result!.product).toEqual(product)

    // Lookup by composite key
    expect(db.product.findUnique).toHaveBeenCalledWith({
      where: { tenantId_sku: { tenantId: 'ten-1', sku: 'SKU-001' } },
    })

    // Message row: outbound + order_card + mediaUrl set from product.imageUrl
    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'ten-1',
        conversationId: 'c-1',
        direction: 'outbound',
        type: 'order_card',
        mediaUrl: 'https://cdn/img/1.jpg',
        status: 'sent',
      }),
    })
    // Body must include the product name + sku + price (es-CO formatted).
    const createCall = db.message.create.mock.calls[0][0] as { data: { body: string } }
    expect(createCall.data.body).toContain('Camiseta Básica')
    expect(createCall.data.body).toContain('SKU-001')
    expect(createCall.data.body).toContain('25.000')

    // Conversation bump — lastMessageAt is a fresh Date + unreadCount reset
    // to 0 so the agent's "unread" badge clears when they share a product.
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { lastMessageAt: expect.any(Date), unreadCount: 0 },
    })
  })

  it('omits the "Diseno" line when diseno is "liso" (or absent)', async () => {
    db.product.findUnique.mockResolvedValue({
      id: 'p-2',
      sku: 'SKU-002',
      name: 'Plain Tee',
      price: 10000,
      diseno: 'liso',
      description: null,
      imageUrl: null,
    })
    db.message.create.mockResolvedValue({ id: 'm-2' })
    db.conversation.update.mockResolvedValue({ id: 'c-2' })

    await catalogService.sendToChat('ten-1', 'c-2', 'SKU-002')

    const createCall = db.message.create.mock.calls[0][0] as { data: { body: string } }
    expect(createCall.data.body).not.toContain('Diseno')
  })

  it('returns null when the product does not exist (no message persisted)', async () => {
    db.product.findUnique.mockResolvedValue(null)

    const result = await catalogService.sendToChat('ten-1', 'c-1', 'MISSING-SKU')

    expect(result).toBeNull()
    expect(db.message.create).not.toHaveBeenCalled()
    expect(db.conversation.update).not.toHaveBeenCalled()
  })

  it('throws a wrapped Error when message.create rejects', async () => {
    db.product.findUnique.mockResolvedValue({
      id: 'p-3',
      sku: 'SKU-003',
      name: 'X',
      price: 100,
    })
    db.message.create.mockRejectedValue(new Error('db down'))

    await expect(
      catalogService.sendToChat('ten-1', 'c-3', 'SKU-003'),
    ).rejects.toThrow('Failed to send product to chat')
  })
})
