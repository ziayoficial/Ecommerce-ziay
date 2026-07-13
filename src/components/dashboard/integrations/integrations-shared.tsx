// ZIAY — Shared types, helpers, and constants for the integrations
// dashboard view. Split out from integrations-view.tsx in
// SPRINT8-VIEWS-SPLIT-001 — no behavior changes, just file layout.

import {
  CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react'

// Re-export the credential-field registry types/helpers so the rest of
// the integrations modules only need to import from here.
export {
  INTEGRATION_REGISTRY,
  CATEGORY_META,
  CATEGORY_ORDER,
  getIntegrationsByCategory,
  type IntegrationConfig,
  type IntegrationCategory,
} from '@/lib/adapters/credential-fields'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type HealthCheck = { name: string; status: 'ok' | 'warning' | 'error' | 'not_configured'; detail: string }

export type Product = {
  id: string; sku: string; name: string; description: string | null
  price: number; imageUrl: string | null; stock: number
  diseno: string | null; categoria: string | null
  fuenteSincronizacion: string | null
}

export type FreightQuoteResult = {
  ok: boolean
  ciudad: string
  pais: string
  cantidad_unidades: number
  quote: { tarifa: number; tiempo_estimado_dias: number; transportadora: string }
} | { error: string }

export type VisionResult = {
  reply: string
  agent: string
  confidence: number
  error?: string
}

export type CredentialState = {
  configured: boolean
  fields: Record<string, string>
}

export type CredentialsResponse = {
  integrations: Record<string, CredentialState>
}

// ───────────────────────────────────────────────────────────────────────────
// Static registry metadata — mirrors src/lib/adapters/registry.ts so the UI
// shows all 4 ecommerce routes + 3 logistics providers even before health data
// loads. The "active" badge comes from the per-tenant config (tenant.
// plataformaCatalogo / tenant.proveedorLogistico) which the /api/health endpoint
// already exposes via `tenant_catalog_adapter` / `tenant_logistics_adapter`.
// ───────────────────────────────────────────────────────────────────────────

export const ECOM_ROUTES = [
  { id: 'whatsapp_catalog',  label: 'WhatsApp Catalog',   emoji: '💬', spec: '§8.2 — catálogo gestionado por Meta Commerce' },
  { id: 'woocommerce',       label: 'WooCommerce',        emoji: '🛒', spec: '§8.3 — REST consumer_key/secret del cliente' },
  { id: 'shopify',           label: 'Shopify',            emoji: '🅢', spec: '§8.3 — Admin GraphQL + OAuth access token' },
  { id: 'catalogo_propio_cliente', label: 'Supabase (cliente)', emoji: '🔌', spec: '§8.4 — read-only, sin escritura de inventario' },
  { id: 'catalogo_nuestro',  label: 'Supabase (nuestra)', emoji: '🗄️', spec: '§8.4 — read-write, multi-tenant' },
] as const

export const LOGISTICS_ROUTES = [
  { id: 'dropi',     label: 'Dropi',       emoji: '📦', spec: '§9.6 — multitransportadora CO' },
  { id: '99envios',  label: '99envios',    emoji: '🚚', spec: '§9.6 — multitransportadora CO' },
  { id: 'aveonline', label: 'Aveonline',   emoji: '✈️', spec: '§9.6 — multitransportadora CO' },
] as const

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

export function statusMeta(s: HealthCheck['status']) {
  switch (s) {
    case 'ok': return { label: 'Configurado',   dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', icon: CheckCircle2, iconCls: 'text-emerald-600' }
    case 'warning': return { label: 'Parcial',   dot: 'bg-amber-500',   badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',     icon: AlertTriangle, iconCls: 'text-amber-600' }
    case 'error': return { label: 'Error',       dot: 'bg-rose-500',    badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',        icon: XCircle, iconCls: 'text-rose-600' }
    default: return { label: 'No configurado',   dot: 'bg-slate-400',   badge: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',     icon: XCircle, iconCls: 'text-slate-500 dark:text-slate-400' }
  }
}
