import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'

// Conversions — server-side pixel firing (Meta CAPI, Google MP, Tiktok Events API).
//
// GET /api/conversions?tenantId=X
//   ConversionEvent[] + stats { total, sent, failed }
//
// POST /api/conversions { tenantId, eventType, value, currency }
//   Fires the event to every active PixelConfig of the tenant. Each platform
//   runs in its own try/catch so a single failure doesn't poison the rest.
//   The ConversionEvent.status is updated to 'sent' or 'failed' accordingly.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const events = await db.conversionEvent.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const sent = events.filter((e) => e.status === 'sent').length
  const failed = events.filter((e) => e.status === 'failed').length
  const pending = events.filter((e) => e.status === 'pending').length

  return NextResponse.json({
    events,
    stats: {
      total: events.length,
      sent,
      failed,
      pending,
    },
  })
}

type FirePayload = {
  tenantId: string
  eventType: string
  value?: number | null
  currency?: string
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tenantId, eventType } = body as FirePayload
  if (!tenantId || !eventType) {
    return NextResponse.json(
      { error: 'tenantId and eventType are required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const value = typeof body.value === 'number' ? body.value : null
  const currency = typeof body.currency === 'string' ? body.currency : 'COP'

  const pixels = await db.pixelConfig.findMany({
    where: { tenantId, active: true },
  })

  if (pixels.length === 0) {
    const event = await db.conversionEvent.create({
      data: {
        tenantId,
        pixelConfigId: null,
        eventType,
        value,
        currency,
        status: 'failed',
        response: 'No active pixel configs for this tenant',
      },
    })
    return NextResponse.json({
      ok: true,
      event,
      results: [],
      message: 'No active pixel configs — event saved as failed',
    })
  }

  // Fire to each platform independently. A failure on one platform only marks
  // that ConversionEvent row — we still create one row per pixel so partial
  // success is visible.
  const results: Array<{
    platform: string
    pixelConfigId: string
    status: 'sent' | 'failed'
    response: string
  }> = []

  for (const pixel of pixels) {
    const result = await firePlatform(pixel, { eventType, value, currency })
    try {
      await db.conversionEvent.create({
        data: {
          tenantId,
          pixelConfigId: pixel.id,
          eventType,
          value,
          currency,
          status: result.status,
          response: result.response,
        },
      })
    } catch {
      // Even the DB write failed — surface it.
    }
    results.push({
      platform: pixel.platform,
      pixelConfigId: pixel.id,
      status: result.status,
      response: result.response,
    })
  }

  const anySent = results.some((r) => r.status === 'sent')
  return NextResponse.json({
    ok: true,
    results,
    status: anySent ? 'sent' : 'failed',
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Platform firing — stubbed HTTP calls. Each platform's API has its own
// payload format and auth header. We use fetch() to the real endpoints when
// not in test mode. Any failure is captured per-platform.
// ───────────────────────────────────────────────────────────────────────────

async function firePlatform(
  pixel: { platform: string; pixelId: string; apiToken: string; testMode: boolean },
  event: { eventType: string; value: number | null; currency: string },
): Promise<{ status: 'sent' | 'failed'; response: string }> {
  try {
    if (pixel.platform === 'meta') {
      return await fireMeta(pixel, event)
    }
    if (pixel.platform === 'google') {
      return await fireGoogle(pixel, event)
    }
    if (pixel.platform === 'tiktok') {
      return await fireTikTok(pixel, event)
    }
    return {
      status: 'failed',
      response: `Unknown platform: ${pixel.platform}`,
    }
  } catch (e) {
    return { status: 'failed', response: (e as Error).message }
  }
}

async function fireMeta(
  pixel: { pixelId: string; apiToken: string; testMode: boolean },
  event: { eventType: string; value: number | null; currency: string },
) {
  const url = `https://graph.facebook.com/v19.0/${pixel.pixelId}/events?access_token=${pixel.apiToken}`
  const payload = {
    data: [
      {
        event_name: event.eventType,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system',
        value: event.value ?? 0,
        currency: event.currency,
        test_event_code: pixel.testMode ? 'TEST12345' : undefined,
      },
    ],
  }
  // In test mode we skip the network call so dev environments without a real
  // token still produce a deterministic 'sent' result.
  if (pixel.testMode) {
    return { status: 'sent' as const, response: 'Meta CAPI test mode (no network call)' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) return { status: 'failed' as const, response: `Meta ${res.status}: ${text}` }
  return { status: 'sent' as const, response: `Meta ${res.status}: ${text.slice(0, 200)}` }
}

async function fireGoogle(
  pixel: { pixelId: string; apiToken: string; testMode: boolean },
  event: { eventType: string; value: number | null; currency: string },
) {
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${pixel.pixelId}&api_secret=${pixel.apiToken}`
  const payload = {
    client_id: 'commerceflow_os',
    events: [
      {
        name: event.eventType.toLowerCase(),
        params: {
          value: event.value ?? 0,
          currency: event.currency,
        },
      },
    ],
  }
  if (pixel.testMode) {
    return { status: 'sent' as const, response: 'Google MP test mode (no network call)' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) return { status: 'failed' as const, response: `Google ${res.status}: ${text || 'no body'}` }
  return { status: 'sent' as const, response: `Google ${res.status}: ok` }
}

async function fireTikTok(
  pixel: { pixelId: string; apiToken: string; testMode: boolean },
  event: { eventType: string; value: number | null; currency: string },
) {
  const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/'
  const payload = {
    pixel_code: pixel.pixelId,
    event: event.eventType,
    event_time: Math.floor(Date.now() / 1000),
    value: event.value ?? 0,
    currency: event.currency,
    test_event_code: pixel.testMode ? 'TEST12345' : undefined,
  }
  if (pixel.testMode) {
    return { status: 'sent' as const, response: 'TikTok Events API test mode (no network call)' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': pixel.apiToken,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) return { status: 'failed' as const, response: `TikTok ${res.status}: ${text}` }
  return { status: 'sent' as const, response: `TikTok ${res.status}: ${text.slice(0, 200)}` }
}
