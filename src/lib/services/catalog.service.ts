// ZIAY — Catalog service layer.
//
// Wraps product reads + the in-chat product share flow. Sync/import
// logic (woocommerce / shopify / supabase) lives in the adapters —
// `syncCatalog` here is the persistence seam that the adapters push
// records into.
//
// SPRINT6-ARCH-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:catalog')

export interface ProductUpsertInput {
  tenantId: string
  sku: string
  name: string
  description?: string | null
  price: number
  cost?: number
  imageUrl?: string | null
  stock?: number
  diseno?: string | null
  categoria?: string | null
  fuenteSincronizacion?: string | null
}

export const catalogService = {
  /**
   * Search products for a tenant. `q` matches name, sku, diseno, categoria.
   * Used by `/api/catalog/products`.
   *
   * FIX-PERFORMANCE-001 — was unbounded (no `take`) and selected every
   * column. Now capped at 200 rows + `select` limited to the fields the
   * catalog-visual + integrations views actually render.
   */
  async getProducts(tenantId: string, q?: string) {
    try {
      return await db.product.findMany({
        where: {
          tenantId,
          active: true,
          ...(q
            ? {
                OR: [
                  { name: { contains: q } },
                  { sku: { contains: q } },
                  { diseno: { contains: q } },
                  { categoria: { contains: q } },
                ],
              }
            : {}),
        },
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
    } catch (err) {
      captureError(err as Error, { service: 'catalog', method: 'getProducts', tenantId })
      throw new Error('Failed to fetch products')
    }
  },

  /**
   * Lookup by composite key (tenantId, sku). Returns null when not found
   * — callers decide whether that's a 404 or a soft fallback.
   */
  async getProductBySku(tenantId: string, sku: string) {
    try {
      return await db.product.findUnique({
        where: { tenantId_sku: { tenantId, sku } },
      })
    } catch (err) {
      captureError(err as Error, { service: 'catalog', method: 'getProductBySku', tenantId, sku })
      throw new Error('Failed to fetch product')
    }
  },

  /**
   * Bulk upsert from a sync adapter (woocommerce / shopify / supabase).
   * Each row is keyed by (tenantId, sku). The adapter is responsible for
   * shape — this method just persists.
   */
  async syncCatalog(tenantId: string, products: ProductUpsertInput[]) {
    try {
      const result = await db.$transaction(
        products.map((p) =>
          db.product.upsert({
            where: { tenantId_sku: { tenantId: p.tenantId, sku: p.sku } },
            update: {
              name: p.name,
              description: p.description ?? null,
              price: p.price,
              cost: p.cost ?? 0,
              imageUrl: p.imageUrl ?? null,
              stock: p.stock ?? 0,
              diseno: p.diseno ?? null,
              categoria: p.categoria ?? null,
              fuenteSincronizacion: p.fuenteSincronizacion ?? null,
            },
            create: {
              tenantId: p.tenantId,
              sku: p.sku,
              name: p.name,
              description: p.description ?? null,
              price: p.price,
              cost: p.cost ?? 0,
              imageUrl: p.imageUrl ?? null,
              stock: p.stock ?? 0,
              diseno: p.diseno ?? null,
              categoria: p.categoria ?? null,
              fuenteSincronizacion: p.fuenteSincronizacion ?? null,
            },
          }),
        ),
      )
      log.info({ tenantId, count: result.length }, 'Catalog synced')
      return result
    } catch (err) {
      captureError(err as Error, { service: 'catalog', method: 'syncCatalog', tenantId })
      throw new Error('Failed to sync catalog')
    }
  },

  /**
   * Lightweight product list (id, sku, name, imageUrl) for the enrichment
   * dashboard's "pending" panel. Only returns active products.
   *
   * Used by `/api/product-enrichment` GET to compute which products still
   * lack a ProductEnrichment row.
   */
  async getActiveProductsForEnrichment(tenantId: string) {
    try {
      return await db.product.findMany({
        where: { tenantId, active: true },
        select: { sku: true, name: true, imageUrl: true },
        orderBy: { name: 'asc' },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'catalog',
        method: 'getActiveProductsForEnrichment',
        tenantId,
      })
      throw new Error('Failed to fetch products for enrichment')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Catalog sync trigger — SPRINT-BACKEND-FINAL-001.
  //
  // The route `/api/catalog/sync` enqueues a `catalog-sync` job (the actual
  // product upsert lives in the queue worker — `catalogService.syncCatalog`
  // is the persistence seam the worker uses). The route still needs two
  // small DB reads around the enqueue call: a tenant existence check +
  // read-back of the latest `catalog_sync` audit-log entry to surface the
  // synced count in the HTTP response (inline mode only).
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch the tenant fields needed by the catalog sync route:
   * `plataformaCatalogo` (used in the response + by the queue worker),
   * `slug` (response), `nombreNegocio` (debug). Returns null when the
   * tenant doesn't exist — the route maps that to a 404.
   */
  async getTenantForSync(tenantId: string) {
    try {
      return await db.tenant.findUnique({
        where: { id: tenantId },
        select: { plataformaCatalogo: true, slug: true, nombreNegocio: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'catalog',
        method: 'getTenantForSync',
        tenantId,
      })
      throw new Error('Failed to fetch tenant for catalog sync')
    }
  },

  /**
   * Read back the latest `catalog_sync` audit-log row for the tenant. Used
   * by the route in inline queue mode to surface the synced count + fuente
   * in the HTTP response. Returns null when no sync has run yet.
   */
  async getLatestCatalogSyncAudit(tenantId: string) {
    try {
      return await db.auditLog.findFirst({
        where: { tenantId, action: 'catalog_sync' },
        orderBy: { createdAt: 'desc' },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'catalog',
        method: 'getLatestCatalogSyncAudit',
        tenantId,
      })
      throw new Error('Failed to fetch latest catalog sync audit log')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ProductEnrichment — VLM-generated tags / description / score per SKU.
  // Kept here (rather than a new enrichment.service.ts) because
  // ProductEnrichment is a 1:1 extension of Product — same domain.
  // SPRINT8-SERVICES-REST-001.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List all enrichment rows for a tenant + the set of enriched SKUs.
   * Used by `/api/product-enrichment` GET to power the dashboard.
   */
  async getEnrichments(tenantId: string) {
    try {
      // FIX-PERFORMANCE-001 — both findMany were unbounded. Capped at 200
      // rows each (matches getProducts ceiling) so a tenant with thousands
      // of enriched SKUs doesn't pull the whole table into memory.
      const [enrichments, enrichedSkus] = await Promise.all([
        db.productEnrichment.findMany({
          where: { tenantId },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        }),
        db.productEnrichment.findMany({
          where: { tenantId },
          select: { sku: true },
          take: 200,
        }),
      ])
      return { enrichments, enrichedSkus }
    } catch (err) {
      captureError(err as Error, {
        service: 'catalog',
        method: 'getEnrichments',
        tenantId,
      })
      throw new Error('Failed to fetch enrichments')
    }
  },

  /**
   * Upsert a ProductEnrichment row keyed by (tenantId, sku). Mirrors the
   * prior inline route logic — JSON-stringified tags, optional description,
   * enrichment score in [0, 1].
   */
  async upsertEnrichment(input: {
    tenantId: string
    sku: string
    tags: string
    description?: string | null
    enrichmentScore: number
  }) {
    try {
      return await db.productEnrichment.upsert({
        where: { tenantId_sku: { tenantId: input.tenantId, sku: input.sku } },
        create: {
          tenantId: input.tenantId,
          sku: input.sku,
          tags: input.tags,
          description: input.description || null,
          enrichmentScore: input.enrichmentScore,
        },
        update: {
          tags: input.tags,
          description: input.description || null,
          enrichmentScore: input.enrichmentScore,
        },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'catalog',
        method: 'upsertEnrichment',
        tenantId: input.tenantId,
        sku: input.sku,
      })
      throw new Error('Failed to upsert enrichment')
    }
  },

  /**
   * Send a product card (with image) into a conversation as an outbound
   * `order_card` message. Bridges the catalog visual view with the chat.
   * Used by `/api/catalog/send-to-chat`.
   */
  async sendToChat(tenantId: string, conversationId: string, sku: string) {
    try {
      const product = await db.product.findUnique({
        where: { tenantId_sku: { tenantId, sku } },
      })
      if (!product) return null

      const messageBody = `📦 *${product.name}*
SKU: ${product.sku}
Precio: $${product.price.toLocaleString('es-CO')} COP
${product.diseno && product.diseno !== 'liso' ? `Diseno: ${product.diseno}\n` : ''}${product.description || ''}

${product.imageUrl || ''}`

      const msg = await db.message.create({
        data: {
          tenantId,
          conversationId,
          direction: 'outbound',
          body: messageBody,
          type: 'order_card',
          mediaUrl: product.imageUrl,
          status: 'sent',
        },
      })
      await db.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(), unreadCount: 0 },
      })
      log.info(
        { tenantId, conversationId, sku, productId: product.id },
        'Product sent to chat',
      )
      return { message: msg, product }
    } catch (err) {
      captureError(err as Error, {
        service: 'catalog',
        method: 'sendToChat',
        tenantId,
        conversationId,
        sku,
      })
      throw new Error('Failed to send product to chat')
    }
  },
}

export type CatalogService = typeof catalogService
