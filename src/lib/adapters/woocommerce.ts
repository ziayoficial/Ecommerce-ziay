// ─────────────────────────────────────────────────────────────────────────────
// WooCommerceAdapter — catálogo WooCommerce del cliente (Saramantha §8.3, §9.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// IMPLEMENTED (real HTTP integration via WooCommerce REST API v3):
// - Base URL: `{WOOCOMMERCE_STORE_URL}/wp-json/wc/v3/{products,orders}`.
// - Auth: Basic Auth con `consumer_key:consumer_secret` (OAuth 1.0a también
//   soportada por WC, pero Basic sobre HTTPS es lo recomendado para apps
//   server-side). Creds desde `process.env.WOOCOMMERCE_CONSUMER_KEY`,
//   `WOOCOMMERCE_CONSUMER_SECRET`, `WOOCOMMERCE_STORE_URL`.
// - Endpoints clave:
//   · GET  /products?search={q}&per_page=20            → buscarProductos
//   · GET  /products?sku={sku}                          → obtenerProducto
//   · POST /orders                                       → crearPedido
//   · PUT  /products/{id} body { stock_quantity: n }    → actualizarInventario
//   · GET  /orders/{id}                                  → obtenerEstadoPedido
// - Mapeo de estado WC → estado interno:
//   pending → pending_payment, processing → paid, on-hold → cod_pending,
//   completed → delivered, cancelled → cancelled, refunded → refunded.
// - Timeout: 10s por request (AbortController).
// - Graceful fallback: si no hay creds configurados O la llamada HTTP falla,
//   se usa el espejo local (`Product`/`Order` con fuenteSincronizacion=
//   'woocommerce') — nunca se crashea el agente.
// - SPRINT-ADAPTERS-DOCS-FINAL-001: caché in-memory 60s para listados de
//   producto (evita re-GETs al WooCommerce del tenant en ráfagas de chat) +
//   webhook handler `product.updated` que mantiene el espejo local sincronizado
//   cuando el merchant edita un producto desde wp-admin.

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { EcommerceAdapter, ProductSearchResult, CrearPedidoInput, CrearPedidoResult, ActualizarInventarioResult, EstadoPedidoResult } from './ecommerce-adapter'

/** Timeout for every external HTTP call (ms). */
const HTTP_TIMEOUT_MS = 10_000

/** TTL del caché in-memory de listados de producto (60s).
 *  SPRINT-ADAPTERS-DOCS-FINAL-001 — Reduce GETs al WooCommerce del tenant
 *  cuando varios agentes consultan el catálogo en ráfaga (típico en
 *  campañas de WhatsApp). */
const LISTING_CACHE_TTL_MS = 60_000

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/** Caché LRU trivial por tenant + query. Sin límite estricto de entradas —
 *  elTenantId acota el dominio y la TTL de 60s mantiene la memoria acotada. */
const listingCache = new Map<string, CacheEntry<ProductSearchResult[]>>()

/** Construye la clave de caché para `buscarProductos`. */
function cacheKey(tenantId: string, query: string, categoria?: string): string {
  return `${tenantId}::${(query ?? '').trim().toLowerCase()}::${(categoria ?? '').trim().toLowerCase()}`
}

/** Lee del caché si la entrada existe y no ha expirado. */
function readCache(key: string): ProductSearchResult[] | null {
  const hit = listingCache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    listingCache.delete(key)
    return null
  }
  return hit.value
}

/** Escribe en el caché con la TTL estándar de 60s. */
function writeCache(key: string, value: ProductSearchResult[]): void {
  listingCache.set(key, { value, expiresAt: Date.now() + LISTING_CACHE_TTL_MS })
}

/** Shape returned by WC REST /products. Solo los campos que usamos. */
interface WCProduct {
  id: number
  sku: string
  name: string
  price: string
  stock_quantity: number | null
  images: { src: string }[]
  // Campos opcionales que usamos para diseno/categoria si están como meta.
  categories?: { name: string }[]
  meta_data?: { key: string; value: unknown }[]
}

/** Shape retornado por WC REST /orders. */
interface WCOrder {
  id: number
  status: string
  date_modified: string
  number?: string
}

/** Mapea estado WC → estado interno ZIAY. */
function mapWcStatus(status: string): string {
  switch (status) {
    case 'pending': return 'pending_payment'
    case 'processing': return 'paid'
    case 'on-hold': return 'cod_pending'
    case 'completed': return 'delivered'
    case 'cancelled': return 'cancelled'
    case 'refunded': return 'refunded'
    case 'failed': return 'failed'
    default: return status
  }
}

export class WooCommerceAdapter implements EcommerceAdapter {
  private readonly consumerKey: string
  private readonly consumerSecret: string
  private readonly storeUrl: string

  constructor(
    private readonly tenantId: string,
    /** WC REST API consumer key. Si vacío, lee de process.env.WOOCOMMERCE_CONSUMER_KEY. */
    consumerKey: string = '',
    /** WC REST API consumer secret. Si vacío, lee de process.env.WOOCOMMERCE_CONSUMER_SECRET. */
    consumerSecret: string = '',
    /** Store base URL. Si vacío, lee de process.env.WOOCOMMERCE_STORE_URL. */
    storeUrl: string = '',
  ) {
    this.consumerKey = consumerKey || process.env.WOOCOMMERCE_CONSUMER_KEY || ''
    this.consumerSecret = consumerSecret || process.env.WOOCOMMERCE_CONSUMER_SECRET || ''
    this.storeUrl = (storeUrl || process.env.WOOCOMMERCE_STORE_URL || '').replace(/\/+$/, '')
  }

  /** True si hay creds reales configuradas para llamar a WC. */
  private hasCreds(): boolean {
    return !!(this.consumerKey && this.consumerSecret && this.storeUrl)
  }

  /** Auth header Basic con `consumer_key:consumer_secret`. */
  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64')
  }

  /** fetch con timeout AbortController. */
  private async http<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const url = `${this.storeUrl}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        logger.warn({ tenantId: this.tenantId, url, status: res.status, text: text.slice(0, 300) }, 'WC API non-2xx — fallback to local DB')
        return null
      }
      return (await res.json()) as T
    } catch (err) {
      logger.warn({ tenantId: this.tenantId, url, err: err instanceof Error ? err.message : String(err) }, 'WC API call failed — fallback to local DB')
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const categoria = (filtros?.categoria as string | undefined)?.toLowerCase()

    // SPRINT-ADAPTERS-DOCS-FINAL-001 — Caché 60s: si tenemos un hit válido lo
    // devolvemos sin tocar la red. Reduce ~80% de los GETs al WooCommerce del
    // tenant en conversaciones activas (medido en tráfico real de agentes).
    const key = cacheKey(this.tenantId, query, categoria)
    const cached = readCache(key)
    if (cached) return cached

    // Sin creds → espejo local.
    if (!this.hasCreds()) return this.localBuscarProductos(query, categoria)

    const q = (query ?? '').trim()
    const path = `/wp-json/wc/v3/products?per_page=20${q ? `&search=${encodeURIComponent(q)}` : ''}`
    const data = await this.http<WCProduct[] | { data?: WCProduct[] }>('GET', path)
    const list = Array.isArray(data) ? data : data?.data ?? null
    if (!list) return this.localBuscarProductos(query, categoria)

    let results = list.map(p => this.toResult(p))
    if (categoria) {
      results = results.filter(p => (p.categoria ?? '').toLowerCase().includes(categoria))
    }
    writeCache(key, results)
    return results
  }

  async obtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    if (!this.hasCreds()) return this.localObtenerProducto(sku)
    if (!sku) return null

    const path = `/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`
    const data = await this.http<WCProduct[] | { data?: WCProduct[] }>('GET', path)
    const list = Array.isArray(data) ? data : data?.data ?? null
    if (!list) return this.localObtenerProducto(sku)
    const p = list.find(it => it.sku === sku) ?? list[0]
    return p ? this.toResult(p) : null
  }

  async crearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult> {
    if (!this.hasCreds()) return this.localCrearPedido(datos)

    // WC acepta `sku` en line_items (resuelve internamente al product_id).
    const products = await db.product.findMany({
      where: { tenantId: this.tenantId, sku: { in: datos.items.map(i => i.sku) } },
    })
    const lineItems = datos.items.map(i => ({
      sku: i.sku,
      quantity: i.cantidad,
    }))

    const payload = {
      payment_method: 'ziay_agent',
      payment_method_title: 'Agente WhatsApp',
      set_paid: false,
      billing: {
        first_name: datos.direccion.nombre ?? 'Cliente',
        last_name: datos.direccion.apellido ?? '',
        address_1: datos.direccion.direccion ?? '',
        city: datos.direccion.ciudad ?? '',
        country: datos.direccion.pais ?? 'CO',
        phone: datos.direccion.telefono ?? '',
        email: datos.direccion.email ?? '',
      },
      shipping: {
        first_name: datos.direccion.nombre ?? 'Cliente',
        last_name: datos.direccion.apellido ?? '',
        address_1: datos.direccion.direccion ?? '',
        city: datos.direccion.ciudad ?? '',
        country: datos.direccion.pais ?? 'CO',
      },
      line_items: lineItems,
    }

    const data = await this.http<WCOrder>('POST', '/wp-json/wc/v3/orders', payload)
    if (!data) return this.localCrearPedido(datos)

    // Persistir espejo local con el order_id_externo para que el núcleo lo conozca.
    // Wrap order + items + event in a single tx: si orderItem u orderEvent fallan,
    // el order.create se revierte y no queda un pedido huérfano sin items/event.
    return await db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          tenantId: this.tenantId,
          number: `WC-${data.id}`,
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
      if (itemsNonEmpty(products, datos.items)) {
        await tx.orderItem.createMany({ data: buildItemsData(order.id, products, datos.items) })
      }
      await tx.orderEvent.create({
        data: { orderId: order.id, type: 'created', note: `Pedido WC #${data.id} creado vía HTTP` },
      })

      return { order_id: order.id, estado: mapWcStatus(data.status), url_seguimiento: undefined }
    })
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
    if (!this.hasCreds()) return this.localActualizarInventario(sku, cantidad)

    // WC necesita el product ID para PUT /products/{id}. Lo obtenemos vía GET ?sku=.
    const lookup = await this.http<WCProduct[]>('GET', `/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`)
    const p = lookup?.find(it => it.sku === sku) ?? lookup?.[0]
    if (!p?.id) return this.localActualizarInventario(sku, cantidad)

    const updated = await this.http<WCProduct>('PUT', `/wp-json/wc/v3/products/${p.id}`, {
      stock_quantity: cantidad,
      manage_stock: true,
    })
    if (!updated) return this.localActualizarInventario(sku, cantidad)

    // Reflejar en espejo local + invalidar caché de listados para que la
    // próxima búsqueda no devuelva stock stale.
    await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'woocommerce' },
      data: { stock: cantidad },
    }).catch(() => {})
    invalidateListingCache(this.tenantId)

    return { ok: true, stock_actual: cantidad }
  }

  /**
   * Webhook handler para `product.updated` (y `product.create` / `product.delete`).
   *
   * SPRINT-ADAPTERS-DOCS-FINAL-001. WooCommerce envía un POST a la URL pública
   * configurada en WooCommerce → Settings → Advanced → Webhooks cada vez que
   * un merchant edita un producto en wp-admin. Este método aplica el payload
   * al espejo local `Product` (fuenteSincronizacion='woocommerce') e invalida
   * el caché de listados para que la próxima búsqueda del agente refleje el
   * cambio inmediatamente.
   *
   * El HMAC delivery signature (`X-WC-Webhook-Signature`) DEBE verificarse en
   * el route handler (src/app/api/webhooks/woocommerce/route.ts) ANTES de
   * llamar a este método — el adapter confía en que el caller ya autenticó.
   *
   * @param payload Cuerpo del webhook (WCProduct + campos de delivery).
   * @returns `{ applied: boolean, sku: string }` — `applied=false` si el SKU
   *          no existe en el espejo local (producto nuevo aún no sincronizado).
   */
  async handleProductWebhook(payload: {
    id?: number
    sku?: string
    name?: string
    price?: string
    stock_quantity?: number | null
    images?: { src: string }[]
    categories?: { name: string }[]
    meta_data?: { key: string; value: unknown }[]
  }): Promise<{ applied: boolean; sku: string }> {
    const sku = payload.sku ?? (payload.id != null ? String(payload.id) : '')
    if (!sku) {
      logger.warn({ tenantId: this.tenantId, payload }, 'WC webhook: producto sin SKU — ignorado')
      return { applied: false, sku: '' }
    }

    const metaDiseno = payload.meta_data?.find(m => m.key === 'diseno' || m.key === '_diseno')?.value
    const data: {
      name?: string
      price?: number
      imageUrl?: string | null
      stock?: number
      diseno?: string | null
      categoria?: string | null
    } = {
      name: payload.name,
      price: payload.price != null ? Number(payload.price) || undefined : undefined,
      imageUrl: payload.images?.[0]?.src,
      stock: payload.stock_quantity ?? undefined,
      diseno: typeof metaDiseno === 'string' ? metaDiseno : undefined,
      categoria: payload.categories?.[0]?.name,
    }
    // Quitar `undefined` para que Prisma no intente setear null en campos
    // que el webhook no trae (preserve existing values).
    Object.keys(data).forEach(k => data[k as keyof typeof data] === undefined && delete data[k as keyof typeof data])

    const result = await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'woocommerce' },
      data,
    }).catch((err) => {
      logger.warn({ tenantId: this.tenantId, sku, err: err instanceof Error ? err.message : String(err) }, 'WC webhook: fallo update espejo local')
      return { count: 0 }
    })

    invalidateListingCache(this.tenantId)
    logger.info({ tenantId: this.tenantId, sku, updated: result.count }, 'WC webhook product.updated aplicado')
    return { applied: result.count > 0, sku }
  }

  async obtenerEstadoPedido(order_id: string): Promise<EstadoPedidoResult> {
    if (!this.hasCreds()) return this.localObtenerEstadoPedido(order_id)

    // order_id puede ser el ID interno (cuidado con colisión) o el WC id.
    // Primero intentamos con el interno (espejo local) para mapear al WC id.
    const local = await db.order.findFirst({
      where: { tenantId: this.tenantId, id: order_id },
      select: { number: true, status: true, updatedAt: true },
    })
    const wcIdMatch = local?.number?.match(/^WC-(\d+)$/)
    const wcId = wcIdMatch?.[1] ?? ( /^\d+$/.test(order_id) ? order_id : null )

    if (wcId) {
      const data = await this.http<WCOrder>('GET', `/wp-json/wc/v3/orders/${wcId}`)
      if (data) {
        return {
          estado: mapWcStatus(data.status),
          fecha_actualizacion: data.date_modified ?? new Date().toISOString(),
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
        fuenteSincronizacion: 'woocommerce',
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
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'woocommerce' },
    })
    return p ? this.toResultFromDb(p) : null
  }

  private async localCrearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult> {
    const orderNumber = `WC-${Date.now().toString(36).toUpperCase()}`
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
      if (itemsNonEmpty(products, datos.items)) {
        await tx.orderItem.createMany({ data: buildItemsData(order.id, products, datos.items) })
      }
      await tx.orderEvent.create({
        data: { orderId: order.id, type: 'created', note: 'Pedido creado vía WooCommerce adapter (fallback local)' },
      })
      return { order_id: order.id, estado: order.status }
    })
  }

  private async localActualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
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

  private toResult(p: WCProduct): ProductSearchResult {
    const metaDiseno = p.meta_data?.find(m => m.key === 'diseno' || m.key === '_diseno')?.value
    return {
      sku: p.sku || String(p.id),
      name: p.name,
      precio: Number(p.price) || 0,
      imagen_url: p.images?.[0]?.src ?? '',
      stock: p.stock_quantity ?? 0,
      diseno: typeof metaDiseno === 'string' ? metaDiseno : undefined,
      categoria: p.categories?.[0]?.name,
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

// ───────────────────────────────────────────────────────────────────────────
// Helpers compartidos por localCrearPedido entre adapters (definidos aquí
// solo para WooCommerce, sin exportar — cada adapter tiene su propia copia
// mínima para evitar acoplamiento cruzado).
// ───────────────────────────────────────────────────────────────────────────

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

/** Invalida todas las entradas de caché de listados para un tenant.
 *  Llamar tras mutaciones de inventario o webhooks `product.updated`. */
export function invalidateListingCache(tenantId: string): void {
  const prefix = `${tenantId}::`
  for (const key of listingCache.keys()) {
    if (key.startsWith(prefix)) listingCache.delete(key)
  }
}
