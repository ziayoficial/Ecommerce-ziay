// ZIAY — API /api/shipping/quote
// Saramantha §8.6, §6.8 — cotización de flete vía LogisticsAdapter.
//
// POST body: { tenantId, ciudad, pais, cantidad_unidades }
// Resuelve el adaptador logístico del tenant y devuelve la tarifa + ETA +
// transportadora. No persiste por defecto (la cotización puede cambiar y el
// valor real se fija al generar la guía); pero dejamos un log en AuditLog
// para trazabilidad.
//
// SPRINT8-SERVICES-REST-001 — left inline. The only db call here is a
// single `db.auditLog.create` after the adapter returns. Per rule #2
// (1-2 simple db calls OK to leave), a one-row audit-log insert doesn't
// warrant a service method.
// TODO: migrate to service layer if quote caching/persistence is added.
//
// FIX-SECURITY-AUTH-001 (#26) — requireTenantAccess(tenantId). Any authed
// user used to be able to burn any tenant's external logistics API quota.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getLogisticsAdapter } from '@/lib/adapters/registry'
import { db } from '@/lib/db'

// TD-2: Zod schema for shipping quote POST.
const ShippingQuoteSchema = z.object({
  tenantId: z.string().min(1),
  ciudad: z.string().min(1),
  pais: z.string().optional(),
  cantidad_unidades: z.number().optional(),
}).passthrough()

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json()
    const parseResult = ShippingQuoteSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const { tenantId, ciudad, pais, cantidad_unidades } = parseResult.data as {
      tenantId: string
      ciudad: string
      pais?: string
      cantidad_unidades?: number
    }

    // FIX-SECURITY-AUTH-001 (#26) — tenant gate before the external adapter call.
    const { error } = await requireTenantAccess(tenantId)
    if (error) return error

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
