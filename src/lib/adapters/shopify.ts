// ─────────────────────────────────────────────────────────────────────────────
// ShopifyAdapter — catálogo Shopify del cliente (Saramantha §8.3, §9.3)
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO (real integration):
// - Auth: OAuth 2.0 (App pública) o Custom App access token (Admin API).
//   Guardar en `Tenant.credencialesCatalogoRef`.
// - Endpoints: Shopify Admin GraphQL API
//   (`https://{shop}.myshopify.com/admin/api/2024-10/graphql.json`).
//   · `productSearch` (Shopify Plus) o `products(first:50, query:{q})` → buscarProductos
//   · `product(id: gid://shopify/Product/{id})`                  → obtenerProducto
//   · `orderCreate(input: {lineItems, customer, shippingAddress})` → crearPedido
//   · `inventoryAdjustQuantities`                                → actualizarInventario
//   · `order(id: gid://shopify/Order/{id})`                      → obtenerEstadoPedido
// - Mapeo de estado Shopify → estado interno:
//   PENDING → pending_payment, PAID → paid, PROCESSING → preparing,
//   FULFILLED → shipped, DELIVERED → delivered, CANCELLED → cancelled.
// - Rate limits: Shopify REST = 40 req/app/min por tienda (bucket);
//   GraphQL = 1000 query points/min (cada query cuesta puntos según costo).
//   Usar `throttleStatus` en la respuesta para backoff.
// - Webhooks: `products/create`, `products/update`, `orders/create`,
//   `orders/fulfilled` para mantener la tabla `Product` espejada con
//   `fuenteSincronizacion='shopify'`.
// - GraphQL IDs: los SKUs se mapean al barcode o al SKU del primer variant.
//
// Esta implementación stub lee/escribe sobre `Product` y `Order` con
// `fuenteSincronizacion='shopify'`, garantizando que el demo funcione
// end-to-end sin credenciales Shopify reales.

import { db } from '@/lib/db'
import type { EcommerceAdapter, ProductSearchResult } from './ecommerce-adapter'

export class ShopifyAdapter implements EcommerceAdapter {
  constructor(
    private readonly tenantId: string,
    /** Shopify Admin API access token (X-Shopify-Access-Token). Placeholder. */
    private readonly accessToken: string = '',
    /** Shop domain, e.g. "tienda.myshopify.com". */
    private readonly shopDomain: string = '',
  ) {}

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const q = query?.trim().toLowerCase() || ''
    const categoria = (filtros?.categoria as string | undefined)?.toLowerCase()

    const products = await db.product.findMany({
      where: {
        tenantId: this.tenantId,
        fuenteSincronizacion: 'shopify',
        ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } : {}),
        ...(categoria ? { categoria: { contains: categoria } } : {}),
      },
      take: 50,
      orderBy: { name: 'asc' },
    })
    return products.map(p => this.toResult(p))
  }

  async obtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'shopify' },
    })
    return p ? this.toResult(p) : null
  }

  async crearPedido(datos: {
    contacto_id: string
    items: { sku: string; cantidad: number }[]
    valor: number
    direccion: Record<string, string>
    imagen_referencia_url?: string
  }): Promise<{ order_id: string; estado: string; url_seguimiento?: string }> {
    const orderNumber = `SH-${Date.now().toString(36).toUpperCase()}`
    const order = await db.order.create({
      data: {
        tenantId: this.tenantId,
        number: orderNumber,
        customerId: datos.contacto_id,
        status: 'new',
        paymentMode: 'advance',
        paymentStatus: 'unpaid',
        subtotal: datos.valor,
        total: datos.valor,
        currency: 'COP',
        country: datos.direccion.pais ?? null,
        city: datos.direccion.ciudad ?? null,
        address: datos.direccion.direccion ?? null,
        imagenReferenciaUrl: datos.imagen_referencia_url ?? null,
        origen: 'agente_whatsapp',
      },
    })

    const products = await db.product.findMany({
      where: { tenantId: this.tenantId, sku: { in: datos.items.map(i => i.sku) } },
    })
    const itemsData = datos.items.map(i => {
      const prod = products.find(p => p.sku === i.sku)
      return {
        orderId: order.id,
        productId: prod?.id ?? 'unknown',
        name: prod?.name ?? i.sku,
        unitPrice: prod?.price ?? 0,
        cost: prod?.cost ?? 0,
        quantity: i.cantidad,
        diseno: prod?.diseno ?? null,
      }
    }).filter(it => it.productId !== 'unknown')
    if (itemsData.length > 0) {
      await db.orderItem.createMany({ data: itemsData })
    }

    await db.orderEvent.create({
      data: { orderId: order.id, type: 'created', note: 'Pedido creado vía Shopify adapter' },
    })

    return { order_id: order.id, estado: order.status }
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<{ ok: boolean; stock_actual: number }> {
    const updated = await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'shopify' },
      data: { stock: cantidad },
    })
    if (updated.count === 0) return { ok: false, stock_actual: 0 }
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'shopify' },
      select: { stock: true },
    })
    return { ok: true, stock_actual: p?.stock ?? cantidad }
  }

  async obtenerEstadoPedido(order_id: string): Promise<{ estado: string; fecha_actualizacion: string }> {
    const order = await db.order.findFirst({
      where: { tenantId: this.tenantId, id: order_id },
      select: { status: true, updatedAt: true },
    })
    if (!order) {
      return { estado: 'no_encontrado', fecha_actualizacion: new Date().toISOString() }
    }
    return { estado: order.status, fecha_actualizacion: order.updatedAt.toISOString() }
  }

  private toResult(p: {
    sku: string; name: string; price: number; imageUrl: string | null
    stock: number; diseno: string | null; categoria: string | null
  }): ProductSearchResult {
    return {
      sku: p.sku,
      name: p.name,
      precio: p.price,
      imagen_url: p.imageUrl ?? '',
      stock: p.stock,
      diseno: p.diseno ?? undefined,
      categoria: p.categoria ?? undefined,
    }
  }
}
