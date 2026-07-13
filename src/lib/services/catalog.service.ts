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
