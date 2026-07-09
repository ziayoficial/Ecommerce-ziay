// ─────────────────────────────────────────────────────────────────────────────
// Envios99Adapter — 99envios (Saramantha §9.6, §8.6)
// Plataforma multitransportadora colombiana (TCC, Coordinadora, Interrapidísimo,
// Servientrega, Envía) desde un solo panel. API REST + recaudo contra entrega
// automático + carga masiva de guías vía Excel/CSV + agente de IA propio para
// resolver novedades.
//
// NOTA: el nombre de clase no puede empezar con un dígito en TypeScript/JS,
// por eso se llama `Envios99Adapter` (no `99enviosAdapter`).
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO (real integration):
// - Base URL: `https://api.99envios.app/v1` (placeholder — confirmar con tenant).
// - Auth: API key del tenant (header `x-api-key: {token}`). Guardar en
//   `Tenant.credencialesLogisticaRef`.
// - Endpoints:
//   · POST /quotes       body { ciudad, pais, unidades }   → cotizarFlete
//   · POST /guides       body { order, address, total }    → generarGuia
//   · GET  /guides/{guia}                                  → consultarEstadoGuia
//   · POST /guides/{guia}/novelties body { tipo }          → reportarNovedad
// - 99envios expone un agente de IA propio para resolver novedades — acordar
//   por tenant si esa función la hace 99envios o nuestro agente §6.8, para no
//   duplicar mensajes al cliente (riesgo §18.10).
// - Rate limits: 30 req/min por API key (placeholder — confirmar).
// - Webhooks: 99envios puede pushear estado de guía — registrar URL pública.
// - Recaudo contra entrega: 99envios lo liquida automáticamente D+8 a D+15;
//   útil para tenants con flujo de caja apretado.
//
// Esta implementación stub devuelve tarifas realistas para Colombia
// (Bogotá ~$8.000 COP, Pasto ~$14.000 COP) e internacional (~$45 USD).

import { db } from '@/lib/db'
import { normalizeCarrierName } from '@/lib/carriers'
import type { LogisticsAdapter, FreightQuote, ShipmentResult, ShipmentStatus } from './logistics-adapter'

// Tarifas base realistas (COP) — 99envios suele ser ~5% más barato que Dropi
// en ciudades principales pero más caro en zonas periféricas (Pasto, Quibdó).
const ENVIOS99_NATIONAL_RATES: Record<string, { base: number; dias: number }> = {
  bogota:        { base: 8000,  dias: 1 },
  bogotá:        { base: 8000,  dias: 1 },
  medellin:      { base: 9000,  dias: 2 },
  medellín:      { base: 9000,  dias: 2 },
  cali:          { base: 9500,  dias: 2 },
  barranquilla:  { base: 10500, dias: 3 },
  cartagena:     { base: 10500, dias: 3 },
  bucaramanga:   { base: 10000, dias: 2 },
  pereira:       { base: 10000, dias: 2 },
  manizales:     { base: 10000, dias: 2 },
  ibague:        { base: 9500,  dias: 2 },
  ibagué:        { base: 9500,  dias: 2 },
  villavicencio: { base: 9000,  dias: 2 },
  pasto:         { base: 14500, dias: 4 },
  monteria:      { base: 11500, dias: 3 },
  montería:      { base: 11500, dias: 3 },
  valledupar:    { base: 12000, dias: 3 },
  quibdo:        { base: 14500, dias: 4 },
  quibdó:        { base: 14500, dias: 4 },
  cucuta:        { base: 11500, dias: 3 },
  cucutá:        { base: 11500, dias: 3 },
}

const ENVIOS99_DEFAULT_NATIONAL = { base: 10500, dias: 3 }
const ENVIOS99_DEFAULT_CARRIER = 'Interrapidísimo'

export class Envios99Adapter implements LogisticsAdapter {
  constructor(private readonly tenantId: string) {}

  async cotizarFlete(ciudad: string, pais: string, cantidad_unidades: number): Promise<FreightQuote> {
    if (pais && pais.toUpperCase() !== 'CO') {
      return {
        tarifa: 42 * (cantidad_unidades > 2 ? 1.2 : 1),
        tiempo_estimado_dias: 12,
        transportadora: 'DHL',
      }
    }

    const key = (ciudad || '').trim().toLowerCase()
    const row = ENVIOS99_NATIONAL_RATES[key] ?? ENVIOS99_DEFAULT_NATIONAL
    const tarifa = Math.round((row.base + Math.max(0, cantidad_unidades - 1) * 1500) / 100) * 100

    const rawCarrier = key.includes('bogota') || key.includes('bogotá')
      ? 'Coordinadora'
      : key.includes('medellin') || key.includes('medellín')
        ? 'TCC'
        : key.includes('pasto') || key.includes('quibdo') || key.includes('quibdó')
          ? 'Envía'
          : ENVIOS99_DEFAULT_CARRIER

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
    const guia = `99E-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4).toString().padStart(4, '0')}`
    const rawCarrier = (datos_pedido.direccion.ciudad ?? '').toLowerCase().includes('bogota')
      ? 'Coordinadora'
      : ENVIOS99_DEFAULT_CARRIER
    const transportadora = await normalizeCarrierName(this.tenantId, rawCarrier)
    return {
      numero_guia: guia,
      url_seguimiento: `https://99envios.com/rastreo?guia=${guia}`,
      transportadora,
    }
  }

  async consultarEstadoGuia(numero_guia: string): Promise<ShipmentStatus> {
    const last = numero_guia.slice(-1)
    const lastNum = parseInt(last, 36) || 0
    const estados = ['generada', 'en_transito', 'en_oficina_destino', 'en_ruta_entrega', 'entregada']
    const estado = estados[lastNum % estados.length]
    const novedades = ['', '', '', '', '']
    return {
      estado,
      ultima_actualizacion: new Date().toISOString(),
      novedad: novedades[lastNum % novedades.length] || undefined,
    }
  }

  async reportarNovedad(numero_guia: string, tipo_novedad: string): Promise<{ ok: boolean; siguiente_accion: string }> {
    await db.shipment.updateMany({
      where: { numeroGuia: numero_guia },
      data: { novedad: tipo_novedad, estado: 'novedad' },
    })
    const acciones: Record<string, string> = {
      direccion_incorrecta: '99envios IA: contactar al cliente vía WhatsApp para actualizar dirección.',
      cliente_ausente: '99envios IA: reagendar entrega — cliente confirmado vía bot.',
      rechazo: 'Generar devolución y registrar en orden como returned.',
      paquete_danado: 'Abrir reclamación con la transportadora y reenviar reemplazo.',
    }
    return {
      ok: true,
      siguiente_accion: acciones[tipo_novedad] ?? 'Escalado a 99envios IA + equipo de logística.',
    }
  }
}
