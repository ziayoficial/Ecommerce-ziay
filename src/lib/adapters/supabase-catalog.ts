// ─────────────────────────────────────────────────────────────────────────────
// SupabaseCatalogAdapter — catálogo propio (cliente o nuestro) sobre Supabase
// Saramantha §8.4, §8.5, §9.4.
//   - modo='nuestro':  Supabase provista por nosotros, lectura+escritura.
//   - modo='cliente':  Supabase del cliente, lectura via PostgREST (read-only).
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO (real integration — modo='cliente'):
// - Auth: cliente provee `SUPABASE_URL` + `service_role_key` (de solo lectura)
//   o anon key si hay RLS configurada. Guardar en `Tenant.credencialesCatalogoRef`.
// - Endpoint: PostgREST autogenerada — `GET {SUPABASE_URL}/rest/v1/productos?select=*`.
//   Headers: `apikey: {key}`, `Authorization: Bearer {key}`.
// - Filtros: `?nombre=ilike.*{q}*` o `?sku=eq.{sku}`.
// - El adaptador NO escribe en la Supabase del cliente (solo lectura); los pedidos
//   se registran en nuestro núcleo (Order table).
// - Cambios de esquema no avisados por el cliente pueden romper la sincronización;
//   validar columnas esperadas antes de cada pull (riesgo §18.7).
//
// TODO (real integration — modo='nuestro'):
// - Auth: SUPABASE_URL + service_role_key del proyecto que administramos.
// - Endpoints:
//   · GET  /rest/v1/productos?select=*    → buscarProductos / obtenerProducto
//   · POST /rest/v1/pedidos               → crearPedido
//   · PATCH /rest/v1/inventario?id=eq.{id} body { stock: n } → actualizarInventario
//   · GET  /rest/v1/pedidos?id=eq.{id}    → obtenerEstadoPedido
// - Rate limits: Supabase Free = 2 GB egress/mes + 500 concurrent connections;
//   Pro = 8 GB. Usar connection pooler (pgBouncer) en producción.
// - Webhooks: Database Webhooks (Supabase) sobre `productos` → mantener espejo.
//
// Esta implementación stub:
//   - modo='nuestro':  lee/escribe sobre `Product` con fuenteSincronizacion='supabase_nuestro'.
//   - modo='cliente':  lee sobre `Product` con fuenteSincronizacion='supabase_cliente'
//                      (espejo cacheado de un pull previo) — read-only.

import { db } from '@/lib/db'
import type { EcommerceAdapter, ProductSearchResult } from './ecommerce-adapter'

export type SupabaseMode = 'nuestro' | 'cliente'

export class SupabaseCatalogAdapter implements EcommerceAdapter {
  constructor(
    private readonly tenantId: string,
    private readonly mode: SupabaseMode,
    /** SUPABASE_URL. Placeholder — producción la carga desde secret manager. */
    private readonly supabaseUrl: string = '',
    /** service_role_key o anon key. Placeholder. */
    private readonly apiKey: string = '',
  ) {}

  private get fuente(): string {
    return this.mode === 'nuestro' ? 'supabase_nuestro' : 'supabase_cliente'
  }

  private get readOnly(): boolean {
    // Saramantha §8.4: la Supabase del cliente es read-only.
    return this.mode === 'cliente'
  }

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const q = query?.trim().toLowerCase() || ''
    const categoria = (filtros?.categoria as string | undefined)?.toLowerCase()

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
    return products.map(p => this.toResult(p))
  }

  async obtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: this.fuente },
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
    // Siempre registramos en el núcleo. En modo='nuestro' se replicaría a Supabase.
    // En modo='cliente' NO se escribe en la Supabase del cliente (read-only).
    const prefix = this.mode === 'nuestro' ? 'SN' : 'SC'
    const orderNumber = `${prefix}-${Date.now().toString(36).toUpperCase()}`
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
      data: {
        orderId: order.id,
        type: 'created',
        note: `Pedido creado vía SupabaseCatalogAdapter (modo=${this.mode}${this.readOnly ? ', read-only' : ''})`,
      },
    })

    return { order_id: order.id, estado: order.status }
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<{ ok: boolean; stock_actual: number }> {
    if (this.readOnly) {
      // Saramantha §8.4: Supabase del cliente es read-only.
      // No escribimos; reportamos stock actual del espejo local.
      const p = await db.product.findFirst({
        where: { tenantId: this.tenantId, sku, fuenteSincronizacion: this.fuente },
        select: { stock: true },
      })
      return { ok: false, stock_actual: p?.stock ?? 0 }
    }
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
