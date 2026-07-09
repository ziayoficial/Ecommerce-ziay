// ─────────────────────────────────────────────────────────────────────────────
// WhatsappCatalogAdapter — catálogo nativo de WhatsApp Business (Meta Commerce)
// Saramantha §8.2: "WhatsApp Catalog" como ruta de catálogo por tenant.
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO (real integration):
// - WhatsApp Catalog no tiene una API pública de "lista de productos" más allá
//   de Meta Commerce APIs (Commerce Platform / Catalog Batch API). Para la
//   mayoría de tenants se mantiene el catálogo espejado en nuestra tabla
//   `Product` con `fuenteSincronizacion='whatsapp_catalog'`, sincronizado
//   manualmente o vía webhook de Meta cuando se edita el catálogo desde la app.
// - Para crear pedido desde el agente: WA Catalog no expone un endpoint "crear
//   orden" — el agente genera la orden en nuestro núcleo (Order table) y, si el
//   tenant lo habilita, envía un `order_card` message type con los items al
//   cliente vía WhatsApp Cloud API (`POST /phone_number_id/messages` con
//   `type=order`).
// - Para actualizar inventario: PATCH sobre el catalog item via Meta Commerce
//   API (`graph.facebook.com/v19.0/{catalog_id}/items` con
//   `inventory` field) — requiere `catalog_management` permission y WABA verify.
// - Auth: System User token + `whatsapp_business_messaging` permiso.
// - Rate limits: 80 RPS por WABA en lectura, escritura más baja — cachear.
// - Webhooks: `catalog_update` para recibir cambios hechos desde la app WA.
//
// Esta implementación stub lee/escribe sobre `Product` y `Order` tablas,
// garantizando que el demo funcione end-to-end sin credenciales Meta.

import { db } from '@/lib/db'
import type { EcommerceAdapter, ProductSearchResult } from './ecommerce-adapter'

export class WhatsappCatalogAdapter implements EcommerceAdapter {
  constructor(private readonly tenantId: string) {}

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const q = query?.trim().toLowerCase() || ''
    const diseno = (filtros?.diseno as string | undefined)?.toLowerCase()
    const categoria = (filtros?.categoria as string | undefined)?.toLowerCase()

    const products = await db.product.findMany({
      where: {
        tenantId: this.tenantId,
        fuenteSincronizacion: 'whatsapp_catalog',
        ...(q ? { OR: [
          { name: { contains: q } },
          { sku: { contains: q } },
        ] } : {}),
        ...(diseno ? { diseno: { contains: diseno } } : {}),
        ...(categoria ? { categoria: { contains: categoria } } : {}),
      },
      take: 50,
      orderBy: { name: 'asc' },
    })

    return products.map(p => this.toResult(p))
  }

  async obtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'whatsapp_catalog' },
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
    // WA Catalog no expone un endpoint de creación de orden — registramos en el núcleo.
    // El envío del `order_card` al cliente se haría en una capa de mensajería posterior.
    const orderNumber = `WA-${Date.now().toString(36).toUpperCase()}`
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

    // Persistir items como OrderItem
    if (datos.items.length > 0) {
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
    }

    await db.orderEvent.create({
      data: { orderId: order.id, type: 'created', note: 'Pedido creado vía WhatsApp Catalog adapter' },
    })

    return {
      order_id: order.id,
      estado: order.status,
      // El seguimiento real lo provee el LogisticsAdapter una vez generada la guía.
      url_seguimiento: undefined,
    }
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<{ ok: boolean; stock_actual: number }> {
    const updated = await db.product.updateMany({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'whatsapp_catalog' },
      data: { stock: cantidad },
    })
    // updateMany no retorna el registro; consultamos para devolver el stock actual.
    if (updated.count === 0) {
      return { ok: false, stock_actual: 0 }
    }
    const p = await db.product.findFirst({
      where: { tenantId: this.tenantId, sku, fuenteSincronizacion: 'whatsapp_catalog' },
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
