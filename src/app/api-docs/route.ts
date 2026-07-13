import { NextResponse } from 'next/server'

// ───────────────────────────────────────────────────────────────────────────
// GET /api-docs — auto-documented API surface for ZIAY
// SPRINT5-FINAL-001 · Part 2
//
// This is intentionally a static manifest rather than a filesystem scanner:
//   • A scanner would need to `require()` every route module to read the
//     exported HTTP verbs, which is fragile across ESM/CJS and slow on a
//     cold start.
//   • The descriptions below carry business context ("List active tenants",
//     "Run single agent") that can't be inferred from the source.
//
// To add a new route: append it to `ROUTES` below. The total counter and
// JSON response update automatically.
// ───────────────────────────────────────────────────────────────────────────

interface ApiDoc {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  description: string
  /** `true` if the handler requires an authenticated session. */
  auth: boolean
  /** Tag for grouping in a future Swagger UI view. */
  group: string
}

const ROUTES: ApiDoc[] = [
  // ── Root ──────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api', description: 'API root — basic service info', auth: false, group: 'meta' },

  // ── Health & observability ────────────────────────────────────────────
  { method: 'GET', path: '/api/health', description: 'Full health check (DB, Redis, adapters, runtime)', auth: false, group: 'health' },
  { method: 'GET', path: '/api/health/live', description: 'Liveness probe — process is up', auth: false, group: 'health' },
  { method: 'GET', path: '/api/health/ready', description: 'Readiness probe — ready to accept traffic', auth: false, group: 'health' },
  { method: 'GET', path: '/api/health/uptime', description: 'Process uptime + version info', auth: false, group: 'health' },

  // ── Auth ──────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/auth/[...nextauth]', description: 'NextAuth.js — sign-in, callback, session', auth: false, group: 'auth' },
  { method: 'POST', path: '/api/auth/[...nextauth]', description: 'NextAuth.js — credentials submit, signout', auth: false, group: 'auth' },

  // ── Tenants & agents ──────────────────────────────────────────────────
  { method: 'GET', path: '/api/tenants', description: 'List active tenants', auth: true, group: 'tenants' },
  { method: 'GET', path: '/api/agents', description: 'List all 26 agents and their metadata', auth: true, group: 'agents' },
  { method: 'GET', path: '/api/agents/[agentName]', description: 'Get a single agent definition', auth: true, group: 'agents' },
  { method: 'POST', path: '/api/agents/[agentName]', description: 'Run a single agent with the supplied input', auth: true, group: 'agents' },
  { method: 'POST', path: '/api/orchestrate', description: 'Run the traffic orchestrator across agents', auth: true, group: 'agents' },

  // ── Overview & KPIs ───────────────────────────────────────────────────
  { method: 'GET', path: '/api/overview', description: 'Dashboard KPIs (GMV, orders, agents, incidents)', auth: true, group: 'dashboard' },
  { method: 'GET', path: '/api/trafficker', description: 'List trafficker ad accounts', auth: true, group: 'dashboard' },
  { method: 'POST', path: '/api/trafficker', description: 'Create / update trafficker record', auth: true, group: 'dashboard' },

  // ── Orders & payments ─────────────────────────────────────────────────
  { method: 'GET', path: '/api/orders', description: 'List orders with optional filters', auth: true, group: 'orders' },
  { method: 'PATCH', path: '/api/orders/[id]', description: 'Update order status / payment state', auth: true, group: 'orders' },
  { method: 'GET', path: '/api/payments/config', description: 'Get enabled payment gateways per tenant', auth: true, group: 'payments' },
  { method: 'PATCH', path: '/api/payments/config', description: 'Enable / disable a gateway for a tenant', auth: true, group: 'payments' },
  { method: 'POST', path: '/api/payments/create-link', description: 'Create a payment link (Stripe / MP / Wompi / PayU)', auth: true, group: 'payments' },

  // ── Conversations & messaging ─────────────────────────────────────────
  { method: 'GET', path: '/api/conversations', description: 'List conversations', auth: true, group: 'messenger' },
  { method: 'POST', path: '/api/conversations', description: 'Create a new conversation', auth: true, group: 'messenger' },
  { method: 'GET', path: '/api/conversations/[id]', description: 'Get a conversation with messages', auth: true, group: 'messenger' },
  { method: 'PATCH', path: '/api/conversations/[id]', description: 'Update conversation status / assignee', auth: true, group: 'messenger' },
  { method: 'POST', path: '/api/ai-reply', description: 'Generate an AI reply for a conversation', auth: true, group: 'messenger' },
  { method: 'GET', path: '/api/channels', description: 'List configured channels (WhatsApp, IG, Web)', auth: true, group: 'messenger' },
  { method: 'POST', path: '/api/channels', description: 'Add a channel', auth: true, group: 'messenger' },
  { method: 'PATCH', path: '/api/channels', description: 'Update a channel', auth: true, group: 'messenger' },
  { method: 'DELETE', path: '/api/channels', description: 'Remove a channel', auth: true, group: 'messenger' },
  { method: 'GET', path: '/api/notifications', description: 'List user notifications', auth: true, group: 'messenger' },
  { method: 'POST', path: '/api/notifications', description: 'Create / dispatch a notification', auth: true, group: 'messenger' },

  // ── Catalog ───────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/catalog/products', description: 'List catalog products', auth: true, group: 'catalog' },
  { method: 'POST', path: '/api/catalog/sync', description: 'Trigger a catalog sync from the e-commerce adapter', auth: true, group: 'catalog' },
  { method: 'POST', path: '/api/catalog/send-to-chat', description: 'Send a product card to a conversation', auth: true, group: 'catalog' },
  { method: 'GET', path: '/api/product-enrichment', description: 'List product enrichment suggestions', auth: true, group: 'catalog' },
  { method: 'POST', path: '/api/product-enrichment', description: 'Run the product enrichment agent', auth: true, group: 'catalog' },

  // ── Public catalog (no auth) ──────────────────────────────────────────
  { method: 'GET', path: '/api/public/tenants', description: 'Public tenant lookup (slug → tenantId)', auth: false, group: 'public' },
  { method: 'GET', path: '/api/public/catalog', description: 'Public storefront catalog', auth: false, group: 'public' },

  // ── Logistics ─────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/logistics-intelligence', description: 'Logistics intelligence summary', auth: true, group: 'logistics' },
  { method: 'POST', path: '/api/shipping/quote', description: 'Quote shipping cost across carriers', auth: true, group: 'logistics' },
  { method: 'POST', path: '/api/shipping/guide', description: 'Generate a shipping guide (label)', auth: true, group: 'logistics' },
  { method: 'GET', path: '/api/guide-movements', description: 'List tracking events for a guide', auth: true, group: 'logistics' },
  { method: 'POST', path: '/api/guide-movements', description: 'Ingest a guide tracking event', auth: true, group: 'logistics' },
  { method: 'GET', path: '/api/redelivery', description: 'List redelivery attempts', auth: true, group: 'logistics' },
  { method: 'POST', path: '/api/redelivery', description: 'Create a redelivery request', auth: true, group: 'logistics' },
  { method: 'PATCH', path: '/api/redelivery', description: 'Update a redelivery status', auth: true, group: 'logistics' },

  // ── Novedades (incidents) ─────────────────────────────────────────────
  { method: 'GET', path: '/api/novedades', description: 'List shipping incidents', auth: true, group: 'incidents' },
  { method: 'POST', path: '/api/novedades', description: 'Create an incident', auth: true, group: 'incidents' },
  { method: 'PATCH', path: '/api/novedades', description: 'Bulk update incidents', auth: true, group: 'incidents' },
  { method: 'GET', path: '/api/novedades/[id]', description: 'Get a single incident', auth: true, group: 'incidents' },
  { method: 'PATCH', path: '/api/novedades/[id]', description: 'Update an incident', auth: true, group: 'incidents' },

  // ── Ads & attribution ─────────────────────────────────────────────────
  { method: 'GET', path: '/api/ads', description: 'List ad spend records', auth: true, group: 'ads' },
  { method: 'POST', path: '/api/ads/import', description: 'Bulk import ad spend (CSV / JSON)', auth: true, group: 'ads' },
  { method: 'PATCH', path: '/api/ads/[id]', description: 'Update an ad spend record', auth: true, group: 'ads' },
  { method: 'GET', path: '/api/conversions', description: 'List attributed conversions', auth: true, group: 'ads' },
  { method: 'POST', path: '/api/conversions', description: 'Create / attribute a conversion', auth: true, group: 'ads' },
  { method: 'GET', path: '/api/buyer-behavior', description: 'List buyer behavior analyses', auth: true, group: 'ads' },
  { method: 'POST', path: '/api/buyer-behavior', description: 'Run the buyer behavior agent', auth: true, group: 'ads' },

  // ── Monetization & wallet ─────────────────────────────────────────────
  { method: 'GET', path: '/api/monetization/gmv', description: 'GMV report', auth: true, group: 'monetization' },
  { method: 'GET', path: '/api/monetization/commission', description: 'Commission summary', auth: true, group: 'monetization' },
  { method: 'POST', path: '/api/monetization/commission', description: 'Record / adjust a commission', auth: true, group: 'monetization' },
  { method: 'POST', path: '/api/monetization/generate-invoice', description: 'Generate a PDF invoice', auth: true, group: 'monetization' },
  { method: 'GET', path: '/api/wallet', description: 'Wallet balance & ledger', auth: true, group: 'wallet' },
  { method: 'POST', path: '/api/wallet', description: 'Credit / debit the wallet', auth: true, group: 'wallet' },

  // ── Marketplace & remarketing ─────────────────────────────────────────
  { method: 'GET', path: '/api/marketplace', description: 'List marketplace listings', auth: true, group: 'marketplace' },
  { method: 'POST', path: '/api/marketplace', description: 'Create a marketplace listing', auth: true, group: 'marketplace' },
  { method: 'GET', path: '/api/remarketing', description: 'List remarketing campaigns', auth: true, group: 'remarketing' },
  { method: 'POST', path: '/api/remarketing', description: 'Create a remarketing campaign', auth: true, group: 'remarketing' },
  { method: 'PATCH', path: '/api/remarketing', description: 'Update a remarketing campaign', auth: true, group: 'remarketing' },

  // ── Integrations ──────────────────────────────────────────────────────
  { method: 'GET', path: '/api/integrations/credentials', description: 'List integration credentials (masked)', auth: true, group: 'integrations' },
  { method: 'POST', path: '/api/integrations/credentials', description: 'Create a credential entry', auth: true, group: 'integrations' },
  { method: 'PUT', path: '/api/integrations/credentials', description: 'Replace a credential entry', auth: true, group: 'integrations' },
  { method: 'DELETE', path: '/api/integrations/credentials', description: 'Delete a credential entry', auth: true, group: 'integrations' },

  // ── Webhooks (no auth — signed by gateway) ────────────────────────────
  { method: 'GET', path: '/api/webhooks/whatsapp', description: 'WhatsApp webhook verification handshake', auth: false, group: 'webhooks' },
  { method: 'POST', path: '/api/webhooks/whatsapp', description: 'WhatsApp inbound message / status webhook', auth: false, group: 'webhooks' },
  { method: 'GET', path: '/api/webhooks/meta', description: 'Meta (Instagram) webhook verification', auth: false, group: 'webhooks' },
  { method: 'POST', path: '/api/webhooks/meta', description: 'Meta inbound webhook', auth: false, group: 'webhooks' },
  { method: 'POST', path: '/api/webhooks/mercadopago', description: 'MercadoPago payment webhook', auth: false, group: 'webhooks' },
  { method: 'POST', path: '/api/webhooks/wompi', description: 'Wompi payment webhook', auth: false, group: 'webhooks' },
  { method: 'POST', path: '/api/webhooks/stripe', description: 'Stripe payment webhook', auth: false, group: 'webhooks' },
  { method: 'POST', path: '/api/webhooks/payu', description: 'PayU payment webhook', auth: false, group: 'webhooks' },
]

// ── Group counts (one cheap reduce over the static array) ──────────────────
const byGroup = ROUTES.reduce<Record<string, number>>((acc, r) => {
  acc[r.group] = (acc[r.group] || 0) + 1
  return acc
}, {})

const byMethod = ROUTES.reduce<Record<string, number>>((acc, r) => {
  acc[r.method] = (acc[r.method] || 0) + 1
  return acc
}, {})

export async function GET() {
  return NextResponse.json({
    name: 'ZIAY API',
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    total: ROUTES.length,
    summary: {
      by_method: byMethod,
      by_group: byGroup,
      auth_required: ROUTES.filter((r) => r.auth).length,
      public: ROUTES.filter((r) => !r.auth).length,
    },
    routes: ROUTES,
    docs: 'https://ziay.co/docs',
    openapi_hint:
      'Wrap this manifest in an OpenAPI 3.1 document by mapping each route to a path item — see PRODUCTION-CHECKLIST.md.',
  })
}
