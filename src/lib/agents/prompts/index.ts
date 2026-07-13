// ZIAY — Agents prompts barrel + router
//
// Single source of truth for the 26 agent builders. Each agent lives in its
// own file under `prompts/{agentName}.ts`. This file re-exports them, plus
// the AGENT_NAMES / AGENT_LABELS / AgentContext types and the buildAgentPrompt
// router. The FALLBACKS map (one canned reply per agent, used when the LLM
// call fails) is also exported from here so every route that touches the
// agent pipeline can import a single, consistent fallback table.
//
// Backward-compat: `src/lib/agents/prompts.ts` re-exports everything from
// here, so existing imports of `@/lib/agents/prompts` keep working.

import type { AgentContext, AgentName } from './types'

// ── Re-export all 26 builders ────────────────────────────────────────────
export { buildProfilePrompt } from './profile'
export { buildSpeechPrompt } from './speech'
export { buildQuotePrompt } from './quote'
export { buildCatalogPrompt } from './catalog'
export { buildThemePrompt } from './theme'
export { buildObjectionPrompt } from './objection'
export { buildAddressPrompt } from './address'
export { buildLogisticsPrompt } from './logistics'
export { buildVisionPrompt } from './vision'
export { buildCheckoutPrompt } from './checkout'
// BUILD-AGENTS-LIB-001 — 16 new builders
export { buildBuyerBehaviorPrompt } from './buyer_behavior'
export { buildCartBuilderPrompt } from './cart_builder'
export { buildGuideTrackingPrompt } from './guide_tracking'
export { buildNovedadesPrompt } from './novedades'
export { buildRedeliveryPrompt } from './redelivery'
export { buildRemarketingPrompt } from './remarketing'
export { buildGuideAlertPrompt } from './guide_alert'
export { buildSalesRetainerPrompt } from './sales_retainer'
export { buildLogisticsNotifierPrompt } from './logistics_notifier'
export { buildCustomerScorePrompt } from './customer_score'
export { buildCarrierScorePrompt } from './carrier_score'
export { buildProductEnrichmentPrompt } from './product_enrichment'
export { buildMarketplacePrompt } from './marketplace'
export { buildAffiliatorPrompt } from './affiliator'
export { buildTrafficOrchestratorPrompt } from './traffic_orchestrator'
export { buildAddressAnalysisPrompt } from './address_analysis'

// ── Types ─────────────────────────────────────────────────────────────────
export type { AgentContext, AgentName } from './types'

// ── Eager imports (needed by the router + labels below) ───────────────────
import { buildProfilePrompt } from './profile'
import { buildSpeechPrompt } from './speech'
import { buildQuotePrompt } from './quote'
import { buildCatalogPrompt } from './catalog'
import { buildThemePrompt } from './theme'
import { buildObjectionPrompt } from './objection'
import { buildAddressPrompt } from './address'
import { buildLogisticsPrompt } from './logistics'
import { buildVisionPrompt } from './vision'
import { buildCheckoutPrompt } from './checkout'
import { buildBuyerBehaviorPrompt } from './buyer_behavior'
import { buildCartBuilderPrompt } from './cart_builder'
import { buildGuideTrackingPrompt } from './guide_tracking'
import { buildNovedadesPrompt } from './novedades'
import { buildRedeliveryPrompt } from './redelivery'
import { buildRemarketingPrompt } from './remarketing'
import { buildGuideAlertPrompt } from './guide_alert'
import { buildSalesRetainerPrompt } from './sales_retainer'
import { buildLogisticsNotifierPrompt } from './logistics_notifier'
import { buildCustomerScorePrompt } from './customer_score'
import { buildCarrierScorePrompt } from './carrier_score'
import { buildProductEnrichmentPrompt } from './product_enrichment'
import { buildMarketplacePrompt } from './marketplace'
import { buildAffiliatorPrompt } from './affiliator'
import { buildTrafficOrchestratorPrompt } from './traffic_orchestrator'
import { buildAddressAnalysisPrompt } from './address_analysis'

// ── Router — dispatches to the right builder ─────────────────────────────
export async function buildAgentPrompt(agentName: AgentName, ctx: AgentContext): Promise<{ system: string; user: string }> {
  switch (agentName) {
    case 'profile': return buildProfilePrompt(ctx)
    case 'speech': return buildSpeechPrompt(ctx)
    case 'quote': return buildQuotePrompt(ctx)
    case 'catalog': return buildCatalogPrompt(ctx)
    case 'theme': return buildThemePrompt(ctx)
    case 'objection': return buildObjectionPrompt(ctx)
    case 'address': return buildAddressPrompt(ctx)
    case 'logistics': return buildLogisticsPrompt(ctx)
    case 'vision': return buildVisionPrompt(ctx)
    case 'checkout': return buildCheckoutPrompt(ctx)
    // BUILD-AGENTS-LIB-001 — 16 new agents
    case 'buyer_behavior': return buildBuyerBehaviorPrompt(ctx)
    case 'cart_builder': return buildCartBuilderPrompt(ctx)
    case 'guide_tracking': return buildGuideTrackingPrompt(ctx)
    case 'novedades': return buildNovedadesPrompt(ctx)
    case 'redelivery': return buildRedeliveryPrompt(ctx)
    case 'remarketing': return buildRemarketingPrompt(ctx)
    case 'guide_alert': return buildGuideAlertPrompt(ctx)
    case 'sales_retainer': return buildSalesRetainerPrompt(ctx)
    case 'logistics_notifier': return buildLogisticsNotifierPrompt(ctx)
    case 'customer_score': return buildCustomerScorePrompt(ctx)
    case 'carrier_score': return buildCarrierScorePrompt(ctx)
    case 'product_enrichment': return buildProductEnrichmentPrompt(ctx)
    case 'marketplace': return buildMarketplacePrompt(ctx)
    case 'affiliator': return buildAffiliatorPrompt(ctx)
    case 'traffic_orchestrator': return buildTrafficOrchestratorPrompt(ctx)
    case 'address_analysis': return buildAddressAnalysisPrompt(ctx)
    default: throw new Error(`Unknown agent: ${agentName}`)
  }
}

export const AGENT_NAMES: AgentName[] = [
  // Existing 10
  'profile', 'speech', 'quote', 'catalog', 'theme', 'objection', 'address', 'logistics', 'vision', 'checkout',
  // BUILD-AGENTS-LIB-001 — 16 new
  'buyer_behavior', 'cart_builder',
  'guide_tracking', 'novedades', 'redelivery', 'remarketing', 'guide_alert', 'sales_retainer', 'logistics_notifier',
  'customer_score', 'carrier_score', 'product_enrichment', 'marketplace', 'affiliator', 'traffic_orchestrator',
  'address_analysis',
]

export const AGENT_LABELS: Record<AgentName, string> = {
  // Existing 10
  profile: 'Perfilamiento de leads',
  speech: 'Discurso de ventas por perfil',
  quote: 'Ofertas y cotización cruzada',
  catalog: 'Respuesta visual-primero',
  theme: 'Oferta por tema/personaje',
  objection: 'Manejo de objeciones',
  address: 'Confirmación de datos (10 campos)',
  logistics: 'Logística de fletes',
  vision: 'Visión (identificación por imagen)',
  checkout: 'Checkout y sincronización',
  // BUILD-AGENTS-LIB-001 — 16 new
  buyer_behavior: 'Análisis de comportamiento de compra',
  cart_builder: 'Constructor de carrito desde lenguaje natural',
  guide_tracking: 'Seguimiento de guía',
  novedades: 'Manejo de novedades logísticas',
  redelivery: 'Coordinación de re-entrega',
  remarketing: 'Re-enganche de leads fríos',
  guide_alert: 'Alertas operativas de guías',
  sales_retainer: 'Retención de ventas en riesgo',
  logistics_notifier: 'Notificaciones proactivas logísticas',
  customer_score: 'Scoring de clientes (LTV/churn)',
  carrier_score: 'Scoring de transportadoras',
  product_enrichment: 'Enriquecimiento de catálogo (SEO/alt)',
  marketplace: 'Sincronización con marketplaces',
  affiliator: 'Gestión de afiliados e influencers',
  traffic_orchestrator: 'Orquestador de tráfico pagado',
  address_analysis: 'Análisis de calidad de dirección',
}

// ── FALLBACKS — canned reply per agent when the LLM call fails ────────────
//
// Moved here from src/app/api/orchestrate/route.ts so every route that
// touches the agent pipeline (orchestrate, /api/agents/[agentName], …)
// can share the same fallback table. No content changes — bytes-for-bytes
// identical to what used to live inline in the orchestrate route.
export const FALLBACKS: Record<AgentName, string> = {
  profile: ' mayorista',
  speech: '¡Hola! ¿Qué producto te interesa?',
  quote: '¿Qué productos y cantidades quieres cotizar?',
  catalog: '¿Qué tema o producto buscas?',
  theme: '¿Qué personaje o tema te gusta?',
  objection: 'Entiendo. ¿Te confirmo el pedido?',
  address: '¿Cuál es tu ciudad y dirección completa?',
  logistics: '¿A qué ciudad enviamos y cuántas unidades?',
  vision: 'Por favor envíame una foto clara del producto para identificarlo.',
  checkout: '¿Confirmas el pedido?',
  // BUILD-AGENTS-LIB-001 — 16 new agent fallbacks (generic)
  buyer_behavior: 'Déjame revisar tu historial para recomendarte la mejor opción.',
  cart_builder: '¿Qué productos y cantidades quieres agregar al carrito?',
  guide_tracking: '¿Me compartes el número de guía o pedido para rastrearlo?',
  novedades: 'Tengo una novedad con tu envío, ¿me confirmas tu dirección actual?',
  redelivery: 'Para re-agendar la entrega, ¿qué horario te queda mejor?',
  remarketing: '¡Hola! Tengo una novedad que te puede interesar, ¿te acuerdo?',
  guide_alert: 'Alerta operativa generada — el equipo revisará el caso.',
  sales_retainer: 'Entiendo. ¿Te ofrezco pago contra entrega para que no pierdas el producto?',
  logistics_notifier: 'Tu pedido va en camino — te aviso en cada hito.',
  customer_score: 'Calculando score de cliente…',
  carrier_score: 'Calculando score de transportadoras…',
  product_enrichment: 'Enriqueciendo producto…',
  marketplace: 'Evaluando viabilidad de publicación en marketplace…',
  affiliator: 'Procesando atribución de afiliado…',
  traffic_orchestrator: 'Analizando redistribución de presupuesto…',
  address_analysis: 'Analizando calidad de la dirección…',
}
