import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getAdPlatformAdapter } from '@/lib/adapters/ads-registry'
import { getLogger } from '@/lib/logger'

const log = getLogger('api/ads/import')

// POST /api/ads/import — importa spend/impressions/clicks/conversions de una
// plataforma de pauta (google | tiktok) para un tenant y un rango de fechas,
// y hace upsert de AdSpend records por (adId, date).
//
// Body:
//   { tenantId: string, platform: 'google' | 'tiktok',
//     dateStart: 'YYYY-MM-DD', dateEnd: 'YYYY-MM-DD' }
//
// Auth: requireAuth()
//
// Notas:
//   - Las credenciales se leen desde env (ver ads-registry.ts). Si faltan,
//     el adapter devuelve [] y la importación no crea registros.
//   - La métrica agregada del rango se almacena con date=dateStart (simplificación
//     — el adapter devuelve datos agregados, no per-day).
//   - Solo se hacen upserts para Ads que ya existan en el catálogo del tenant
//     (Ad.externalId coincide con el adId de la plataforma).
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 20,
    windowMs: 60_000,
    namespace: 'api:ads:import',
  })
  if (limited) return limited

  const { session, error } = await requireAuth()
  if (error) return error

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tenantId, platform, dateStart, dateEnd } = body ?? {}
  if (!tenantId || !platform || !dateStart || !dateEnd) {
    return NextResponse.json(
      { error: 'tenantId, platform, dateStart, dateEnd are required' },
      { status: 400 },
    )
  }

  const adapter = getAdPlatformAdapter(String(platform), String(tenantId))
  if (!adapter) {
    return NextResponse.json(
      { error: `Unsupported ad platform: ${platform}` },
      { status: 400 },
    )
  }

  void session // session available for future audit; unused for now

  try {
    const campaignPerf = await adapter.fetchCampaignPerformance(
      String(dateStart),
      String(dateEnd),
    )
    log.info(
      { tenantId, platform, campaigns: campaignPerf.length, dateStart, dateEnd },
      'ad performance fetched',
    )

    let adsProcessed = 0
    let spendUpserted = 0
    const dateOnly = new Date(`${dateStart}T00:00:00.000Z`)

    for (const cp of campaignPerf) {
      // Skip campaigns with no external id
      if (!cp.campaignId) continue
      const adPerf = await adapter.fetchAdPerformance(
        cp.campaignId,
        String(dateStart),
        String(dateEnd),
      )
      for (const ap of adPerf) {
        if (!ap.adId) continue
        adsProcessed += 1
        // Find the Ad by externalId (unique across the platform)
        const ad = await db.ad.findUnique({
          where: { externalId: ap.adId },
          include: { campaign: { select: { tenantId: true } } },
        })
        if (!ad) {
          // Ad not in our DB — skip silently (could be a new ad we haven't synced)
          continue
        }
        // Safety: only upsert if the ad's campaign belongs to this tenant
        if (ad.campaign.tenantId !== tenantId) {
          log.warn(
            { adId: ap.adId, adTenantId: ad.campaign.tenantId, tenantId },
            'ad belongs to a different tenant — skipping',
          )
          continue
        }
        await db.adSpend.upsert({
          where: { adId_date: { adId: ad.id, date: dateOnly } },
          create: {
            adId: ad.id,
            date: dateOnly,
            spend: ap.spend,
            impressions: ap.impressions,
            clicks: ap.clicks,
            convReported: ap.conversions,
          },
          update: {
            spend: ap.spend,
            impressions: ap.impressions,
            clicks: ap.clicks,
            convReported: ap.conversions,
          },
        })
        spendUpserted += 1
      }
    }

    return NextResponse.json({
      ok: true,
      platform,
      tenantId,
      range: { dateStart, dateEnd },
      campaignsFetched: campaignPerf.length,
      adsProcessed,
      spendUpserted,
    })
  } catch (err) {
    log.error(
      { err, tenantId, platform, dateStart, dateEnd },
      'ads import failed',
    )
    return NextResponse.json(
      {
        error: 'Import failed',
        detail: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 },
    )
  }
}
