// ─────────────────────────────────────────────────────────────────────────────
// OracleCatalogAdapter — catálogo propio nuestro servido desde Oracle Database
// Saramantha §8.5 y §9.5: cuando el cliente no tiene catálogo propio y prefiere
// u opera con Oracle por gobernanza corporativa o licenciamiento existente.
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO (real integration):
// - Conexión: usar el driver `oracledb` (Node.js) con cadena de conexión guardada
//   en `Tenant.credencialesCatalogoRef` (secret manager).
// - Instalar: `bun add oracledb` (requiere Oracle Instant Client en el host).
// - Modelo lógico de tablas: igual que en Supabase (productos, precios_volumen,
//   temas_diseño, etc.) pero servido desde Oracle. Migración vía SQL DDL.
// - Auth: usuario/contraseña de Oracle + wallet (mTLS) si el cliente lo exige.
// - Adaptador SQL: traduce las llamadas de EcommerceAdapter a SQL/PLSQL sobre
//   Oracle. Mayor tiempo de puesta en marcha que Supabase, se reserva para
//   clientes con licenciamiento Oracle o requisito corporativo explícito.
// - Rate limits: no aplican (es DB propia), pero vigilar pool de conexiones
//   (Oracle recomienda max 100 conns por proceso).
// - Webhooks: no aplican (Oracle no envía webhooks; sync es pull programado).
//
// Esta implementación stub lee/escribe sobre `Product` y `Order` con
// `fuenteSincronizacion='oracle_nuestro'`, garantizando que el demo funcione
// end-to-end sin credenciales Oracle reales.

import { db } from '@/lib/db'
import type { EcommerceAdapter, ProductSearchResult, CrearPedidoInput, CrearPedidoResult, ActualizarInventarioResult, EstadoPedidoResult } from './ecommerce-adapter'

export class OracleCatalogAdapter implements EcommerceAdapter {
  constructor(
    private readonly tenantId: string,
    private readonly connectionString?: string, // ref: Tenant.credencialesCatalogoRef
  ) {}

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    const q = query?.trim().toLowerCase() || ''
    const products = await db.product.findMany({
      where: {
        tenantId: this.tenantId,
        fuenteSincronizacion: 'oracle_nuestro',
        ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } : {}),
      },
      take: 50,
      orderBy: { name: 'asc' },
    })
    return products.map(p => ({
      sku: p.sku, name: p.name, precio: p.price, imagen_url: p.imageUrl || '',
      stock: p.stock, diseno: p.diseno || undefined, categoria: p.categoria || undefined,
    }))
  }

  async obtenerProducto(sku: string): Promise<ProductSearchResult | null> {
    const p = await db.product.findUnique({ where: { tenantId_sku: { tenantId: this.tenantId, sku } } })
    if (!p) return null
    return {
      sku: p.sku, name: p.name, precio: p.price, imagen_url: p.imageUrl || '',
      stock: p.stock, diseno: p.diseno || undefined, categoria: p.categoria || undefined,
    }
  }

  async crearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult> {
    // En Oracle real: INSERT INTO pedidos (...) + INSERT INTO pedido_items (...) en una transacción PL/SQL
    const lastOrder = await db.order.findFirst({ where: { tenantId: this.tenantId }, orderBy: { number: 'desc' } })
    const nextNum = lastOrder ? (parseInt(lastOrder.number.replace(/\D/g, '')) + 1) : 100500
    const orderId = `ORACLE-${nextNum}`
    return {
      order_id: orderId,
      estado: 'confirmado',
      url_seguimiento: undefined, // Oracle no genera guía; el LogisticsAdapter la genera aparte
    }
  }

  async actualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult> {
    const p = await db.product.findUnique({ where: { tenantId_sku: { tenantId: this.tenantId, sku } } })
    if (!p) return { ok: false, stock_actual: 0 }
    const nuevoStock = Math.max(0, p.stock + cantidad)
    await db.product.update({ where: { id: p.id }, data: { stock: nuevoStock } })
    return { ok: true, stock_actual: nuevoStock }
  }

  async obtenerEstadoPedido(order_id: string): Promise<EstadoPedidoResult> {
    // En Oracle real: SELECT estado, fecha_actualizacion FROM pedidos WHERE order_id = ?
    return { estado: 'procesando', fecha_actualizacion: new Date().toISOString() }
  }
}
