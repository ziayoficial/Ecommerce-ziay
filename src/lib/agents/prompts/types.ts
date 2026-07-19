// ZIAY — Shared agent types (Saramantha §6 spec)
//
// Each agent is a function that builds the system prompt from Tenant config +
// business tables (regla de oro §2: NUNCA business data in prompt text —
// always fetched from DB filtered by tenantId).
//
// v0.4.1 — Consolidación IA-3:
//   - Removed: guide_tracking, guide_alert, logistics_notifier,
//     customer_score, carrier_score, address_analysis, theme, cart_builder.
//   - Added:   postventa_logistics, scoring.
//   - Enhanced: address (now does collect + analyze), catalog (now does
//     general + theme search), quote (now does cart + quote).
//   Net: 26 → 20 agents.
//
// IA-1 (agent-builder) — +4 cross-cutting control-plane agents:
//   governor       (safety/budget gate — runs FIRST on every message)
//   qa_reviewer    (Reflexion critique+revise on revenue-critical outputs)
//   memory_curator (async long-term fact extraction → CustomerMemory)
//   sentiment      (customer-state classification: frustration/intent/churn)
//   Net: 20 → 24 agents.

export type AgentName =
  // Existing core 10 (theme + cart_builder merged into catalog/quote)
  | 'profile' | 'speech' | 'quote' | 'catalog' | 'objection'
  | 'address' | 'logistics' | 'vision' | 'checkout'
  // Pre-venta extendidos (cart_builder merged into quote)
  | 'buyer_behavior'
  // Post-venta (consolidados IA-3: 3 → 1)
  | 'novedades' | 'redelivery' | 'remarketing'
  | 'postventa_logistics' // = guide_tracking + guide_alert + logistics_notifier
  | 'sales_retainer'
  // Inteligencia de negocio (consolidados IA-3: 2 → 1)
  | 'scoring' // = customer_score + carrier_score
  | 'product_enrichment'
  | 'marketplace' | 'affiliator' | 'traffic_orchestrator'
  // IA-1 (agent-builder) — control-plane agents
  | 'governor' | 'qa_reviewer' | 'memory_curator' | 'sentiment'

export interface AgentContext {
  tenantId: string
  conversationId?: string
  customerId?: string
  perfil?: string // mayorista | emprendedor | detal | regalo
  // ISO country code for country-specific agents (CO, MX, ES, DE, …).
  // Used by `address` (analyze mode) and other locale-aware agents to pick
  // the right address-validation rules / carrier set.
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
  // ─── Extended context for new agents ───
  // Post-venta: order / shipment references
  orderId?: string
  shipmentId?: string
  guia?: string // número de guía del proveedor logístico
  novedadTipo?: string // tipo de novedad reportada por la transportadora
  // Cart builder (now folded into quote): carrito natural-language items
  cartItems?: { sku: string; cantidad: number; diseno?: string }[]
  // Inteligencia: references
  adId?: string
  campaignId?: string
  productId?: string
  affiliateId?: string
  carrierId?: string
  // ─── Consolidación IA-3 — discriminator fields ───
  /** `postventa_logistics` mode: tracking (default for shipmentId/guia),
   *  alert (default), notification (default for novedadTipo). */
  mode?: 'tracking' | 'alert' | 'notification' | 'collect' | 'analyze' | 'quote' | 'cart'
  /** `scoring` target: customer (default for customerId), carrier (default). */
  target?: 'customer' | 'carrier'
  /** `catalog` theme filter: si está presente, el agente busca por tema en
   *  `temas_diseño` en vez de hacer búsqueda general por `query`. */
  theme?: string
}
