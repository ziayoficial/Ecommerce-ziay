// CommerceFlow OS — AdPlatformAdapter interface
//
// Saramantha §7 — desacopla las plataformas de pauta (Google Ads, TikTok Ads,
// Meta Ads) del orquestador de atribución y del dashboard de Ads.
//
// Contrato común:
//   fetchCampaignPerformance(start, end)  → métricas por campaña
//   fetchAdPerformance(campaignId, start, end) → métricas por ad
//
// La implementación concreta se resuelve en runtime por
// `getAdPlatformAdapter(platform, tenantId)` en `ads-registry.ts`.
// Si las credenciales no están configuradas, las implementaciones devuelven
// `[]` y registran un `console.warn` (modo degradado graciosamente).

/**
 * Métricas agregadas por campaña para un rango de fechas.
 * `spend` está en la unidad mayor del gateway (no centavos / no micros).
 */
export interface CampaignPerformance {
  campaignId: string
  campaignName: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

/**
 * Métricas agregadas por anuncio (ad) para un rango de fechas dentro de una
 * campaña. `adId` es el ID externo en la plataforma (Ad.externalId).
 */
export interface AdPerformance {
  adId: string
  adName: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

/**
 * Contrato común que toda plataforma de pauta debe implementar.
 * Ver Saramantha §7 — adaptadores de pauta.
 */
export interface AdPlatformAdapter {
  /** Nombre canónico de la plataforma (google | tiktok | meta). */
  name: string
  /** Devuelve métricas agregadas por campaña en el rango [dateStart, dateEnd]. */
  fetchCampaignPerformance(
    dateStart: string,
    dateEnd: string,
  ): Promise<CampaignPerformance[]>
  /** Devuelve métricas agregadas por anuncio para una campaña en el rango. */
  fetchAdPerformance(
    campaignId: string,
    dateStart: string,
    dateEnd: string,
  ): Promise<AdPerformance[]>
}
