// ZIAY — Agents prompts barrel + router
//
// Single source of truth for the consolidated agent builders (v0.4.1 · IA-3).
// Each agent lives in its own file under `prompts/{agentName}.ts`. This file
// re-exports them, plus the AGENT_NAMES / AGENT_LABELS / AgentContext types
// and the buildAgentPrompt router. The FALLBACKS map (one canned reply per
// agent, used when the LLM call fails) is also exported from here so every
// route that touches the agent pipeline can import a single, consistent
// fallback table.
//
// v0.4.1 · Consolidación IA-3:
//   - Removed 8 redundant agents (guide_tracking, guide_alert,
//     logistics_notifier, customer_score, carrier_score, address_analysis,
//     theme, cart_builder).
//   - Added 2 merged agents (postventa_logistics, scoring).
//   - Enhanced 3 existing agents (address, catalog, quote) with the
//     merged-in logic via `ctx.mode` / `ctx.theme`.
//   Net: 26 → 20 agents.
//
// IA-1 (agent-builder) — +4 control-plane agents:
//   governor       (safety/budget gate — runs FIRST on every message)
//   qa_reviewer    (Reflexion critique+revise on revenue-critical outputs)
//   memory_curator (async long-term fact extraction → CustomerMemory)
//   sentiment      (customer-state classification: frustration/intent/churn)
//   Net: 20 → 24 agents.
//
// Backward-compat: `src/lib/agents/prompts.ts` re-exports everything from
// here, so existing imports of `@/lib/agents/prompts` keep working.

import type { AgentContext, AgentName } from './types'

// ── Re-export all builders ──────────────────────────────────────────────
export { buildProfilePrompt } from './profile'
export { buildSpeechPrompt } from './speech'
export { buildQuotePrompt } from './quote'
export { buildCatalogPrompt } from './catalog'
export { buildObjectionPrompt } from './objection'
export { buildAddressPrompt } from './address'
export { buildLogisticsPrompt } from './logistics'
export { buildVisionPrompt } from './vision'
export { buildCheckoutPrompt } from './checkout'
export { buildBuyerBehaviorPrompt } from './buyer_behavior'
export { buildNovedadesPrompt } from './novedades'
export { buildRedeliveryPrompt } from './redelivery'
export { buildRemarketingPrompt } from './remarketing'
export { buildSalesRetainerPrompt } from './sales_retainer'
export { buildPostventaLogisticsPrompt } from './postventa_logistics'
export { buildScoringPrompt } from './scoring'
export { buildProductEnrichmentPrompt } from './product_enrichment'
export { buildMarketplacePrompt } from './marketplace'
export { buildAffiliatorPrompt } from './affiliator'
export { buildTrafficOrchestratorPrompt } from './traffic_orchestrator'
// IA-1 (agent-builder) — 4 control-plane agents
export { buildGovernorPrompt } from './governor'
export { buildQAReviewerPrompt } from './qa_reviewer'
export { buildMemoryCuratorPrompt } from './memory_curator'
export { buildSentimentPrompt } from './sentiment'

// ── Types ─────────────────────────────────────────────────────────────────
export type { AgentContext, AgentName } from './types'

// ── Eager imports (needed by the router + labels below) ───────────────────
import { buildProfilePrompt } from './profile'
import { buildSpeechPrompt } from './speech'
import { buildQuotePrompt } from './quote'
import { buildCatalogPrompt } from './catalog'
import { buildObjectionPrompt } from './objection'
import { buildAddressPrompt } from './address'
import { buildLogisticsPrompt } from './logistics'
import { buildVisionPrompt } from './vision'
import { buildCheckoutPrompt } from './checkout'
import { buildBuyerBehaviorPrompt } from './buyer_behavior'
import { buildNovedadesPrompt } from './novedades'
import { buildRedeliveryPrompt } from './redelivery'
import { buildRemarketingPrompt } from './remarketing'
import { buildSalesRetainerPrompt } from './sales_retainer'
import { buildPostventaLogisticsPrompt } from './postventa_logistics'
import { buildScoringPrompt } from './scoring'
import { buildProductEnrichmentPrompt } from './product_enrichment'
import { buildMarketplacePrompt } from './marketplace'
import { buildAffiliatorPrompt } from './affiliator'
import { buildTrafficOrchestratorPrompt } from './traffic_orchestrator'
import { buildGovernorPrompt } from './governor'
import { buildQAReviewerPrompt } from './qa_reviewer'
import { buildMemoryCuratorPrompt } from './memory_curator'
import { buildSentimentPrompt } from './sentiment'

// ── Router — dispatches to the right builder ─────────────────────────────
export async function buildAgentPrompt(agentName: AgentName, ctx: AgentContext): Promise<{ system: string; user: string }> {
  switch (agentName) {
    case 'profile': return buildProfilePrompt(ctx)
    case 'speech': return buildSpeechPrompt(ctx)
    case 'quote': return buildQuotePrompt(ctx)
    case 'catalog': return buildCatalogPrompt(ctx)
    case 'objection': return buildObjectionPrompt(ctx)
    case 'address': return buildAddressPrompt(ctx)
    case 'logistics': return buildLogisticsPrompt(ctx)
    case 'vision': return buildVisionPrompt(ctx)
    case 'checkout': return buildCheckoutPrompt(ctx)
    case 'buyer_behavior': return buildBuyerBehaviorPrompt(ctx)
    case 'novedades': return buildNovedadesPrompt(ctx)
    case 'redelivery': return buildRedeliveryPrompt(ctx)
    case 'remarketing': return buildRemarketingPrompt(ctx)
    case 'sales_retainer': return buildSalesRetainerPrompt(ctx)
    case 'postventa_logistics': return buildPostventaLogisticsPrompt(ctx)
    case 'scoring': return buildScoringPrompt(ctx)
    case 'product_enrichment': return buildProductEnrichmentPrompt(ctx)
    case 'marketplace': return buildMarketplacePrompt(ctx)
    case 'affiliator': return buildAffiliatorPrompt(ctx)
    case 'traffic_orchestrator': return buildTrafficOrchestratorPrompt(ctx)
    // IA-1 (agent-builder) — control-plane agents
    case 'governor': return buildGovernorPrompt(ctx)
    case 'qa_reviewer': return buildQAReviewerPrompt(ctx)
    case 'memory_curator': return buildMemoryCuratorPrompt(ctx)
    case 'sentiment': return buildSentimentPrompt(ctx)
    default: throw new Error(`Unknown agent: ${agentName}`)
  }
}

export const AGENT_NAMES: AgentName[] = [
  // Core 9 (theme folded into catalog, cart_builder folded into quote)
  'profile', 'speech', 'quote', 'catalog', 'objection',
  'address', 'logistics', 'vision', 'checkout',
  // Pre-venta
  'buyer_behavior',
  // Post-venta (consolidados IA-3: 3 → 1)
  'novedades', 'redelivery', 'remarketing', 'sales_retainer',
  'postventa_logistics',
  // Inteligencia de negocio (consolidados IA-3: 2 → 1)
  'scoring',
  'product_enrichment', 'marketplace', 'affiliator', 'traffic_orchestrator',
  // IA-1 (agent-builder) — control-plane agents
  'governor', 'qa_reviewer', 'memory_curator', 'sentiment',
]

export const AGENT_LABELS: Record<AgentName, string> = {
  profile: 'Perfilamiento de leads',
  speech: 'Discurso de ventas por perfil',
  quote: 'Ofertas + cotización + constructor de carrito',
  catalog: 'Catálogo visual-primero + búsqueda por tema',
  objection: 'Manejo de objeciones',
  address: 'Confirmación de datos + análisis de dirección',
  logistics: 'Logística de fletes',
  vision: 'Visión (identificación por imagen)',
  checkout: 'Checkout y sincronización',
  buyer_behavior: 'Análisis de comportamiento de compra',
  novedades: 'Manejo de novedades logísticas',
  redelivery: 'Coordinación de re-entrega',
  remarketing: 'Re-enganche de leads fríos',
  sales_retainer: 'Retención de ventas en riesgo',
  postventa_logistics: 'Post-venta logística (tracking + alertas + notificaciones)',
  scoring: 'Scoring de clientes y transportadoras',
  product_enrichment: 'Enriquecimiento de catálogo (SEO/alt)',
  marketplace: 'Sincronización con marketplaces',
  affiliator: 'Gestión de afiliados e influencers',
  traffic_orchestrator: 'Orquestador de tráfico pagado',
  // IA-1 (agent-builder) — control-plane agents
  governor: 'Gobernador (safety gate)',
  qa_reviewer: 'QA Reviewer (auto-reflexión)',
  memory_curator: 'Curador de memoria (long-term)',
  sentiment: 'Análisis de sentimiento',
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
  objection: 'Entiendo. ¿Te confirmo el pedido?',
  address: '¿Cuál es tu ciudad y dirección completa?',
  logistics: '¿A qué ciudad enviamos y cuántas unidades?',
  vision: 'Por favor envíame una foto clara del producto para identificarlo.',
  checkout: '¿Confirmas el pedido?',
  buyer_behavior: 'Déjame revisar tu historial para recomendarte la mejor opción.',
  novedades: 'Tengo una novedad con tu envío, ¿me confirmas tu dirección actual?',
  redelivery: 'Para re-agendar la entrega, ¿qué horario te queda mejor?',
  remarketing: '¡Hola! Tengo una novedad que te puede interesar, ¿te acuerdo?',
  sales_retainer: 'Entiendo. ¿Te ofrezco pago contra entrega para que no pierdas el producto?',
  postventa_logistics: '¿Me compartes el número de guía o pedido para rastrearlo?',
  scoring: 'Calculando score…',
  product_enrichment: 'Enriqueciendo producto…',
  marketplace: 'Evaluando viabilidad de publicación en marketplace…',
  affiliator: 'Procesando atribución de afiliado…',
  traffic_orchestrator: 'Analizando redistribución de presupuesto…',
  // IA-1 (agent-builder) — control-plane agents produce JSON, not customer
  // replies. Their "fallback" is the safe default the service layer uses
  // when the LLM call fails or times out (fail-open for governor/sentiment
  // = allow + neutral; fail-closed for qa_reviewer = approve original).
  governor: '{"allow":true,"reason":"","redirect":null}',
  qa_reviewer: '{"approved":true,"issues":[],"revisedOutput":""}',
  memory_curator: '{"facts":[]}',
  sentiment: '{"sentiment":"neutral","score":0,"urgency":"low","buyingIntent":"low","churnRisk":"low"}',
}
