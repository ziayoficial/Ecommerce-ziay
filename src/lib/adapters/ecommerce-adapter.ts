// CommerceFlow OS — EcommerceAdapter interface
// Saramantha doc §8.1–§8.5 — desacopla los agentes conversacionales del catálogo real.
// Un agente nunca sabe si está hablando con WhatsApp Catalog, WooCommerce, Shopify,
// la Supabase del cliente, o una base Oracle nuestra. Todos llaman a esta interfaz.
//
// La implementación concreta se resuelve en runtime desde `Tenant.plataformaCatalogo`
// vía `getEcommerceAdapter(tenantId)` en `registry.ts`.

/**
 * Resultado de búsqueda de productos. Forma común devuelta por toda implementación
 * de `EcommerceAdapter`, sin importar si el catálogo viene de Meta Commerce,
 * WooCommerce REST, Shopify Admin GraphQL, PostgREST, o PL/SQL.
 */
export interface ProductSearchResult {
  sku: string
  name: string
  precio: number
  imagen_url: string
  stock: number
  /** Diseño/tema del producto (Saramantha §2: "Stitch", "Hello Kitty", etc.). */
  diseno?: string
  /** Categoría comercial (familia, short, pantalon, batola). */
  categoria?: string
}

/**
 * Input para crear un pedido desde el agente de checkout (§6.10).
 * `direccion` es un mapa libre porque cada plataforma tiene su propio shape
 * (WooCommerce usa `shipping.address_1/2/city/state/postcode`, Shopify usa
 * `shippingAddress` GraphQL input, WA Catalog solo lo registra internamente).
 */
export interface CrearPedidoInput {
  contacto_id: string
  items: { sku: string; cantidad: number }[]
  valor: number
  direccion: Record<string, string>
  /** Saramantha §2: imagen de referencia enviada por el cliente (VLM-detected). */
  imagen_referencia_url?: string
}

export interface CrearPedidoResult {
  order_id: string
  estado: string
  url_seguimiento?: string
}

export interface ActualizarInventarioResult {
  ok: boolean
  stock_actual: number
}

export interface EstadoPedidoResult {
  estado: string
  fecha_actualizacion: string
}

/**
 * Contrato común que toda plataforma de catálogo/ecommerce debe implementar.
 * Ver Saramantha §8.1.
 */
export interface EcommerceAdapter {
  buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]>
  obtenerProducto(sku: string): Promise<ProductSearchResult | null>
  crearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult>
  actualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult>
  obtenerEstadoPedido(order_id: string): Promise<EstadoPedidoResult>
}
