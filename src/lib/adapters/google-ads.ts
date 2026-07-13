// ZIAY — GoogleAdsAdapter
//
// Saramantha §7 — adaptador de Google Ads para importar spend, impressions,
// clicks y conversions por campaña y por anuncio.
//
// Integración:
//   - fetchCampaignPerformance:
//       POST https://googleads.googleapis.com/v17/customers/{customerId}/googleAds:searchStream
//       GAQL:
//         SELECT campaign.id, campaign.name,
//                metrics.cost_micros, metrics.impressions,
//                metrics.clicks, metrics.conversions
//         FROM campaign
//         WHERE segments.date BETWEEN '{start}' AND '{end}'
//   - fetchAdPerformance:
//       GAQL similar filtrando por ad_group_ad y campaign.id = {campaignId}.
//
// Notas:
//   - `cost_micros` se devuelve en micros (1 millón = 1 unidad). Se divide por
//     1_000_000 para obtener `spend` en la unidad mayor.
//   - Las fechas se pasan como YYYY-MM-DD (formato de segments.date en GAQL).
//   - Si falta cualquier credencial (developerToken / accessToken / customerId),
//     se registra un `log.warn` y se devuelve `[]` para que el flujo
//     de import no reviente (modo degradado).
//
// Env vars:
//   - GOOGLE_ADS_DEVELOPER_TOKEN
//   - GOOGLE_ADS_ACCESS_TOKEN
//   - (customerId se pasa al constructor; podría pasarse también por env var
//     por tenant — ver Tenant.credencialesCatalogoRef).

import type {
  AdPlatformAdapter,
  AdPerformance,
  CampaignPerformance,
} from './ad-platform-adapter'
import { getLogger } from '@/lib/logger'

const log = getLogger('adapters:google-ads')
const GOOGLE_ADS_API_BASE = process.env.GOOGLE_ADS_API_BASE ?? 'https://googleads.googleapis.com/v17'

/**
 * Adaptador de Google Ads. Cada instancia está ligada a un tenant + customerId
 * de Google Ads + developerToken + accessToken.
 */
export class GoogleAdsAdapter implements AdPlatformAdapter {
  name = 'google'

  private readonly tenantId: string
  private readonly customerId: string
  private readonly developerToken: string
  private readonly accessToken: string

  constructor(
    tenantId: string,
    customerId: string,
    developerToken: string,
    accessToken: string,
  ) {
    this.tenantId = tenantId
    this.customerId = (customerId || process.env.GOOGLE_ADS_CUSTOMER_ID || '').trim()
    this.developerToken = (
      developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''
    ).trim()
    this.accessToken = (
      accessToken || process.env.GOOGLE_ADS_ACCESS_TOKEN || ''
    ).trim()
  }

  private hasCredentials(): boolean {
    return !!(this.customerId && this.developerToken && this.accessToken)
  }

  async fetchCampaignPerformance(
    dateStart: string,
    dateEnd: string,
  ): Promise<CampaignPerformance[]> {
    if (!this.hasCredentials()) {
      log.warn({ tenantId: this.tenantId }, 'credenciales incompletas (customerId/developerToken/accessToken). Devolviendo [].')
      return []
    }
    const gaql = `SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${dateStart}' AND '${dateEnd}'`
    const rows = await this.runQuery<{ results?: Record<string, unknown>[] }>(gaql)
    const out: CampaignPerformance[] = []
    for (const row of rows) {
      const results = Array.isArray(row?.results) ? row.results : []
      for (const r of results) {
        out.push(this.mapCampaign(r))
      }
    }
    return out
  }

  async fetchAdPerformance(
    campaignId: string,
    dateStart: string,
    dateEnd: string,
  ): Promise<AdPerformance[]> {
    if (!this.hasCredentials()) {
      log.warn({ tenantId: this.tenantId }, 'credenciales incompletas. Devolviendo [].')
      return []
    }
    const gaql = `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${dateStart}' AND '${dateEnd}'`
    const rows = await this.runQuery<{ results?: Record<string, unknown>[] }>(gaql)
    const out: AdPerformance[] = []
    for (const row of rows) {
      const results = Array.isArray(row?.results) ? row.results : []
      for (const r of results) {
        out.push(this.mapAd(r))
      }
    }
    return out
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async runQuery<T = unknown>(gaql: string): Promise<T[]> {
    const url = `${GOOGLE_ADS_API_BASE}/customers/${encodeURIComponent(
      this.customerId,
    )}/googleAds:searchStream`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'developer-token': this.developerToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: gaql }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        log.error({ tenantId: this.tenantId, status: res.status, body: text.slice(0, 500) }, 'google-ads searchStream non-2xx')
        return []
      }
      const data = (await res.json()) as T | T[]
      return Array.isArray(data) ? data : [data]
    } catch (err) {
      log.error({ tenantId: this.tenantId, err: err instanceof Error ? err.message : String(err) }, 'google-ads searchStream error')
      return []
    }
  }

  private mapCampaign(r: Record<string, unknown>): CampaignPerformance {
    const campaign = (r?.campaign ?? {}) as Record<string, unknown>
    const metrics = (r?.metrics ?? {}) as Record<string, unknown>
    return {
      campaignId: String(campaign.id ?? campaign.resourceName ?? ''),
      campaignName: String(campaign.name ?? ''),
      spend: microsToUnit((metrics.costMicros ?? metrics.cost_micros ?? 0) as number | string),
      impressions: Number(metrics.impressions ?? 0),
      clicks: Number(metrics.clicks ?? 0),
      conversions: Number(metrics.conversions ?? 0),
    }
  }

  private mapAd(r: Record<string, unknown>): AdPerformance {
    const adGroupAd = (r?.adGroupAd ?? r?.ad_group_ad ?? {}) as Record<string, unknown>
    const ad = (adGroupAd.ad ?? {}) as Record<string, unknown>
    const metrics = (r?.metrics ?? {}) as Record<string, unknown>
    return {
      adId: String(ad.id ?? ad.resourceName ?? ''),
      adName: String(ad.name ?? ''),
      spend: microsToUnit(
        (metrics.costMicros ?? metrics.cost_micros ?? 0) as number | string,
      ),
      impressions: Number(metrics.impressions ?? 0),
      clicks: Number(metrics.clicks ?? 0),
      conversions: Number(metrics.conversions ?? 0),
    }
  }
}

/** Convierte micro-unidades de Google Ads a la unidad mayor (divide por 1M). */
function microsToUnit(micros: number | string): number {
  const n = typeof micros === 'string' ? Number(micros) : micros
  if (!Number.isFinite(n)) return 0
  return n / 1_000_000
}
