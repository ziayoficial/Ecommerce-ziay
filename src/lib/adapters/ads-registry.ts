// CommerceFlow OS — Ad Platform Adapter Registry
//
// Saramantha §7 — resuelve el adaptador de pauta concreto en runtime según el
// nombre de la plataforma y el tenant. Único punto del código que sabe qué
// implementación concreta de AdPlatformAdapter corresponde a cada plataforma.
//
// Uso:
//   const adapter = getAdPlatformAdapter('google', tenantId)
//   if (!adapter) throw new Error('platform not supported')
//   const perf = await adapter.fetchCampaignPerformance(start, end)
//
// En esta versión inicial, las credenciales se leen desde variables de entorno
// globales (GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_ACCESS_TOKEN,
// TIKTOK_ACCESS_TOKEN). En una versión multi-tenant completa, cada adapter
// podría recibir las credenciales desde `Tenant.credencialesCatalogoRef` /
// `AdPlatform.accessToken`.

import { GoogleAdsAdapter } from './google-ads'
import { TikTokAdsAdapter } from './tiktok-ads'
import type { AdPlatformAdapter } from './ad-platform-adapter'

export const AD_PLATFORMS = ['google', 'tiktok', 'meta'] as const
export type AdPlatformName = (typeof AD_PLATFORMS)[number]

/**
 * Devuelve la implementación de `AdPlatformAdapter` correspondiente a la
 * plataforma. Las credenciales se leen desde `process.env` dentro de cada
 * adapter; si faltan, las llamadas devuelven `[]` (modo degradado).
 *
 * @param platform nombre canónico de la plataforma (case-insensitive)
 * @param tenantId tenant al que pertenece la importación (para logs / multi-tenant)
 * @returns adaptador concreto o `null` si la plataforma no está soportada
 */
export function getAdPlatformAdapter(
  platform: string,
  tenantId: string,
): AdPlatformAdapter | null {
  switch (platform.toLowerCase()) {
    case 'google':
      return new GoogleAdsAdapter(tenantId, '', '', '')
    case 'tiktok':
      return new TikTokAdsAdapter(tenantId, '', '')
    default:
      return null
  }
}

/** Type guard: el string es un nombre canónico de plataforma soportada. */
export function isAdPlatform(platform: string): platform is AdPlatformName {
  return (AD_PLATFORMS as readonly string[]).includes(platform.toLowerCase())
}
