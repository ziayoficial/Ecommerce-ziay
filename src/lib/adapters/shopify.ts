// ─────────────────────────────────────────────────────────────────────────────
// ShopifyAdapter — catálogo Shopify del cliente (Saramantha §8.3, §9.3)
// ─────────────────────────────────────────────────────────────────────────────
//
// IMPLEMENTED (real HTTP integration via Shopify Admin REST API 2024-10):
// - Base URL: `https://{shop_domain}/admin/api/2024-10/{products,orders}.json`.
// - Auth: Custom App access token vía header `X-Shopify-Access-Token`.
//   Creds desde `process.env.SHOPIFY_ACCESS_TOKEN` y `SHOPIFY_SHOP_DOMAIN`.
// - Endpoints clave:
//   · GET  /products.json?title={q}            → buscarProductos
//   · GET  /products.json?variant_sku={sku}    → obtenerProducto
//   · POST /orders.json                         → crearPedido
//   · POST /inventory_levels/adjust.json        → actualizarInventario
//   · GET  /orders/{id}.json                    → obtenerEstadoPedido
// - Mapeo de estado Shopify → estado interno:
//   PENDING → pending_payment, PAID → paid, PROCESSING → preparing,
//   FULFILLED → shipped, DELIVERED → delivered, CANCELLED → cancelled.
// - Timeout: 10s por request (AbortController).
// - Graceful fallback: si no hay creds configurados O la llamada HTTP falla,
//   se usa el espejo local (`Product`/`Order` con fuenteSincronizacion=
//   'shopify') — nunca se crashea el agente.
// - TODO (futuro): migrar a GraphQL Admin API para reducir round-trips;
//   cachear listado 60s; suscribir webhooks `products/update`+`orders/create`.

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { EcommerceAdapter, ProductSearchResult, CrearPedidoInput, CrearPedidoResult, ActualizarInventarioResult, EstadoPedidoResult } from './ecommerce-adapter'

const HTTP_TIMEOUT_MS = 10_000
const SHOPIFY_API_VERSION = '2024-10'

interface ShopifyVariant {
  id: number
  sku: string
  price: string
  inventory_quantity: number | null
  inventory_item_id?: number
}

interface ShopifyProduct {
  id: number
  title: string
  variants: ShopifyVariant[]
  images?: { src: string }[]
  product_type?: string
  // Metafields no vienen en /products.json por defecto; se omite diseno aquí.
}

interface ShopifyOrder {
  id: number
  order_number?: number
  name?: string // e.g. "#1001"
  financial_status?: string
  fulfillment_status?: string | null
  canceled_at?: string | null
  updated_at?: string
  processed_at?: string
  created_at?: string
}

/** Mapea estado Shopify → estado interno ZIAY. */
function mapShopifyStatus(o: ShopifyOrder): string {
  if (o.canceled_at) return 'cancelled'
  if (o.fulfillment_status === 'fulfilled') return 'shipped'
  if (o.fulfillment_status === 'delivered') return 'delivered'
  switch (o.financial_status) {
    case 'pending': return 'pending_payment'
    case 'paid': return 'paid'
    case 'partially_paid': return 'paid'
    case 'refunded': return 'refunded'
    case 'voided': return 'cancelled'
    default: return 'new'
  }
}

export class ShopifyAdapter implements EcommerceAdapter {
  private readonly accessToken: string
  private readonly shopDomain: string

  constructor(
    private readonly tenantId: string,
    /** Shopify Admin API access token (X-Shopify-Access-Token). Si vacío, lee de process.env.SHOPIFY_ACCESS_TOKEN. */
    accessToken: string = '',
    /** Shop domain, e.g. "tienda.myshopify.com". Si vacío, lee de process.env.SHOPIFY_SHOP_DOMAIN. */
    shopDomain: string = '',
  ) {
    this.accessToken = accessToken || process.env.SHOPIFY_ACCESS_TOKEN || ''
    this.shopDomain = (shopDomain || process.env.SHOPIFY_SHOP_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  }

  private hasCreds(): boolean {
    return !!(this.accessToken && this.shopDomain)
  }

  /** fetch con timeout AbortController. */
  private async http<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const url = `https://${this.shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        logger.warn({ tenantId: this.tenantId, url, status: res.status, text: text.slice(0, 300) }, 'Shopify API non-2xx — fallback to local DB')
        return null
      }
      // 204 No Content
      if (res.status === 204) return {} as T
      return (await res.json()) as T
    } catch (err) {
      logger.warn({ tenantId: this.tenantId, url, err: err instanceof Error ? err.message : String(err) }, 'Shopify API call failed — fallback to local DB')
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const categoria = (filtros?.categoria as string | undefined)?.toLowerCase()
    if (!this.hasCreds()) return this.localBuscarProductos(query, categoria)

    const q = (query ?? '').trim()
    const path = `/products.json?limit=50${q ? `&title=${encodeURIComponent(q)}` : ''}`
    const data = await this.http<{ products: ShopifyProduct[] }>('GET', path)
    if (!data?.products) return this.localBuscarProductos(query, categoria)

    // Shopify devuelve variants[] por producto. Aplanamos a un ProductSearchResult
    // por variant con SKU (si existe) o por producto sin variant con SKU.
    const results: ProductSearchResult[] = []
    for (const p of data.products) {
      const variants = p.variants?.length ? p.variants : []
      if (variants.length === 0) continue
      for (const v of variants) {
        if (!v.sku) continue
        results.push(this.variantToResult(p, v))
      }
    }
    if (categoria) {
      return results.filter(r => (r.categoria ?? '').toLowerCase().includes(categoria))
    }
    return results
  }

  async obtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    if (!this.hasCreds()) return this.localObtenerProducto(sku)
    if (!sku) return null

    const path = `/products.json?limit=250&variant_sku=${encodeURIComponent(sku)}`
    const data = await this.http<{ products: ShopifyProduct[] }>('GET', path)
    if (!data?.products) return this.localObtenerProducto(sku)

    for (const p of data.products) {
      const v = (p.variants ?? []).find(it => it.sku === sku)
      if (v) return this.variantToResult(p, v)
    }
    return null
  }

  async crearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult> {
    if (!this.hasCreds()) return this.localCrearPedido(datos)

    // Shopify prefiere variant_id numérico, pero si no lo tenemos (espejo local
    // solo guarda SKU), usamos custom line_items con title+price. Shopify crea
    // la orden igualmente, solo que sin afectar inventario automático.
    const products = await db.product.findMany({
      where: { tenantId: this.tenantId, sku: { in: datos.items.map(i => i.sku) } },
    })

    const lineItems = datos.items.map(i => {
      const prod = products.find(p => p.sku === i.sku)
      return {
        title: prod?.name ?? i.sku,
        quantity: i.cantidad,
        price: prod ? String(prod.price) : '0.00',
        requires_shipping: true,
      }
    })

    const payload: Record<string, unknown> = {
      order: {
        line_items: lineItems,
        financial_status: 'pending',
        inventory_behaviour: 'decrement_ignoring_policy',
        shipping_address: {
          first_name: datos.direccion.nombre ?? 'Cliente',
          last_name: datos.direccion.apellido ?? '',
          address1: datos.direccion.direccion ?? '',
          city: datos.direccion.ciudad ?? '',
          country: datos.direccion.pais ?? 'CO',
          phone: datos.direccion.telefono ?? '',
        },
        tags: 'ziay_agent',
      },
    }

    const data = await this.http<{ order: ShopifyOrder }>('POST', '/orders.json', payload)
    if (!data?.order) return this.localCrearPedido(datos)

    // Persistir espejo local con el order_id_externo (Shopify id).
    // Wrap order + items + event en una sola tx: si orderItem u orderEvent fallan,
    // el order.create se revierte y no queda un pedido huérfano sin items/event.
    return await db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          tenantId: this.tenantId,
          number: `SH-${data.order.id}`,
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
      if (itemsNonEmpty(products, datos.items)) {
        await tx.orderItem.createMany({ data: buildItemsData(order.id, products, datos.items) })
      }
      await tx.orderEvent.create({
        data: { orderId: order.id, type: 'created', note: `Pedido Shopify #${data.order.id} creado vía HTTP` },
      })

      return { order_id: order.id, estado: mapShopifyStatus(data.order) }
    })
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
    if (!this.hasCreds()) return this.localActualizarInventario(sku, cantidad)

    // Shopify requiere `inventory_item_id` + `location_id` para ajustar stock.
    // 1) GET /products.json?variant_sku={sku} para obtener el variant.
    // 2) POST /inventory_levels/adjust.json con { inventory_item_id, available_adjustment, location_id }.
    const lookup = await this.http<{ products: ShopifyProduct[] }>('GET', `/products.json?limit=250&variant_sku=${encodeURIComponent(sku)}`)
    let variant: ShopifyVariant | undefined
    for (const p of lookup?.products ?? []) {
      const v = (p.variants ?? []).find(it => it.sku === sku)
      if (v) { variant = v; break }
    }
    if (!variant?.inventory_item_id) return this.localActualizarInventario(sku, cantidad)

    // El delta = cantidad - stock_actual. Shopify no soporta "set", solo "adjust".
    const current = variant.inventory_quantity ?? 0
    const delta = cantidad - current
    if (delta === 0) return { ok: true, stock_actual: cantidad }

    const adjusted = await this.http<{ inventory_level?: { available: number } }>('POST', '/inventory_levels/adjust.json', {
      inventory_item_id: variant.inventory_item_id,
      available_adjustment: delta,
      // location_id sería provisto por el tenant en prod; sin él Shopify falla.
      // Como fallback, si la API responde 422 igual actualizamos el espejo local.
      location_id: Number(process.env.SHOPIFY_LOCATION_ID) || undefined,
    })
    if (!adjusted) return this.localActualizarInventario(sku, cantidad)

    await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'shopify' },
      data: { stock: cantidad },
    }).catch(() => {})

    return { ok: true, stock_actual: cantidad }
  }

  async obtenerEstadoPedido(order_id: string): Promise<EstadoPedidoResult> {
    if (!this.hasCreds()) return this.localObtenerEstadoPedido(order_id)

    const local = await db.order.findFirst({
      where: { tenantId: this.tenantId, id: order_id },
      select: { number: true, status: true, updatedAt: true },
    })
    const shIdMatch = local?.number?.match(/^SH-(\d+)$/)
    const shId = shIdMatch?.[1] ?? (/^\d+$/.test(order_id) ? order_id : null)

    if (shId) {
      const data = await this.http<{ order: ShopifyOrder }>('GET', `/orders/${shId}.json`)
      if (data?.order) {
        return {
          estado: mapShopifyStatus(data.order),
          fecha_actualizacion: data.order.updated_at ?? data.order.processed_at ?? new Date().toISOString(),
        }
      }
    }
    return this.localObtenerEstadoPedido(order_id)
  }

  // ───────────────────────────────────────────────────────────────────────
  // Fallback local (mismo comportamiento que el stub original)
  // ───────────────────────────────────────────────────────────────────────

  private async localBuscarProductos(query: string, categoria?: string): Promise<ProductSearchResult[]> {
    const q = (query ?? '').trim().toLowerCase()
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
    return products.map(p => this.toResultFromDb(p))
  }

  private async localObtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'shopify' },
    })
    return p ? this.toResultFromDb(p) : null
  }

  private async localCrearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult> {
    const orderNumber = `SH-${Date.now().toString(36).toUpperCase()}`
    // Lookup de productos fuera del tx (read-only); el resto va en una sola tx.
    const products = await db.product.findMany({
      where: { tenantId: this.tenantId, sku: { in: datos.items.map(i => i.sku) } },
    })
    return await db.$transaction(async (tx) => {
      const order = await tx.order.create({
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
      if (itemsNonEmpty(products, datos.items)) {
        await tx.orderItem.createMany({ data: buildItemsData(order.id, products, datos.items) })
      }
      await tx.orderEvent.create({
        data: { orderId: order.id, type: 'created', note: 'Pedido creado vía Shopify adapter (fallback local)' },
      })
      return { order_id: order.id, estado: order.status }
    })
  }

  private async localActualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
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

  private async localObtenerEstadoPedido(order_id: string): Promise<EstadoPedidoResult> {
    const order = await db.order.findFirst({
      where: { tenantId: this.tenantId, id: order_id },
      select: { status: true, updatedAt: true },
    })
    if (!order) return { estado: 'no_encontrado', fecha_actualizacion: new Date().toISOString() }
    return { estado: order.status, fecha_actualizacion: order.updatedAt.toISOString() }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mappers
  // ───────────────────────────────────────────────────────────────────────

  private variantToResult(p: ShopifyProduct, v: ShopifyVariant): ProductSearchResult {
    return {
      sku: v.sku,
      name: p.title,
      precio: Number(v.price) || 0,
      imagen_url: p.images?.[0]?.src ?? '',
      stock: v.inventory_quantity ?? 0,
      categoria: p.product_type,
    }
  }

  private toResultFromDb(p: {
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

function itemsNonEmpty(
  products: { id: string; sku: string }[],
  items: { sku: string; cantidad: number }[],
): boolean {
  return items.some(i => products.some(p => p.sku === i.sku))
}

function buildItemsData(
  orderId: string,
  products: { id: string; sku: string; name: string; price: number; cost: number | null; diseno: string | null }[],
  items: { sku: string; cantidad: number }[],
) {
  return items.map(i => {
    const prod = products.find(p => p.sku === i.sku)
    return {
      orderId,
      productId: prod?.id ?? 'unknown',
      name: prod?.name ?? i.sku,
      unitPrice: prod?.price ?? 0,
      cost: prod?.cost ?? 0,
      quantity: i.cantidad,
      diseno: prod?.diseno ?? null,
    }
  }).filter(it => it.productId !== 'unknown')
}
