// ─────────────────────────────────────────────────────────────────────────────
// WhatsappCatalogAdapter — catálogo nativo de WhatsApp Business (Meta Commerce)
// Saramantha §8.2: "WhatsApp Catalog" como ruta de catálogo por tenant.
// ─────────────────────────────────────────────────────────────────────────────
//
// IMPLEMENTED (real HTTP integration via Meta WhatsApp Business / Commerce API):
// - Base URL: `https://graph.facebook.com/v18.0/{phoneNumberId}/whatsapp_product_catalog/products`
//   y `https://graph.facebook.com/v18.0/{catalogId}/products` para updates.
// - Auth: `Authorization: Bearer {api_token}`. Creds desde
//   `process.env.WHATSAPP_PHONE_NUMBER_ID`, `process.env.WHATSAPP_API_TOKEN`
//   y `process.env.WHATSAPP_CATALOG_ID`.
// - Endpoints:
//   · GET  /{phoneNumberId}/whatsapp_product_catalog/products?query={q}   → buscarProductos
//   · GET  /{phoneNumberId}/whatsapp_product_catalog/products?retailer_id={sku} → obtenerProducto
//   · POST /{catalogId}/products  body { retailer_id, inventory }         → actualizarInventario
//   · crearPedido: WA Catalog no expone endpoint "crear orden" → registramos
//     en el núcleo (Order table) y, si el tenant lo habilita, se envía un
//     `order_card` message type vía WhatsApp Cloud API en una capa posterior.
//   · obtenerEstadoPedido: WA Catalog no tiene orders → retorna el estado
//     del núcleo local (no null para no romper flujos que esperan un estado).
// - Timeout: 10s por request (AbortController).
// - Graceful fallback: si no hay creds configurados o la llamada HTTP falla,
//   se usa el espejo local (`Product`/`Order` con fuenteSincronizacion=
//   'whatsapp_catalog') — nunca se crashea el agente.
// - TODO (futuro): webhooks `catalog_update` para recibir cambios hechos desde
//   la app WA; enviar `order_card` message type al cliente tras crear la orden.

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { EcommerceAdapter, ProductSearchResult, CrearPedidoInput, CrearPedidoResult, ActualizarInventarioResult, EstadoPedidoResult } from './ecommerce-adapter'

const HTTP_TIMEOUT_MS = 10_000
const GRAPH_API_VERSION = 'v18.0'
const GRAPH_API_BASE =
  process.env.WHATSAPP_CATALOG_API_BASE ?? `https://graph.facebook.com/${GRAPH_API_VERSION}`

/** Item de catálogo Meta WhatsApp. */
interface WhatsAppCatalogItem {
  id?: string
  retailer_id?: string
  name?: string
  title?: string
  price?: number | string
  currency?: string
  image_url?: string
  inventory?: number
  availability?: string
  category?: string
  // Meta Commerce usa `custom_label_*` libremente — mapeamos diseno si está.
  custom_label_0?: string
  custom_label_1?: string
}

interface WhatsAppCatalogResponse {
  data?: WhatsAppCatalogItem[]
  error?: { message?: string; code?: number }
}

interface WhatsAppProductUpdateResponse {
  id?: string
  success?: boolean
  error?: { message?: string; code?: number }
}

export class WhatsappCatalogAdapter implements EcommerceAdapter {
  private readonly phoneNumberId: string
  private readonly apiToken: string
  private readonly catalogId: string

  constructor(private readonly tenantId: string) {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? ''
    this.apiToken = process.env.WHATSAPP_API_TOKEN ?? ''
    this.catalogId = process.env.WHATSAPP_CATALOG_ID ?? ''
  }

  private hasCreds(): boolean {
    return !!(this.phoneNumberId && this.apiToken)
  }

  /** fetch con timeout AbortController. */
  private async http<T>(method: string, url: string, body?: unknown): Promise<T | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        logger.warn({ tenantId: this.tenantId, url, status: res.status, text: text.slice(0, 300) }, 'WhatsApp Catalog API non-2xx — fallback to local DB')
        return null
      }
      if (res.status === 204) return {} as T
      return (await res.json()) as T
    } catch (err) {
      logger.warn({ tenantId: this.tenantId, url, err: err instanceof Error ? err.message : String(err) }, 'WhatsApp Catalog API call failed — fallback to local DB')
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const diseno = (filtros?.diseno as string | undefined)?.toLowerCase()
    const categoria = (filtros?.categoria as string | undefined)?.toLowerCase()

    if (!this.hasCreds()) return this.localBuscarProductos(query, diseno, categoria)

    const q = (query ?? '').trim()
    const params = new URLSearchParams()
    if (q) params.set('query', q)
    const url = `${GRAPH_API_BASE}/${this.phoneNumberId}/whatsapp_product_catalog/products${params.size ? `?${params.toString()}` : ''}`

    const data = await this.http<WhatsAppCatalogResponse>('GET', url)
    if (!data?.data) return this.localBuscarProductos(query, diseno, categoria)

    let results = data.data.map(p => this.toResult(p))
    if (diseno) results = results.filter(r => (r.diseno ?? '').toLowerCase().includes(diseno))
    if (categoria) results = results.filter(r => (r.categoria ?? '').toLowerCase().includes(categoria))
    return results
  }

  async obtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    if (!this.hasCreds()) return this.localObtenerProducto(sku)
    if (!sku) return null

    const url = `${GRAPH_API_BASE}/${this.phoneNumberId}/whatsapp_product_catalog/products?retailer_id=${encodeURIComponent(sku)}`
    const data = await this.http<WhatsAppCatalogResponse>('GET', url)
    if (!data?.data) return this.localObtenerProducto(sku)

    const p = data.data.find(it => it.retailer_id === sku) ?? data.data[0]
    return p ? this.toResult(p) : null
  }

  async crearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult> {
    // WA Catalog no expone un endpoint de creación de orden — registramos en el núcleo.
    // El envío del `order_card` al cliente se haría en una capa de mensajería posterior
    // (POST /{phoneNumberId}/messages con type=order).
    const orderNumber = `WA-${Date.now().toString(36).toUpperCase()}`
    // Lookup de productos fuera del tx (read-only); el resto va en una sola tx
    // para que order + items + event sean atómicos.
    const products = datos.items.length > 0
      ? await db.product.findMany({
          where: { tenantId: this.tenantId, sku: { in: datos.items.map(i => i.sku) } },
        })
      : []
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
          // SPRINT-WHATSAPP-FUNCTIONAL-001 — CTWA attribution inheritance.
          // When the agent creates an order from a WhatsApp conversation,
          // stamp the clickId captured by the WA webhook so the CAPI
          // Purchase event (auto-fired when paid) can close the loop.
          ...(datos.conversationId ? { conversationId: datos.conversationId } : {}),
          ...(datos.clickId ? { clickId: datos.clickId, attributedAt: new Date() } : {}),
          ...(datos.sourceAdId ? { sourceAdId: datos.sourceAdId } : {}),
          ...(datos.sourceCampaign ? { sourceCampaign: datos.sourceCampaign } : {}),
          ...(datos.sourcePlatform ? { sourcePlatform: datos.sourcePlatform } : {}),
        },
      })

      if (datos.items.length > 0) {
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
          await tx.orderItem.createMany({ data: itemsData })
        }
      }

      await tx.orderEvent.create({
        data: { orderId: order.id, type: 'created', note: 'Pedido creado vía WhatsApp Catalog adapter' },
      })

      return {
        order_id: order.id,
        estado: order.status,
        // El seguimiento real lo provee el LogisticsAdapter una vez generada la guía.
        url_seguimiento: undefined,
      }
    })
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
    // Sin creds o sin catalog_id → espejo local.
    if (!this.hasCreds() || !this.catalogId) return this.localActualizarInventario(sku, cantidad)

    // Meta Commerce API: POST /{catalog_id}/products con `retailer_id` + `inventory`.
    // (La API real usa un feed batch; para un solo update usamos el endpoint
    // simplificado que Meta expone para WhatsApp Business catalogs.)
    const url = `${GRAPH_API_BASE}/${this.catalogId}/products`
    const data = await this.http<WhatsAppProductUpdateResponse>('POST', url, {
      retailer_id: sku,
      inventory: String(cantidad),
      requests: [
        {
          method: 'UPDATE',
          retailer_id: sku,
          product: { inventory: cantidad },
        },
      ],
    })
    if (!data || data.error) return this.localActualizarInventario(sku, cantidad)

    // Reflejar en espejo local.
    await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'whatsapp_catalog' },
      data: { stock: cantidad },
    }).catch(() => {})

    return { ok: true, stock_actual: cantidad }
  }

  async obtenerEstadoPedido(order_id: string): Promise<EstadoPedidoResult> {
    // WA Catalog no tiene orders — retornamos el estado del núcleo local
    // (no `null` para no romper flujos que esperan un estado válido).
    const order = await db.order.findFirst({
      where: { tenantId: this.tenantId, id: order_id },
      select: { status: true, updatedAt: true },
    })
    if (!order) return { estado: 'no_encontrado', fecha_actualizacion: new Date().toISOString() }
    return { estado: order.status, fecha_actualizacion: order.updatedAt.toISOString() }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Fallback local (espejo en DB con fuenteSincronizacion='whatsapp_catalog')
  // ───────────────────────────────────────────────────────────────────────

  private async localBuscarProductos(query: string, diseno?: string, categoria?: string): Promise<ProductSearchResult[]> {
    const q = (query ?? '').trim().toLowerCase()
    const products = await db.product.findMany({
      where: {
        tenantId: this.tenantId,
        fuenteSincronizacion: 'whatsapp_catalog',
        ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } : {}),
        ...(diseno ? { diseno: { contains: diseno } } : {}),
        ...(categoria ? { categoria: { contains: categoria } } : {}),
      },
      take: 50,
      orderBy: { name: 'asc' },
    })
    return products.map(p => this.toResultFromDb(p))
  }

  private async localObtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'whatsapp_catalog' },
    })
    return p ? this.toResultFromDb(p) : null
  }

  private async localActualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
    const updated = await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'whatsapp_catalog' },
      data: { stock: cantidad },
    })
    if (updated.count === 0) return { ok: false, stock_actual: 0 }
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'whatsapp_catalog' },
      select: { stock: true },
    })
    return { ok: true, stock_actual: p?.stock ?? cantidad }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mappers
  // ───────────────────────────────────────────────────────────────────────

  private toResult(p: WhatsAppCatalogItem): ProductSearchResult {
    const priceRaw = p.price
    return {
      sku: p.retailer_id ?? p.id ?? '',
      name: p.name ?? p.title ?? p.retailer_id ?? '',
      precio: Number(priceRaw) || 0,
      imagen_url: p.image_url ?? '',
      stock: p.inventory ?? 0,
      diseno: p.custom_label_0,
      categoria: p.category ?? p.custom_label_1,
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
