// ─────────────────────────────────────────────────────────────────────────────
// DropiAdapter — Dropi (Saramantha §9.6, §8.6)
// Plataforma multitransportadora colombiana + marketplace de dropshipping
// (+160k productos). Integración ya existente con Indisutex SAS.
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO (real integration):
// - Base URL: `https://api.dropi.co/api/v2` (o la que el tenant tenga habilitada).
// - Auth: API key del tenant (header `Authorization: Bearer {token}`). Guardar
//   en `Tenant.credencialesLogisticaRef`.
// - Endpoints:
//   · POST /rates       body { city, country, units }   → cotizarFlete
//   · POST /shipments   body { order, address, value }  → generarGuia
//   · GET  /shipments/{guia}                            → consultarEstadoGuia
//   · POST /shipments/{guia}/incidents body { type }    → reportarNovedad
// - Dropi devolverá siempre la transportadora elegida (TCC/Coordinadora/
//   Interrapidísimo/Servientrega/Envía) según tarifa/cobertura.
// - Rate limits: ~60 req/min por API key — cachear cotizaciones por 5 min en
//   tabla `cotizaciones_flete` para no recotizar el mismo destino.
// - Webhooks: Dropi puede pushear estado de guía — registrar URL pública.
// - Recaudo contra entrega: Dropi lo maneja nativamente (es marketplace COD);
//   al confirmar entrega, reporta `valor_recaudado` y fecha de liquidación.
//
// Esta implementación stub devuelve tarifas realistas para Colombia
// (Bogotá ~$8.000 COP, Pasto ~$14.000 COP) e internacional (~$45 USD).

import { db } from '@/lib/db'
import { normalizeCarrierName } from '@/lib/carriers'
import type { LogisticsAdapter, FreightQuote, ShipmentResult, ShipmentStatus } from './logistics-adapter'

// Tarifas base realistas (COP) por ciudad destino nacional — Dropi CO.
// Las cifras están calibradas a tarifas reales 2024-2025 de dropshipping
// colombiano para 1-2 unidades; escalan con cantidad_unidades.
const DROPI_NATIONAL_RATES: Record<string, { base: number; dias: number }> = {
  bogota:        { base: 8000,  dias: 1 },
  bogotá:        { base: 8000,  dias: 1 },
  soacha:        { base: 8500,  dias: 1 },
  medellin:      { base: 9500,  dias: 2 },
  medellín:      { base: 9500,  dias: 2 },
  cali:          { base: 10000, dias: 2 },
  barranquilla:  { base: 11000, dias: 3 },
  cartagena:     { base: 11000, dias: 3 },
  bucaramanga:   { base: 10500, dias: 2 },
  cucuta:        { base: 11500, dias: 3 },
  cucutá:        { base: 11500, dias: 3 },
  pereira:       { base: 10500, dias: 2 },
  manizales:     { base: 10500, dias: 2 },
  ibague:        { base: 10000, dias: 2 },
  ibagué:        { base: 10000, dias: 2 },
  villavicencio: { base: 9500,  dias: 2 },
  pasto:         { base: 14000, dias: 4 },
  monteria:      { base: 12000, dias: 3 },
  montería:      { base: 12000, dias: 3 },
  valledupar:    { base: 12500, dias: 3 },
  quibdo:        { base: 13500, dias: 4 },
  quibdó:        { base: 13500, dias: 4 },
}

const DROPI_DEFAULT_NATIONAL = { base: 11000, dias: 3 }
const DROPI_DEFAULT_CARRIER = 'Servientrega'

export class DropiAdapter implements LogisticsAdapter {
  constructor(private readonly tenantId: string) {}

  async cotizarFlete(ciudad: string, pais: string, cantidad_unidades: number): Promise<FreightQuote> {
    // Internacional — Dropi no maneja bien envíos fuera de CO; devolvemos tarifa
    // expresada en USD (≈ $45) y la transportadora internacional típica (DHL).
    if (pais && pais.toUpperCase() !== 'CO') {
      return {
        tarifa: 45 * (cantidad_unidades > 2 ? 1.2 : 1),
        tiempo_estimado_dias: 10,
        transportadora: 'DHL',
      }
    }

    const key = (ciudad || '').trim().toLowerCase()
    const row = DROPI_NATIONAL_RATES[key] ?? DROPI_DEFAULT_NATIONAL
    // Cada unidad adicional suma ~$1.500 COP (manejo + peso).
    const tarifa = Math.round((row.base + Math.max(0, cantidad_unidades - 1) * 1500) / 100) * 100

    // Dropi elige transportadora según destino; en stub usamos heurística simple.
    const rawCarrier = key === 'bogota' || key === 'bogotá'
      ? 'Coordinadora'
      : key.includes('medellin') || key.includes('medellín') || key.includes('cali')
        ? 'TCC'
        : key === 'pasto' || key.includes('quibdo') || key.includes('quibdó')
          ? 'Envía'
          : DROPI_DEFAULT_CARRIER

    const transportadora = await normalizeCarrierName(this.tenantId, rawCarrier)

    return {
      tarifa,
      tiempo_estimado_dias: row.dias,
      transportadora,
    }
  }

  async generarGuia(datos_pedido: {
    contacto_id: string
    direccion: Record<string, string>
    valor: number
    items_count: number
  }): Promise<ShipmentResult> {
    // Stub: genera número de guía con prefijo Dropi. En producción, POST /shipments.
    const guia = `DROPI-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4).toString().padStart(4, '0')}`
    const rawCarrier = (datos_pedido.direccion.ciudad ?? '').toLowerCase().includes('bogota')
      ? 'Coordinadora'
      : DROPI_DEFAULT_CARRIER
    const transportadora = await normalizeCarrierName(this.tenantId, rawCarrier)
    return {
      numero_guia: guia,
      url_seguimiento: `https://dropi.co/seguimiento?guia=${guia}`,
      transportadora,
    }
  }

  async consultarEstadoGuia(numero_guia: string): Promise<ShipmentStatus> {
    // Stub: usa el último dígito del número de guía para simular estados.
    // En producción, GET /shipments/{guia}.
    const last = numero_guia.slice(-1)
    const lastNum = parseInt(last, 36) || 0
    const estados = ['en_transito', 'en_oficina_destino', 'en_ruta_entrega', 'entregada']
    const estado = estados[lastNum % estados.length]
    return {
      estado,
      ultima_actualizacion: new Date().toISOString(),
      novedad: estado === 'entregada' ? undefined : undefined,
    }
  }

  async reportarNovedad(numero_guia: string, tipo_novedad: string): Promise<{ ok: boolean; siguiente_accion: string }> {
    // En producción, POST /shipments/{guia}/incidents.
    // Persistir la novedad en la Shipment table.
    await db.shipment.updateMany({
      where: { numeroGuia: numero_guia },
      data: { novedad: tipo_novedad, estado: 'novedad' },
    })
    const acciones: Record<string, string> = {
      direccion_incorrecta: 'Contactar al cliente para corregir dirección y reagendar entrega.',
      cliente_ausente: 'Reagendar entrega en franja horaria acordada con el cliente.',
      rechazo: 'Generar devolución y registrar en orden como returned.',
      paquete_danado: 'Abrir reclamación a la transportadora y reenviar reemplazo.',
    }
    return {
      ok: true,
      siguiente_accion: acciones[tipo_novedad] ?? 'Escalado al equipo de logística para revisión manual.',
    }
  }
}
