import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getAdPlatformAdapter } from '@/lib/adapters/ads-registry'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { adsService } from '@/lib/services'

const log = getLogger('api/ads/import')

const AdsImportSchema = z.object({
  tenantId: z.string().min(1),
  platform: z.string().min(1),
  dateStart: z.string().min(1),
  dateEnd: z.string().min(1),
})

// POST /api/ads/import — importa spend/impressions/clicks/conversions de una
// plataforma de pauta (google | tiktok) para un tenant y un rango de fechas,
// y hace upsert de AdSpend records por (adId, date).
//
// Body:
//   { tenantId: string, platform: 'google' | 'tiktok',
//     dateStart: 'YYYY-MM-DD', dateEnd: 'YYYY-MM-DD' }
//
// Auth: requireTenantAccess(tenantId) — FIX-SECURITY-AUTH-001 (#32). Any
// authed user used to be able to trigger ad-spend import against any tenant
// (costs the tenant's external API quota, can be used for DoS).
//
// Notas:
//   - Las credenciales se leen desde env (ver ads-registry.ts). Si faltan,
//     el adapter devuelve [] y la importación no crea registros.
//   - La métrica agregada del rango se almacena con date=dateStart (simplificación
//     — el adapter devuelve datos agregados, no per-day).
//   - Solo se hacen upserts para Ads que ya existan en el catálogo del tenant
//     (Ad.externalId coincide con el adId de la plataforma).
//
// SPRINT8-SERVICES-REST-001 — migrated the per-ad `db.adSpend.upsert`
// loop into a single batched `adsService.importAdSpend` call.
//
// FIX-1-DB-001 — killed the per-ad `adsService.findAdByExternalId` N+1 (was
// 1 DB round trip per ad × M campaigns, up to 250+ at 50 ads × 5 campaigns).
// Replaced with a single `db.ad.findMany({ where: { externalId: { in: [...] },
// campaign: { tenantId } } })` once per import, with an O(1) Map lookup in the
// loop. The tenantId filter moves the safety check into the WHERE clause
// (previously done in the loop body) — same security posture, fewer round
// trips. Response shape unchanged.
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 20,
    windowMs: 60_000,
    namespace: 'api:ads:import',
  })
  if (limited) return limited

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = AdsImportSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const { tenantId, platform, dateStart, dateEnd } = parseResult.data

  // FIX-SECURITY-AUTH-001 (#32) — tenant gate before any external API call.
  const { session, error } = await requireTenantAccess(tenantId)
  if (error) return error

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
    const dateOnly = new Date(`${dateStart}T00:00:00.000Z`)

    // Pass 1: fetch ad performance per campaign sequentially (preserves the
    // existing call pattern — adapters may have per-campaign rate limits).
    // Collect all adPerf rows so we can batch the DB lookup below.
    type AdPerfRow = {
      adId: string
      spend: number
      impressions: number
      clicks: number
      conversions?: number
    }
    const allAdPerf: AdPerfRow[] = []
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
        allAdPerf.push({
          adId: ap.adId,
          spend: ap.spend,
          impressions: ap.impressions,
          clicks: ap.clicks,
          conversions: ap.conversions,
        })
      }
    }

    // FIX-1-DB-001 — single findMany replaces up to N round trips (one per
    // ad × M campaigns). The `campaign: { tenantId }` filter enforces the
    // same safety check that was previously done in the loop body, but at
    // the DB layer (an ad belonging to a different tenant is simply not
    // returned — silently skipped, same as the prior "not in our DB" path).
    const externalAdIds = allAdPerf.map((ap) => ap.adId)
    const ads =
      externalAdIds.length > 0
        ? await db.ad.findMany({
            where: {
              externalId: { in: externalAdIds },
              campaign: { tenantId: String(tenantId) },
            },
            include: { campaign: { select: { tenantId: true } } },
          })
        : []

    // O(1) Map lookup per ad — replaces the per-ad `await adsService.findAdByExternalId`.
    const adByExternalId = new Map(ads.map((ad) => [ad.externalId, ad]))

    const spendRows: Array<{
      adId: string
      date: Date
      spend: number
      impressions: number
      clicks: number
      convReported?: number
    }> = []
    for (const ap of allAdPerf) {
      const ad = adByExternalId.get(ap.adId)
      if (!ad) {
        // Ad not in our DB (or belongs to a different tenant) — skip silently.
        continue
      }
      spendRows.push({
        adId: ad.id,
        date: dateOnly,
        spend: ap.spend,
        impressions: ap.impressions,
        clicks: ap.clicks,
        convReported: ap.conversions,
      })
    }

    // Batch-upsert the spend rows in a single $transaction.
    if (spendRows.length > 0) {
      await adsService.importAdSpend(spendRows)
    }

    return NextResponse.json({
      ok: true,
      platform,
      tenantId,
      range: { dateStart, dateEnd },
      campaignsFetched: campaignPerf.length,
      adsProcessed,
      spendUpserted: spendRows.length,
    })
  } catch (err) {
    log.error(
      { err, tenantId, platform, dateStart, dateEnd },
      'ads import failed',
    )
    captureError(err as Error, { path: '/api/ads/import', method: 'POST' })
    return NextResponse.json(
      {
        error: 'Import failed',
        detail: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 },
    )
  }
}
