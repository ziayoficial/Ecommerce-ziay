// ZIAY — Shared agent types (Saramantha §6 spec)
//
// Each agent is a function that builds the system prompt from Tenant config +
// business tables (regla de oro §2: NUNCA business data in prompt text —
// always fetched from DB filtered by tenantId).

export type AgentName =
  | 'profile' | 'speech' | 'quote' | 'catalog' | 'theme'
  | 'objection' | 'address' | 'logistics' | 'vision' | 'checkout'
  // Pre-venta extendidos (Saramantha §6 — añadidos BUILD-AGENTS-LIB-001)
  | 'buyer_behavior' | 'cart_builder'
  // Post-venta (Saramantha §8 — añadidos BUILD-AGENTS-LIB-001)
  | 'guide_tracking' | 'novedades' | 'redelivery' | 'remarketing'
  | 'guide_alert' | 'sales_retainer' | 'logistics_notifier'
  // Inteligencia de negocio (Saramantha §17 — añadidos BUILD-AGENTS-LIB-001)
  | 'customer_score' | 'carrier_score' | 'product_enrichment'
  | 'marketplace' | 'affiliator' | 'traffic_orchestrator'
  // Especializados (Saramantha §9 — añadidos BUILD-AGENTS-LIB-001)
  | 'address_analysis'

export interface AgentContext {
  tenantId: string
  conversationId?: string
  customerId?: string
  perfil?: string // mayorista | emprendedor | detal | regalo
  // ISO country code for country-specific agents (CO, MX, ES, DE, …).
  // Used by `address_analysis` and other locale-aware agents to pick the
  // right address-validation rules / carrier set.
  country?: string
  // For vision agent: incoming image URL
  imageUrl?: string
  // For quote agent: items to quote
  items?: { sku: string; cantidad: number }[]
  // For catalog agent: search query
  query?: string
  // For objection agent: the objection message
  message?: string
  // For address agent: extracted/partial address
  partialAddress?: Record<string, string>
  // ─── Extended context for new agents (BUILD-AGENTS-LIB-001) ───
  // Post-venta: order / shipment references
  orderId?: string
  shipmentId?: string
  guia?: string // número de guía del proveedor logístico
  novedadTipo?: string // tipo de novedad reportada por la transportadora
  // Cart builder: carrito natural-language items
  cartItems?: { sku: string; cantidad: number; diseno?: string }[]
  // Inteligencia: references
  adId?: string
  campaignId?: string
  productId?: string
  affiliateId?: string
  carrierId?: string
}
