// ─────────────────────────────────────────────────────────────────────────────
// WooCommerceAdapter — catálogo WooCommerce del cliente (Saramantha §8.3, §9.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO (real integration):
// - Base URL: `https://{tienda}.com/wp-json/wc/v3/{products,orders}`.
// - Auth: OAuth 1.0a (REST API Keys) — `consumer_key` + `consumer_secret` en
//   query string. Para tiendas sobre HTTPS también sirve Basic Auth con las
//   mismas creds. Guardar en `Tenant.credencialesCatalogoRef` (n8n/secret mgr).
// - Endpoints clave:
//   · GET  /products?search={q}&per_page=50            → buscarProductos
//   · GET  /products/{id}                              → obtenerProducto
//   · POST /orders                                     → crearPedido
//   · PUT  /products/{id} body { stock_quantity: n }   → actualizarInventario
//   · GET  /orders/{id}                                → obtenerEstadoPedido
// - Mapeo de estado WC → estado interno:
//   pending → pending_payment, processing → paid, on-hold → cod_pending,
//   completed → delivered, cancelled → cancelled, refunded → refunded.
// - Rate limits: WC no documentados, pero la mayoría de hosts limitan a
//   ~600 req/min. Cachear listado de productos 60s.
// - Webhooks: suscribir a `product.updated` y `order.created` para mantener
//   la tabla `Product` espejada con `fuenteSincronizacion='woocommerce'`.
// - Paginación: usar `page` + `per_page=100` y el header `X-WP-TotalPages`.
//
// Esta implementación stub lee/escribe sobre `Product` y `Order` con
// `fuenteSincronizacion='woocommerce'`, garantizando que el demo funcione
// end-to-end sin credenciales WC reales.

import { db } from '@/lib/db'
import type { EcommerceAdapter, ProductSearchResult } from './ecommerce-adapter'

export class WooCommerceAdapter implements EcommerceAdapter {
  constructor(
    private readonly tenantId: string,
    /** WC REST API consumer key. Placeholder — producción la carga desde secret manager. */
    private readonly consumerKey: string = '',
    /** WC REST API consumer secret. Placeholder — producción la carga desde secret manager. */
    private readonly consumerSecret: string = '',
    /** Store base URL, e.g. "https://tienda.com". */
    private readonly storeUrl: string = '',
  ) {}

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const q = query?.trim().toLowerCase() || ''
    const categoria = (filtros?.categoria as string | undefined)?.toLowerCase()

    // Stub: lee del espejo local. En producción, reemplazar por `GET /products?search=`.
    const products = await db.product.findMany({
      where: {
        tenantId: this.tenantId,
        fuenteSincronizacion: 'woocommerce',
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
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'woocommerce' },
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
    // Stub: crea la orden en el núcleo. En producción, además POST /orders a WC
    // con `payment_method`, `billing`, `shipping`, `line_items` y guardar el
    // `order_id_externo` en `Order.number` (o columna dedicada).
    const orderNumber = `WC-${Date.now().toString(36).toUpperCase()}`
    const order = await db.order.create({
      data: {
        tenantId: this.tenantId,
        number: orderNumber,
        customerId: datos.contacto_id,
        status: 'new',
        paymentMode: 'hybrid',
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
      data: { orderId: order.id, type: 'created', note: 'Pedido creado vía WooCommerce adapter' },
    })

    return { order_id: order.id, estado: order.status }
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<{ ok: boolean; stock_actual: number }> {
    const updated = await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'woocommerce' },
      data: { stock: cantidad },
    })
    if (updated.count === 0) return { ok: false, stock_actual: 0 }
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'woocommerce' },
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
