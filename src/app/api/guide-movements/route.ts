import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'

// GET /api/guide-movements?tenantId=X&guideNumber=Y
// Devuelve los movimientos (eventos de tracking) de una guía.
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

  const where: { tenantId: string; guideNumber?: string } = { tenantId }
  if (guideNumber) where.guideNumber = guideNumber

  const movements = await db.guideMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: guideNumber ? 200 : 100,
  })

  return NextResponse.json({ movements })
}

// POST /api/guide-movements
// Body: { tenantId, guideNumber, eventType, location?, description?, carrierName? }
// Crea un movimiento de tracking para una guía.
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

  const movement = await db.guideMovement.create({
    data: {
      tenantId,
      guideNumber: String(guideNumber),
      eventType,
      location: location ?? null,
      description: description ?? null,
      carrierName: carrierName ?? null,
    },
  })

  // Best-effort: if the movement is a delivery, also update the Shipment.estado.
  if (eventType === 'delivered' || eventType === 'in_transit' || eventType === 'returned' || eventType === 'exception') {
    try {
      const estadoMap: Record<string, string> = {
        in_transit: 'en_transito',
        delivered: 'entregada',
        returned: 'devuelta',
        exception: 'novedad',
      }
      const targetEstado = estadoMap[eventType]
      if (targetEstado) {
        await db.shipment.updateMany({
          where: { tenantId, numeroGuia: String(guideNumber) },
          data: { estado: targetEstado },
        })
      }
    } catch {
      // Shipment update is best-effort; do not fail the movement creation.
    }
  }

  return NextResponse.json({ movement })
}
