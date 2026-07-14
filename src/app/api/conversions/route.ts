import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { enqueue, isInlineMode } from '@/lib/queue'
import { conversionsService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api:conversions')

const FireSchema = z.object({
  tenantId: z.string().min(1),
  eventType: z.string().min(1),
  value: z.number().nullable().optional(),
  currency: z.string().optional(),
})

// Conversions — server-side pixel firing (Meta CAPI, Google MP, Tiktok Events API).
//
// GET /api/conversions?tenantId=X
//   ConversionEvent[] + stats { total, sent, failed, pending }
//
// POST /api/conversions { tenantId, eventType, value, currency }
//   Creates one `ConversionEvent` row per active pixel in 'pending' state,
//   then enqueues a `capi-fire` job to actually hit each platform. In dev
//   (no REDIS_URL) the job runs inline so the response contains the final
//   'sent'/'failed' results. In prod (BullMQ), the response contains the
//   job IDs and the rows stay 'pending' until the worker picks them up.
//
// The actual platform firing logic lives in `src/lib/queue.ts` so the
// worker process can run it out-of-band without holding the request thread.
//
// SPRINT8-SERVICES-REST-001 — migrated the `db.conversionEvent` /
// `db.pixelConfig` reads + writes to `conversionsService`. Response shapes
// unchanged.
export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

    const { events, stats } = await conversionsService.getEvents(tenantId)
    return NextResponse.json({ events, stats })
  

})

type FirePayload = z.infer<typeof FireSchema>

export const POST = withErrorHandling(async (req: NextRequest) => {

  let raw: unknown
  try {
    raw = await req.json()
  } catch (err) {
    captureError(err, { action: 'conversions:parse' })
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = FireSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body: FirePayload = parseResult.data
  const { tenantId, eventType } = body
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const value = typeof body.value === 'number' ? body.value : null
  const currency = typeof body.currency === 'string' ? body.currency : 'COP'

  const pixels = await conversionsService.getActivePixels(tenantId)

  log.info(
    { tenantId, eventType, value, currency, pixels: pixels.length },
    'conversion event fire',
  )

  if (pixels.length === 0) {
    const event = await conversionsService.createEvent({
      tenantId,
      pixelConfigId: null,
      eventType,
      value,
      currency,
      status: 'failed',
      response: 'No active pixel configs for this tenant',
    })
    return NextResponse.json({
      ok: true,
      event,
      results: [],
      message: 'No active pixel configs — event saved as failed',
    })
  }

  // Pre-create one ConversionEvent row per pixel in 'pending' state. The
  // queue handler updates each row with the platform's response. Doing the
  // row creation up-front (rather than inside the worker) means:
  //   - The route can return the event IDs immediately.
  //   - A crash mid-fire leaves rows in 'pending' — visible + retryable.
  const created = await Promise.all(
    pixels.map((pixel) =>
      conversionsService.createEvent({
        tenantId,
        pixelConfigId: pixel.id,
        eventType,
        value,
        currency,
        status: 'pending',
        response: 'queued',
      }),
    ),
  )

  // Enqueue the actual firing. In inline mode this runs synchronously and
  // every row is updated by the time `enqueue` returns. In BullMQ mode the
  // job lands on Redis and the rows stay 'pending' until the worker picks
  // them up.
  await enqueue('capi-fire', {
    tenantId,
    eventType,
    value,
    currency,
    pixels: pixels.map((p) => ({
      id: p.id,
      platform: p.platform,
      pixelId: p.pixelId,
      apiToken: p.apiToken,
      testMode: p.testMode,
    })),
    eventIds: created.map((e) => e.id),
  })

  // Read back the (possibly updated) rows so the response reflects the
  // final status in inline mode, or shows 'pending' in BullMQ mode.
  const updated = await conversionsService.getEventsByIds(created.map((e) => e.id))

  const results = updated.map((e) => ({
    platform: pixels.find((p) => p.id === e.pixelConfigId)?.platform || 'unknown',
    pixelConfigId: e.pixelConfigId as string,
    status: e.status as 'sent' | 'failed' | 'pending',
    response: e.response || '',
  }))

  const anySent = results.some((r) => r.status === 'sent')
  const anyPending = results.some((r) => r.status === 'pending')

  // In inline mode the work is already done — return the final aggregate
  // status. In BullMQ mode the work hasn't happened yet — return 'pending'
  // so callers know to poll or wait for the webhook.
  const aggregateStatus = anySent ? 'sent' : anyPending ? 'pending' : 'failed'

  return NextResponse.json({
    ok: true,
    results,
    status: aggregateStatus,
    queued: !isInlineMode(),
  })

})
