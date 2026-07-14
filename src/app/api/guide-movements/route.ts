import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { logisticsService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const GuideMovementSchema = z.object({
  tenantId: z.string().min(1),
  guideNumber: z.string().min(1),
  eventType: z.enum(['created', 'picked_up', 'in_transit', 'delivered', 'returned', 'exception']),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  carrierName: z.string().nullable().optional(),
})

// GET /api/guide-movements?tenantId=X&guideNumber=Y
// Devuelve los movimientos (eventos de tracking) de una guía.
//
// SPRINT8-SERVICES-REST-001 — migrated `db.guideMovement.findMany` to
// `logisticsService.getGuideMovements`. Response shape unchanged.
export const GET = withErrorHandling(async (req: NextRequest) => {

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

    const movements = await logisticsService.getGuideMovements(tenantId, guideNumber || undefined)
    return NextResponse.json({ movements })
  

})

// POST /api/guide-movements
// Body: { tenantId, guideNumber, eventType, location?, description?, carrierName? }
// Crea un movimiento de tracking para una guía.
//
// SPRINT8-SERVICES-REST-001 — migrated `db.guideMovement.create` + the
// best-effort `db.shipment.updateMany` cascade to
// `logisticsService.createGuideMovement`. The service preserves the
// best-effort semantics (Shipment update failure is non-fatal). Response
// shape unchanged.
export const POST = withErrorHandling(async (req: NextRequest) => {

  const limited = rateLimit(req, {
    max: 120,
    windowMs: 60_000,
    namespace: 'api:guide-movements:post',
  })
  if (limited) return limited

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = GuideMovementSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const { tenantId, guideNumber, eventType, location, description, carrierName } =
    parseResult.data

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

    const movement = await logisticsService.createGuideMovement({
      tenantId,
      guideNumber: String(guideNumber),
      eventType,
      location: location ?? null,
      description: description ?? null,
      carrierName: carrierName ?? null,
    })
    return NextResponse.json({ movement })
  

})
