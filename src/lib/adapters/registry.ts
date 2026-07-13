// ZIAY — Adapter registry
// Saramantha §8.1, §8.6 — resuelve el adaptador concreto en runtime según los
// campos `Tenant.plataformaCatalogo` y `Tenant.proveedorLogistico`.
//
// Este es el ÚNICO punto del código que sabe qué implementación concreta de
// EcommerceAdapter/LogisticsAdapter corresponde a cada tenant. Todo el resto
// del sistema (agentes, API routes, checkout flow) recibe el adaptador
// inyectado y nunca tiene que hacer switch sobre la plataforma.

import { db } from '@/lib/db'
import type { EcommerceAdapter } from './ecommerce-adapter'
import type { LogisticsAdapter } from './logistics-adapter'
import { WhatsappCatalogAdapter } from './whatsapp-catalog'
import { WooCommerceAdapter } from './woocommerce'
import { ShopifyAdapter } from './shopify'
import { SupabaseCatalogAdapter } from './supabase-catalog'
import { DropiAdapter } from './dropi'
import { Envios99Adapter } from './99envios'
import { AveonlineAdapter } from './aveonline'

/**
 * Devuelve la implementación de `EcommerceAdapter` correspondiente al tenant.
 * Las credenciales reales (consumer_key, OAuth token, Supabase URL, etc.) se
 * cargan desde el secret manager usando `tenant.credencialesCatalogoRef` en
 * producción; aquí pasamos strings vacíos como placeholder.
 */
export async function getEcommerceAdapter(tenantId: string): Promise<EcommerceAdapter> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`)

  switch (tenant.plataformaCatalogo) {
    case 'whatsapp_catalog':
      return new WhatsappCatalogAdapter(tenantId)
    case 'woocommerce':
      // ROADMAP (not technical debt): load real creds (consumer_key/consumer_secret)
      // from a secret manager keyed by `tenant.credencialesCatalogoRef` instead of
      // passing empty strings. Blocked on the secret-manager rollout (see
      // Saramantha §17 / security roadmap). Functionally safe today: the adapter
      // falls back to local catalog mirror when creds are empty.
      return new WooCommerceAdapter(tenantId, '', '', '')
    case 'shopify':
      // ROADMAP (not technical debt): load the per-tenant OAuth access token from
      // a secret manager keyed by `tenant.credencialesCatalogoRef`. Blocked on the
      // secret-manager rollout. Functionally safe today: the adapter falls back to
      // local catalog mirror when the token is empty.
      return new ShopifyAdapter(tenantId, '', '')
    case 'catalogo_propio_cliente':
      // Supabase del cliente (read-only).
      return new SupabaseCatalogAdapter(tenantId, 'cliente', '', '')
    case 'catalogo_nuestro':
      // Supabase nuestra (read-write).
      return new SupabaseCatalogAdapter(tenantId, 'nuestro', '', '')
    default:
      // Fallback seguro — WA Catalog no requiere creds externas.
      return new WhatsappCatalogAdapter(tenantId)
  }
}

/**
 * Devuelve la implementación de `LogisticsAdapter` correspondiente al tenant.
 * Las credenciales reales (API key Dropi/99envios/Aveonline) se cargan desde
 * el secret manager usando `tenant.credencialesLogisticaRef` en producción.
 */
export async function getLogisticsAdapter(tenantId: string): Promise<LogisticsAdapter> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`)

  switch (tenant.proveedorLogistico) {
    case 'dropi':
      return new DropiAdapter(tenantId)
    case '99envios':
      return new Envios99Adapter(tenantId)
    case 'aveonline':
      return new AveonlineAdapter(tenantId)
    default:
      // Fallback seguro — Dropi es la integración ya existente con Indisutex.
      return new DropiAdapter(tenantId)
  }
}
