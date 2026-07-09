// ─────────────────────────────────────────────────────────────────────────────
// AveonlineAdapter — Aveonline (Saramantha §9.6, §8.6)
// Ecosistema logístico colombiano: cotización y generación de guía
// multitransportadora vía API, recaudo protegido, anticipos de cartera antes
// de la liquidación, bodegaje/fulfillment en Medellín/Cali/Bogotá, y AveChat
// (automatización de confirmación y novedades por WhatsApp).
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO (real integration):
// - Base URL: `https://api.aveonline.co/api` (placeholder — confirmar).
// - Auth: token del tenant (header `Authorization: Bearer {token}` o
//   `x-aveonline-token`). Guardar en `Tenant.credencialesLogisticaRef`.
// - Endpoints:
//   · POST /cotizar      body { ciudad, pais, unidades }   → cotizarFlete
//   · POST /guias        body { order, address, total }    → generarGuia
//   · GET  /guias/{guia}                                  → consultarEstadoGuia
//   · POST /guias/{guia}/novedades body { tipo }          → reportarNovedad
// - AveChat automatiza confirmación y novedades por WhatsApp — mismo punto
//   de atención que 99envios: decidir por tenant cuál sistema posee esa
//   conversación para no duplicar mensajes (riesgo §18.10).
// - Rate limits: 40 req/min por token (placeholder — confirmar).
// - Webhooks: Aveonline puede pushear estado de guía — registrar URL pública.
// - Recaudo protegido: Aveonline anticipa cartera antes de liquidación de la
//   transportadora (D+3 a D+7) — útil para tenants con flujo de caja apretado.
// - Bodegaje: Aveonline ofrece fulfillment propio (MDE/CLO/BOG); si el tenant
//   activa este servicio, los items_count en `generarGuia` provienen del
//   manifiesto de fulfillment, no del pedido.
//
// Esta implementación stub devuelve tarifas realistas para Colombia
// (Bogotá ~$8.000 COP, Pasto ~$14.000 COP) e internacional (~$45 USD).

import { db } from '@/lib/db'
import { normalizeCarrierName } from '@/lib/carriers'
import type { LogisticsAdapter, FreightQuote, ShipmentResult, ShipmentStatus } from './logistics-adapter'

// Tarifas base realistas (COP) — Aveonline suele ser más fuerte en Antioquia
// (MDE HQ) y relativamente más caro en Caribe por cubrimiento de transportadora.
const AVEONLINE_NATIONAL_RATES: Record<string, { base: number; dias: number }> = {
  bogota:        { base: 8000,  dias: 1 },
  bogotá:        { base: 8000,  dias: 1 },
  medellin:      { base: 8500,  dias: 1 },
  medellín:      { base: 8500,  dias: 1 },
  cali:          { base: 9500,  dias: 2 },
  barranquilla:  { base: 11500, dias: 3 },
  cartagena:     { base: 11500, dias: 3 },
  bucaramanga:   { base: 10000, dias: 2 },
  pereira:       { base: 9500,  dias: 2 },
  manizales:     { base: 9500,  dias: 2 },
  ibague:        { base: 9500,  dias: 2 },
  ibagué:        { base: 9500,  dias: 2 },
  villavicencio: { base: 9500,  dias: 2 },
  pasto:         { base: 14000, dias: 4 },
  monteria:      { base: 12500, dias: 3 },
  montería:      { base: 12500, dias: 3 },
  valledupar:    { base: 12500, dias: 3 },
  quibdo:        { base: 14000, dias: 4 },
  quibdó:        { base: 14000, dias: 4 },
  cucuta:        { base: 11000, dias: 3 },
  cucutá:        { base: 11000, dias: 3 },
}

const AVEONLINE_DEFAULT_NATIONAL = { base: 10500, dias: 3 }
const AVEONLINE_DEFAULT_CARRIER = 'TCC'

export class AveonlineAdapter implements LogisticsAdapter {
  constructor(private readonly tenantId: string) {}

  async cotizarFlete(ciudad: string, pais: string, cantidad_unidades: number): Promise<FreightQuote> {
    if (pais && pais.toUpperCase() !== 'CO') {
      return {
        tarifa: 48 * (cantidad_unidades > 2 ? 1.2 : 1),
        tiempo_estimado_dias: 10,
        transportadora: 'DHL',
      }
    }

    const key = (ciudad || '').trim().toLowerCase()
    const row = AVEONLINE_NATIONAL_RATES[key] ?? AVEONLINE_DEFAULT_NATIONAL
    const tarifa = Math.round((row.base + Math.max(0, cantidad_unidades - 1) * 1500) / 100) * 100

    const rawCarrier = key.includes('bogota') || key.includes('bogotá')
      ? 'Coordinadora'
      : key.includes('medellin') || key.includes('medellín') || key.includes('cali')
        ? 'TCC'
        : key.includes('pasto') || key.includes('quibdo') || key.includes('quibdó')
          ? 'Envía'
          : AVEONLINE_DEFAULT_CARRIER

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
    const guia = `AVE-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4).toString().padStart(4, '0')}`
    const rawCarrier = (datos_pedido.direccion.ciudad ?? '').toLowerCase().includes('bogota')
      ? 'Coordinadora'
      : AVEONLINE_DEFAULT_CARRIER
    const transportadora = await normalizeCarrierName(this.tenantId, rawCarrier)
    return {
      numero_guia: guia,
      url_seguimiento: `https://aveonline.co/seguimiento?guia=${guia}`,
      transportadora,
    }
  }

  async consultarEstadoGuia(numero_guia: string): Promise<ShipmentStatus> {
    const last = numero_guia.slice(-1)
    const lastNum = parseInt(last, 36) || 0
    const estados = ['generada', 'en_transito', 'en_oficina_destino', 'en_ruta_entrega', 'entregada']
    const estado = estados[lastNum % estados.length]
    return {
      estado,
      ultima_actualizacion: new Date().toISOString(),
      novedad: undefined,
    }
  }

  async reportarNovedad(numero_guia: string, tipo_novedad: string): Promise<{ ok: boolean; siguiente_accion: string }> {
    await db.shipment.updateMany({
      where: { numeroGuia: numero_guia },
      data: { novedad: tipo_novedad, estado: 'novedad' },
    })
    const acciones: Record<string, string> = {
      direccion_incorrecta: 'AveChat: contactar al cliente vía WhatsApp para corregir dirección.',
      cliente_ausente: 'AveChat: reagendar entrega — cliente confirmado vía bot.',
      rechazo: 'Generar devolución y registrar en orden como returned.',
      paquete_danado: 'Abrir reclamación con la transportadora y reenviar reemplazo.',
    }
    return {
      ok: true,
      siguiente_accion: acciones[tipo_novedad] ?? 'Escalado a AveChat + equipo de logística.',
    }
  }
}
