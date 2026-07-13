import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { logisticsService } from '@/lib/services'

// GET /api/guide-movements?tenantId=X&guideNumber=Y
// Devuelve los movimientos (eventos de tracking) de una guía.
//
// SPRINT8-SERVICES-REST-001 — migrated `db.guideMovement.findMany` to
// `logisticsService.getGuideMovements`. Response shape unchanged.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const guideNumber = req.nextUrl.searchParams.get('guideNumber')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId is required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    const movements = await logisticsService.getGuideMovements(tenantId, guideNumber || undefined)
    return NextResponse.json({ movements })
  } catch (err) {
    captureError(err as Error, { path: '/api/guide-movements', method: 'GET', tenantId })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

// POST /api/guide-movements
// Body: { tenantId, guideNumber, eventType, location?, description?, carrierName? }
// Crea un movimiento de tracking para una guía.
//
// SPRINT8-SERVICES-REST-001 — migrated `db.guideMovement.create` + the
// best-effort `db.shipment.updateMany` cascade to
// `logisticsService.createGuideMovement`. The service preserves the
// best-effort semantics (Shipment update failure is non-fatal). Response
// shape unchanged.
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 120,
    windowMs: 60_000,
    namespace: 'api:guide-movements:post',
  })
  if (limited) return limited

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tenantId, guideNumber, eventType, location, description, carrierName } =
    body ?? {}
  if (!tenantId || !guideNumber || !eventType) {
    return NextResponse.json(
      { error: 'tenantId, guideNumber, eventType are required' },
      { status: 400 },
    )
  }

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const validTypes = [
    'created',
    'picked_up',
    'in_transit',
    'delivered',
    'returned',
    'exception',
  ]
  if (!validTypes.includes(eventType)) {
    return NextResponse.json(
      { error: `eventType must be one of: ${validTypes.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const movement = await logisticsService.createGuideMovement({
      tenantId,
      guideNumber: String(guideNumber),
      eventType,
      location: location ?? null,
      description: description ?? null,
      carrierName: carrierName ?? null,
    })
    return NextResponse.json({ movement })
  } catch (err) {
    captureError(err as Error, { path: '/api/guide-movements', method: 'POST', tenantId })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
