// CommerceFlow OS — TikTokAdsAdapter
//
// Saramantha §7 — adaptador de TikTok Ads para importar spend, impressions,
// clicks y conversiones por campaña y por anuncio.
//
// Integración:
//   - fetchCampaignPerformance:
//       POST https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/
//       Header: Access-Token
//       Body:
//         {
//           advertiser_id: <advertiserId>,
//           data_level: "AUCTION_CAMPAIGN",
//           dimensions: ["campaign_id", "campaign_name"],
//           metrics: ["spend", "impressions", "clicks", "conversion"],
//           start_date: "YYYY-MM-DD",
//           end_date: "YYYY-MM-DD",
//           report_type: "BASIC",
//           page: 1,
//           page_size: 100
//         }
//   - fetchAdPerformance: igual pero con data_level="AUCTION_AD" y
//       dimensions=["ad_id","ad_name"] filtrado por campaign_id.
//
// Notas:
//   - `spend` viene como string en la unidad mayor (no centavos). Se parsea a
//     number.
//   - Si falta advertiserId o accessToken, se devuelve `[]` y se registra
//     `console.warn` (modo degradado).
//
// Env vars:
//   - TIKTOK_ACCESS_TOKEN
//   - (advertiserId se pasa al constructor; podría pasarse por env var
//     por tenant — ver Tenant.credencialesCatalogoRef).

import type {
  AdPlatformAdapter,
  AdPerformance,
  CampaignPerformance,
} from './ad-platform-adapter'

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

interface TikTokReportRow {
  dimensions?: Record<string, string>
  metrics?: Record<string, string>
}

interface TikTokReportResponse {
  code?: number
  message?: string
  data?: {
    list?: TikTokReportRow[]
    page_info?: { page: number; total_page: number }
  }
}

/**
 * Adaptador de TikTok Ads. Cada instancia está ligada a un tenant + advertiserId
 * + accessToken.
 */
export class TikTokAdsAdapter implements AdPlatformAdapter {
  name = 'tiktok'

  private readonly tenantId: string
  private readonly advertiserId: string
  private readonly accessToken: string

  constructor(tenantId: string, advertiserId: string, accessToken: string) {
    this.tenantId = tenantId
    this.advertiserId = (
      advertiserId || process.env.TIKTOK_ADVERTISER_ID || ''
    ).trim()
    this.accessToken = (
      accessToken || process.env.TIKTOK_ACCESS_TOKEN || ''
    ).trim()
  }

  private hasCredentials(): boolean {
    return !!(this.advertiserId && this.accessToken)
  }

  async fetchCampaignPerformance(
    dateStart: string,
    dateEnd: string,
  ): Promise<CampaignPerformance[]> {
    if (!this.hasCredentials()) {
      console.warn(
        `[tiktok-ads] tenant=${this.tenantId}: credenciales incompletas (advertiserId/accessToken). Devolviendo [].`,
      )
      return []
    }
    const rows = await this.runReport(dateStart, dateEnd, {
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: ['campaign_id', 'campaign_name'],
      filters: [],
    })
    return rows.map((r) => ({
      campaignId: String(r?.dimensions?.campaign_id ?? ''),
      campaignName: String(r?.dimensions?.campaign_name ?? ''),
      spend: num(r?.metrics?.spend),
      impressions: num(r?.metrics?.impressions),
      clicks: num(r?.metrics?.clicks),
      conversions: num(r?.metrics?.conversion),
    }))
  }

  async fetchAdPerformance(
    campaignId: string,
    dateStart: string,
    dateEnd: string,
  ): Promise<AdPerformance[]> {
    if (!this.hasCredentials()) {
      console.warn(
        `[tiktok-ads] tenant=${this.tenantId}: credenciales incompletas. Devolviendo [].`,
      )
      return []
    }
    const rows = await this.runReport(dateStart, dateEnd, {
      data_level: 'AUCTION_AD',
      dimensions: ['ad_id', 'ad_name'],
      filters: [
        {
          field: 'campaign_id',
          type: 'EQ',
          values: [campaignId],
        },
      ],
    })
    return rows.map((r) => ({
      adId: String(r?.dimensions?.ad_id ?? ''),
      adName: String(r?.dimensions?.ad_name ?? ''),
      spend: num(r?.metrics?.spend),
      impressions: num(r?.metrics?.impressions),
      clicks: num(r?.metrics?.clicks),
      conversions: num(r?.metrics?.conversion),
    }))
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async runReport(
    dateStart: string,
    dateEnd: string,
    opts: {
      data_level: string
      dimensions: string[]
      filters: Array<{ field: string; type: string; values: string[] }>
    },
  ): Promise<TikTokReportRow[]> {
    const url = `${TIKTOK_API_BASE}/report/integrated/get/`
    const allRows: TikTokReportRow[] = []
    let page = 1
    const pageSize = 100
    try {
      while (true) {
        const body = {
          advertiser_id: this.advertiserId,
          report_type: 'BASIC',
          data_level: opts.data_level,
          dimensions: opts.dimensions,
          metrics: ['spend', 'impressions', 'clicks', 'conversion'],
          start_date: dateStart,
          end_date: dateEnd,
          page,
          page_size: pageSize,
          ...(opts.filters.length > 0 ? { filters: opts.filters } : {}),
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Access-Token': this.accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          console.error(
            `[tiktok-ads] tenant=${this.tenantId} report ${res.status}: ${text.slice(0, 500)}`,
          )
          return allRows
        }
        const data = (await res.json()) as TikTokReportResponse
        if (data.code && data.code !== 0) {
          console.error(
            `[tiktok-ads] tenant=${this.tenantId} report code=${data.code} msg=${data.message ?? ''}`,
          )
          return allRows
        }
        const list = data.data?.list ?? []
        allRows.push(...list)
        const totalPages = data.data?.page_info?.total_page ?? 1
        if (page >= totalPages) break
        page += 1
        // Safety cap to avoid infinite loops on malformed responses
        if (page > 100) break
      }
      return allRows
    } catch (err) {
      console.error(
        `[tiktok-ads] tenant=${this.tenantId} report error:`,
        err instanceof Error ? err.message : err,
      )
      return allRows
    }
  }
}

/** Parsea un valor numérico que puede venir como string con decimales. */
function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? Number(v) : Number(v)
  return Number.isFinite(n) ? n : 0
}
