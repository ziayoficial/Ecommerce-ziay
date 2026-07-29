// ───────────────────────────────────────────────────────────────────────────
// Integration credential registry — single source of truth for the UI panel.
//
// Each integration declares the credentials it needs (key + label + type +
// required + placeholder + helpText). The panel groups them by `category`
// (Catálogo, Logística, Pagos, Pauta, Canales, IA) and renders an input per
// field. Passwords are masked with show/hide toggles and never sent back in
// clear text from the API (only last 4 chars are returned for display).
//
// Storage convention:
//   Setting.key   = `cred::{integration.id}`
//   Setting.value = JSON.stringify({ [field.key]: rawValue })
//
// Masking convention (returned by GET):
//   configured: true if at least one required field is set
//   fields[field.key] = "••••" + last4   (or "" when not configured)
// ───────────────────────────────────────────────────────────────────────────

export type CredentialFieldType = 'text' | 'password' | 'url'

export interface CredentialField {
  /** Stable identifier persisted in the Setting JSON value. */
  key: string
  /** Human-readable label shown above the input. */
  label: string
  /** `password` triggers show/hide toggle + masks returned value. */
  type: CredentialFieldType
  /** When true, the panel badges "Pendiente" until all required fields are set. */
  required: boolean
  /** Optional placeholder shown in the input. */
  placeholder?: string
  /** Optional short help text rendered below the input. */
  helpText?: string
}

export type IntegrationCategory =
  | 'catalog'
  | 'logistics'
  | 'payments'
  | 'ads'
  | 'channels'
  | 'ai'

export interface IntegrationConfig {
  /** Stable identifier — used as the Setting key suffix (`cred::{id}`). */
  id: string
  /** Display name (Spanish, matches the rest of the UI). */
  name: string
  /** Emoji glyph rendered in the card header. */
  emoji: string
  /** Category used to group cards in the panel. */
  category: IntegrationCategory
  /** One-line description shown under the name. */
  description: string
  /** Ordered list of credential fields. */
  fields: CredentialField[]
}

// ───────────────────────────────────────────────────────────────────────────
// Category metadata (label + emoji) used by the panel header rows.
// ───────────────────────────────────────────────────────────────────────────
export const CATEGORY_META: Record<
  IntegrationCategory,
  { label: string; emoji: string; description: string }
> = {
  catalog:   { label: 'Catálogo',   emoji: '🛒', description: 'Adaptadores de catálogo ecommerce' },
  logistics: { label: 'Logística',  emoji: '🚚', description: 'Multitransportadoras CO' },
  payments:  { label: 'Pagos',      emoji: '💳', description: 'Gateways de pago y webhooks' },
  ads:       { label: 'Pauta',      emoji: '📢', description: 'Plataformas de pauta digital' },
  channels:  { label: 'Canales',    emoji: '💬', description: 'Canales de mensajería conversacional' },
  ai:        { label: 'IA',         emoji: '🤖', description: 'Proveedores de LLM y visión' },
}

export const CATEGORY_ORDER: IntegrationCategory[] = [
  'catalog', 'logistics', 'payments', 'ads', 'channels', 'ai',
]

// ───────────────────────────────────────────────────────────────────────────
// Registry — ALL 21 integrations across the 6 categories.
// ───────────────────────────────────────────────────────────────────────────
export const INTEGRATION_REGISTRY: IntegrationConfig[] = [
  // ── Catálogo (4) ────────────────────────────────────────────────────────
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    emoji: '🛒',
    category: 'catalog',
    description: 'Sincroniza productos desde WooCommerce via REST API',
    fields: [
      { key: 'storeUrl', label: 'URL de la tienda', type: 'url', required: true, placeholder: 'https://mitienda.com', helpText: 'URL base de la tienda sin /wp-json' },
      { key: 'consumerKey', label: 'Consumer Key', type: 'text', required: true, placeholder: 'ck_xxxxx' },
      { key: 'consumerSecret', label: 'Consumer Secret', type: 'password', required: true, placeholder: 'cs_xxxxx' },
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    emoji: '🅢',
    category: 'catalog',
    description: 'Sincroniza desde Shopify Admin API (GraphQL)',
    fields: [
      { key: 'shopDomain', label: 'Dominio de la tienda', type: 'text', required: true, placeholder: 'mitienda.myshopify.com', helpText: 'Solo el dominio, sin https://' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'shpat_xxxxx' },
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    emoji: '🗄️',
    category: 'catalog',
    description: 'Catálogo gestionado en Supabase (cliente o nuestro)',
    fields: [
      { key: 'url', label: 'Supabase URL', type: 'url', required: true, placeholder: 'https://xxxx.supabase.co' },
      { key: 'apiKey', label: 'API Key (service_role)', type: 'password', required: true, placeholder: 'eyJxxxx' },
    ],
  },
  {
    id: 'oracle',
    name: 'Oracle',
    emoji: '🔶',
    category: 'catalog',
    description: 'Catálogo legacy en Oracle (read-only)',
    fields: [
      { key: 'connectionString', label: 'Connection string', type: 'password', required: true, placeholder: 'oracle://user:pass@host:1521/service', helpText: 'Se ofusca al guardar' },
    ],
  },

  // ── Logística (3) ───────────────────────────────────────────────────────
  {
    id: 'dropi',
    name: 'Dropi',
    emoji: '📦',
    category: 'logistics',
    description: 'Multitransportadora CO (Servientrega, Coordinadora, TCC)',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'dropi_xxxxx' },
    ],
  },
  {
    id: '99envios',
    name: '99envios',
    emoji: '🚚',
    category: 'logistics',
    description: 'Multitransportadora CO con tarifa negociada',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: '99e_xxxxx' },
    ],
  },
  {
    id: 'aveonline',
    name: 'Aveonline',
    emoji: '✈️',
    category: 'logistics',
    description: 'Multitransportadora CO + internacional',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'ave_xxxxx' },
    ],
  },

  // ── Pagos (4) ───────────────────────────────────────────────────────────
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    emoji: '💰',
    category: 'payments',
    description: 'Checkout + webhooks CO/LATAM',
    fields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'APP_USR-xxxxx' },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false, placeholder: 'whk_xxxxx', helpText: 'Opcional — para verificar firma X-Signature' },
    ],
  },
  {
    id: 'wompi',
    name: 'Wompi',
    emoji: '🏦',
    category: 'payments',
    description: 'Gateway CO (Bancolombia) con eventos de webhook',
    fields: [
      { key: 'publicKey', label: 'Public Key', type: 'text', required: true, placeholder: 'pub_xxxxx' },
      { key: 'privateKey', label: 'Private Key', type: 'password', required: true, placeholder: 'prv_xxxxx' },
      { key: 'eventSecret', label: 'Event Secret', type: 'password', required: false, placeholder: 'evt_xxxxx', helpText: 'Opcional — verificación de eventos' },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    emoji: '💠',
    category: 'payments',
    description: 'Checkout internacional + signature verification',
    fields: [
      { key: 'secretKey', label: 'Secret Key', type: 'password', required: true, placeholder: 'sk_live_xxxxx' },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false, placeholder: 'whsec_xxxxx', helpText: 'Opcional — verificación stripe-signature' },
    ],
  },
  {
    id: 'payu',
    name: 'PayU',
    emoji: '💳',
    category: 'payments',
    description: 'Gateway LATAM con API login + merchant',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'payu_xxxxx' },
      { key: 'merchantId', label: 'Merchant ID', type: 'text', required: true, placeholder: '123456' },
      { key: 'apiLogin', label: 'API Login', type: 'password', required: true, placeholder: 'payu_login_xxxxx' },
    ],
  },

  // ── Pauta (3) ───────────────────────────────────────────────────────────
  {
    id: 'google_ads',
    name: 'Google Ads',
    emoji: '🔍',
    category: 'ads',
    description: 'Google Ads API con developer token',
    fields: [
      { key: 'developerToken', label: 'Developer Token', type: 'password', required: true, placeholder: 'devtok_xxxxx' },
      { key: 'accessToken', label: 'Access Token (OAuth)', type: 'password', required: true, placeholder: 'ya29.xxxxx' },
      { key: 'customerId', label: 'Customer ID', type: 'text', required: true, placeholder: '123-456-7890' },
    ],
  },
  {
    id: 'tiktok_ads',
    name: 'TikTok Ads',
    emoji: '🎵',
    category: 'ads',
    description: 'TikTok Marketing API',
    fields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'tt_xxxxx' },
      { key: 'advertiserId', label: 'Advertiser ID', type: 'text', required: true, placeholder: '1234567890' },
    ],
  },
  {
    id: 'meta_ads',
    name: 'Meta Ads',
    emoji: '📘',
    category: 'ads',
    description: 'Facebook Marketing API',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true, placeholder: '1234567890' },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: true, placeholder: 'appsec_xxxxx' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'EAAB_xxxxx' },
    ],
  },

  // ── Canales (3) ─────────────────────────────────────────────────────────
  {
    id: 'whatsapp',
    name: 'WhatsApp Cloud API',
    emoji: '💬',
    category: 'channels',
    description: 'WhatsApp Business Cloud API (Meta)',
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', required: true, placeholder: '1234567890' },
      { key: 'wabaId', label: 'WABA ID', type: 'text', required: true, placeholder: '1234567890', helpText: 'WhatsApp Business Account ID' },
      { key: 'apiToken', label: 'API Token', type: 'password', required: true, placeholder: 'EAAB_xxxxx' },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'password', required: true, placeholder: 'mi-token', helpText: 'Token que configuraste en el webhook de Meta' },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: false, placeholder: 'appsec_xxxxx', helpText: 'Opcional — verificación HMAC X-Hub-Signature-256' },
    ],
  },
  {
    id: 'messenger',
    name: 'Messenger',
    emoji: '📨',
    category: 'channels',
    description: 'Facebook Messenger Platform',
    fields: [
      { key: 'pageId', label: 'Page ID', type: 'text', required: true, placeholder: '1234567890' },
      { key: 'pageToken', label: 'Page Access Token', type: 'password', required: true, placeholder: 'EAAB_xxxxx' },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'password', required: true, placeholder: 'mi-token' },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: false, placeholder: 'appsec_xxxxx', helpText: 'Opcional — verificación HMAC' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram DM',
    emoji: '📸',
    category: 'channels',
    description: 'Instagram Messaging API (Business)',
    fields: [
      { key: 'accountId', label: 'IG Account ID', type: 'text', required: true, placeholder: '1784xxxxx' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'EAAB_xxxxx' },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'password', required: true, placeholder: 'mi-token' },
    ],
  },

  // ── IA (3) ──────────────────────────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    emoji: '🟢',
    category: 'ai',
    description: 'GPT-4 / GPT-4o para agentes conversacionales',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-proj-xxxxx' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    emoji: '✖️',
    category: 'ai',
    description: 'Grok para agentes conversacionales',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'xai-xxxxx' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    emoji: '🦙',
    category: 'ai',
    description: 'LLM local autohospedado (no requiere API key)',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'url', required: true, placeholder: 'http://localhost:11434', helpText: 'URL donde corre el servidor de Ollama' },
    ],
  },
]

// ───────────────────────────────────────────────────────────────────────────
// Helpers — shared by the API route and the UI panel.
// ───────────────────────────────────────────────────────────────────────────

/** Look up an integration config by id. */
export function getIntegrationById(id: string): IntegrationConfig | undefined {
  return INTEGRATION_REGISTRY.find((i) => i.id === id)
}

/** All integrations grouped by category, respecting CATEGORY_ORDER. */
export function getIntegrationsByCategory(): Record<IntegrationCategory, IntegrationConfig[]> {
  const grouped = {} as Record<IntegrationCategory, IntegrationConfig[]>
  for (const cat of CATEGORY_ORDER) grouped[cat] = []
  for (const integration of INTEGRATION_REGISTRY) {
    grouped[integration.category].push(integration)
  }
  return grouped
}

/**
 * Mask a secret value: keep the last 4 characters, prefix with 4 bullets.
 * Empty / short values become empty strings so the UI can distinguish
 * "not set" from "set but short".
 */
export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '••••'
  return '••••' + value.slice(-4)
}

/**
 * Determine whether an integration is "configured" — i.e. at least one
 * required field has a value. (Stricter interpretations can be added later
 * without touching the API contract.)
 */
export function isIntegrationConfigured(
  integration: IntegrationConfig,
  fields: Record<string, string>,
): boolean {
  const requiredKeys = integration.fields.filter((f) => f.required).map((f) => f.key)
  if (requiredKeys.length === 0) return Object.keys(fields).length > 0
  return requiredKeys.some((k) => Boolean(fields[k]))
}
