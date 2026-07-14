// ─────────────────────────────────────────────────────────────────────────────
// SupabaseCatalogAdapter — catálogo propio (cliente o nuestro) sobre Supabase
// Saramantha §8.4, §8.5, §9.4.
//   - modo='nuestro':  Supabase provista por nosotros, lectura+escritura.
//   - modo='cliente':  Supabase del cliente, lectura via PostgREST (read-only).
// ─────────────────────────────────────────────────────────────────────────────
//
// IMPLEMENTED (real HTTP integration via Supabase PostgREST):
// - Base URL: `{SUPABASE_URL}/rest/v1/{products,orders}`.
// - Auth: `apikey: {key}` + `Authorization: Bearer {key}` headers.
//   Creds desde `process.env.SUPABASE_URL` y `process.env.SUPABASE_API_KEY`.
// - Endpoints:
//   · GET  /rest/v1/products?name=ilike.*{q}*&select=*   → buscarProductos
//   · GET  /rest/v1/products?sku=eq.{sku}&select=*        → obtenerProducto
//   · POST /rest/v1/orders (Prefer: return=representation) → crearPedido
//   · PATCH /rest/v1/products?sku=eq.{sku} body { stock }  → actualizarInventario
//   · GET  /rest/v1/orders?id=eq.{id}&select=*             → obtenerEstadoPedido
// - En modo='cliente' el adaptador es read-only: `crearPedido` y
//   `actualizarInventario` operan solo sobre el núcleo (no tocan la Supabase
//   del cliente). En modo='nuestro' sí replican.
// - Timeout: 10s por request (AbortController).
// - Graceful fallback: si no hay creds o la llamada HTTP falla, se usa el
//   espejo local (`Product`/`Order` con fuenteSincronizacion='supabase_*').

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { EcommerceAdapter, ProductSearchResult, CrearPedidoInput, CrearPedidoResult, ActualizarInventarioResult, EstadoPedidoResult } from './ecommerce-adapter'

const HTTP_TIMEOUT_MS = 10_000

/** Row de products en Supabase. Aceptamos variantes de nombre de columna. */
interface SupabaseProduct {
  sku: string
  name?: string
  nombre?: string
  price?: number | string
  precio?: number | string
  imagen_url?: string
  image_url?: string
  stock?: number
  inventario?: number
  diseno?: string
  categoria?: string
}

interface SupabaseOrder {
  id: string | number
  estado?: string
  status?: string
  updated_at?: string
  fecha_actualizacion?: string
}

export type SupabaseMode = 'nuestro' | 'cliente'

export class SupabaseCatalogAdapter implements EcommerceAdapter {
  private readonly supabaseUrl: string
  private readonly apiKey: string

  constructor(
    private readonly tenantId: string,
    private readonly mode: SupabaseMode,
    /** SUPABASE_URL. Si vacío, lee de process.env.SUPABASE_URL. */
    supabaseUrl: string = '',
    /** service_role_key o anon key. Si vacío, lee de process.env.SUPABASE_API_KEY. */
    apiKey: string = '',
  ) {
    this.supabaseUrl = (supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/+$/, '')
    this.apiKey = apiKey || process.env.SUPABASE_API_KEY || ''
  }

  private get fuente(): string {
    return this.mode === 'nuestro' ? 'supabase_nuestro' : 'supabase_cliente'
  }

  private get readOnly(): boolean {
    // Saramantha §8.4: la Supabase del cliente es read-only.
    return this.mode === 'cliente'
  }

  private hasCreds(): boolean {
    return !!(this.supabaseUrl && this.apiKey)
  }

  /** fetch con timeout AbortController. */
  private async http<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T | null> {
    const url = `${this.supabaseUrl}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method,
        headers: {
          apikey: this.apiKey,
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(extraHeaders ?? {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        logger.warn({ tenantId: this.tenantId, url, status: res.status, text: text.slice(0, 300) }, 'Supabase API non-2xx — fallback to local DB')
        return null
      }
      if (res.status === 204) return [] as unknown as T
      return (await res.json()) as T
    } catch (err) {
      logger.warn({ tenantId: this.tenantId, url, err: err instanceof Error ? err.message : String(err) }, 'Supabase API call failed — fallback to local DB')
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const categoria = (filtros?.categoria as string | undefined)?.toLowerCase()
    if (!this.hasCreds()) return this.localBuscarProductos(query, categoria)

    const q = (query ?? '').trim()
    let path = '/rest/v1/products?select=*'
    if (q) path += `&or=(name.ilike.*${encodeURIComponent(q)}*,nombre.ilike.*${encodeURIComponent(q)}*,sku.ilike.*${encodeURIComponent(q)}*)`
    path += '&limit=50'

    const data = await this.http<SupabaseProduct[]>('GET', path)
    if (!Array.isArray(data)) return this.localBuscarProductos(query, categoria)

    let results = data.map(p => this.toResult(p))
    if (categoria) results = results.filter(r => (r.categoria ?? '').toLowerCase().includes(categoria))
    return results
  }

  async obtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    if (!this.hasCreds()) return this.localObtenerProducto(sku)
    if (!sku) return null

    const path = `/rest/v1/products?sku=eq.${encodeURIComponent(sku)}&select=*&limit=1`
    const data = await this.http<SupabaseProduct[]>('GET', path)
    if (!Array.isArray(data)) return this.localObtenerProducto(sku)
    const p = data[0]
    return p ? this.toResult(p) : null
  }

  async crearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult> {
    // En modo='cliente' NUNCA escribimos en la Supabase del cliente — solo en el núcleo.
    if (this.readOnly || !this.hasCreds()) return this.localCrearPedido(datos)

    // modo='nuestro': replicar a Supabase + persistir en el núcleo.
    const payload = {
      contacto_id: datos.contacto_id,
      items: datos.items,
      valor: datos.valor,
      direccion: datos.direccion,
      imagen_referencia_url: datos.imagen_referencia_url ?? null,
      estado: 'new',
      created_at: new Date().toISOString(),
    }
    const data = await this.http<SupabaseOrder[]>('POST', '/rest/v1/orders', payload, {
      Prefer: 'return=representation',
    })
    // Aunque Supabase falle, registramos en el núcleo (fallback graceful).
    const externalId = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null
    return this.localCrearPedido(datos, externalId)
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
    if (this.readOnly) {
      // Saramantha §8.4: Supabase del cliente es read-only.
      const p = await db.product.findFirst({
        where: { tenantId: this.tenantId, sku, fuenteSincronizacion: this.fuente },
        select: { stock: true },
      })
      return { ok: false, stock_actual: p?.stock ?? 0 }
    }
    if (!this.hasCreds()) return this.localActualizarInventario(sku, cantidad)

    // PATCH /products?sku=eq.{sku} body { stock: n }. PostgREST usa PATCH para update.
    const data = await this.http<SupabaseProduct[]>('PATCH', `/rest/v1/products?sku=eq.${encodeURIComponent(sku)}`, {
      stock: cantidad,
    }, {
      Prefer: 'return=representation',
    })
    if (!Array.isArray(data)) return this.localActualizarInventario(sku, cantidad)

    await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: this.fuente },
      data: { stock: cantidad },
    }).catch(() => {})

    return { ok: true, stock_actual: cantidad }
  }

  async obtenerEstadoPedido(order_id: string): Promise<EstadoPedidoResult> {
    // El núcleo guarda el order_id interno; el id externo (Supabase) está en number.
    const local = await db.order.findFirst({
      where: { tenantId: this.tenantId, id: order_id },
      select: { number: true, status: true, updatedAt: true },
    })
    if (!local) return { estado: 'no_encontrado', fecha_actualizacion: new Date().toISOString() }

    if (this.readOnly || !this.hasCreds()) {
      return { estado: local.status, fecha_actualizacion: local.updatedAt.toISOString() }
    }

    // Intentar lookup en Supabase vía id externo (en `number` con prefijo SN-).
    const extIdMatch = local.number?.match(/^SN-(.+)$/)
    const extId = extIdMatch?.[1] ?? null
    if (extId) {
      const path = `/rest/v1/orders?id=eq.${encodeURIComponent(extId)}&select=*&limit=1`
      const data = await this.http<SupabaseOrder[]>('GET', path)
      if (Array.isArray(data) && data[0]) {
        return {
          estado: data[0].estado ?? data[0].status ?? local.status,
          fecha_actualizacion: data[0].updated_at ?? data[0].fecha_actualizacion ?? local.updatedAt.toISOString(),
        }
      }
    }
    return { estado: local.status, fecha_actualizacion: local.updatedAt.toISOString() }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Fallback local (mismo comportamiento que el stub original)
  // ───────────────────────────────────────────────────────────────────────

  private async localBuscarProductos(query: string, categoria?: string): Promise<ProductSearchResult[]> {
    const q = (query ?? '').trim().toLowerCase()
    const products = await db.product.findMany({
      where: {
        tenantId: this.tenantId,
        fuenteSincronizacion: this.fuente,
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
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: this.fuente },
    })
    return p ? this.toResultFromDb(p) : null
  }

  private async localCrearPedido(datos: CrearPedidoInput, externalId?: string | null): Promise<CrearPedidoResult> {
    const prefix = this.mode === 'nuestro' ? 'SN' : 'SC'
    const orderNumber = externalId ? `${prefix}-${externalId}` : `${prefix}-${Date.now().toString(36).toUpperCase()}`
    // Lookup de productos fuera del tx (read-only); el resto va en una sola tx
    // para que order + items + event sean atómicos.
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
        data: {
          orderId: order.id,
          type: 'created',
          note: `Pedido creado vía SupabaseCatalogAdapter (modo=${this.mode}${this.readOnly ? ', read-only' : ''})`,
        },
      })
      return { order_id: order.id, estado: order.status }
    })
  }

  private async localActualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
    const updated = await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: this.fuente },
      data: { stock: cantidad },
    })
    if (updated.count === 0) return { ok: false, stock_actual: 0 }
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: this.fuente },
      select: { stock: true },
    })
    return { ok: true, stock_actual: p?.stock ?? cantidad }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mappers
  // ───────────────────────────────────────────────────────────────────────

  private toResult(p: SupabaseProduct): ProductSearchResult {
    const priceRaw = p.price ?? p.precio
    return {
      sku: p.sku,
      name: p.name ?? p.nombre ?? p.sku,
      precio: Number(priceRaw) || 0,
      imagen_url: p.imagen_url ?? p.image_url ?? '',
      stock: p.stock ?? p.inventario ?? 0,
      diseno: p.diseno,
      categoria: p.categoria,
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
