// ZIAY — API /api/shipping/quote
// Saramantha §8.6, §6.8 — cotización de flete vía LogisticsAdapter.
//
// POST body: { tenantId, ciudad, pais, cantidad_unidades }
// Resuelve el adaptador logístico del tenant y devuelve la tarifa + ETA +
// transportadora. No persiste por defecto (la cotización puede cambiar y el
// valor real se fija al generar la guía); pero dejamos un log en AuditLog
// para trazabilidad.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getLogisticsAdapter } from '@/lib/adapters/registry'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const body = await req.json()
    const { tenantId, ciudad, pais, cantidad_unidades } = body as {
      tenantId?: string
      ciudad?: string
      pais?: string
      cantidad_unidades?: number
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }
    if (!ciudad) {
      return NextResponse.json({ error: 'ciudad is required' }, { status: 400 })
    }

    const cantidad = Math.max(1, Number(cantidad_unidades ?? 1))
    const paisNorm = (pais ?? 'CO').toUpperCase()

    const adapter = await getLogisticsAdapter(tenantId)
    const quote = await adapter.cotizarFlete(ciudad, paisNorm, cantidad)

    // Trazabilidad: registramos la cotización en audit log (no en tabla de
    // cotizaciones_flete dedicada — ese caché se puede añadir más adelante).
    await db.auditLog.create({
      data: {
        tenantId,
        action: 'shipping_quote',
        entity: 'shipment',
        meta: JSON.stringify({
          ciudad,
          pais: paisNorm,
          cantidad_unidades: cantidad,
          tarifa: quote.tarifa,
          tiempo_estimado_dias: quote.tiempo_estimado_dias,
          transportadora: quote.transportadora,
        }),
      },
    })

    return NextResponse.json({
      ok: true,
      tenantId,
      ciudad,
      pais: paisNorm,
      cantidad_unidades: cantidad,
      quote,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
