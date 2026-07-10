// CommerceFlow OS — LogisticsAdapter interface
// Saramantha doc §8.6 — desacopla al agente de logística (§6.8) y al de
// checkout (§6.10) de cuál plataforma de envíos usa cada tenant.
//
// Los tres proveedores soportados (Dropi, 99envios, Aveonline) son plataformas
// colombianas MULTITRANSPORTADORA — cotizan y generan guía indistintamente con
// TCC, Coordinadora, Interrapidísimo, Servientrega y Envía desde un solo panel,
// por lo que la interfaz común es la misma sin importar cuál esté detrás.
//
// La implementación concreta se resuelve en runtime desde
// `Tenant.proveedorLogistico` vía `getLogisticsAdapter(tenantId)` en `registry.ts`.

/**
 * Cotización de flete devuelta por el proveedor logístico.
 * `tarifa` está en COP si `pais === 'CO'`, en USD si es internacional.
 * El llamador decide la moneda según el país destino.
 */
export interface FreightQuote {
  tarifa: number
  tiempo_estimado_dias: number
  transportadora: string
}

/**
 * Resultado de generar una guía. `numero_guia` es el tracking number real del
 * proveedor; `url_seguimiento` es la URL pública de tracking.
 */
export interface ShipmentResult {
  numero_guia: string
  url_seguimiento: string
  transportadora: string
}

/**
 * Estado actual de una guía en tránsito.
 */
export interface ShipmentStatus {
  estado: string
  ultima_actualizacion: string
  novedad?: string
}

/**
 * Input para generar una guía. `direccion` es un mapa libre porque cada
 * proveedor (Dropi/99envios/Aveonline) tiene su propio shape de dirección.
 */
export interface GenerarGuiaInput {
  contacto_id: string
  direccion: Record<string, string>
  valor: number
  items_count: number
}

/**
 * Contrato común que toda plataforma logística debe implementar.
 * Ver Saramantha §8.6.
 */
export interface LogisticsAdapter {
  cotizarFlete(ciudad: string, pais: string, cantidad_unidades: number): Promise<FreightQuote>
  generarGuia(datos_pedido: GenerarGuiaInput): Promise<ShipmentResult>
  consultarEstadoGuia(numero_guia: string): Promise<ShipmentStatus>
  reportarNovedad(numero_guia: string, tipo_novedad: string): Promise<{ ok: boolean; siguiente_accion: string }>
}
