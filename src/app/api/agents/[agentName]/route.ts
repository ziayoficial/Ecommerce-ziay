import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess, requireAuth } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { buildAgentPrompt, AGENT_NAMES, AGENT_LABELS, AgentName } from '@/lib/agents/prompts'
import { getLogger } from '@/lib/logger'

const log = getLogger('api/agents/[agentName]')

// SPRINT-GOVERNANCE-001 — pilar #4 "Trazabilidad de decisiones".
// Persiste una entrada DecisionLog por cada llamada al agente (éxito o
// fallback). Best-effort: si la persistencia falla, el agente sigue
// respondiendo — la llamada principal no debe romper por el log.
async function persistDecisionLog(params: {
  tenantId: string
  agentName: string
  conversationId?: string
  ctx: unknown
  result: { reply: string; confidence: number; error?: string }
}) {
  try {
    await db.decisionLog.create({
      data: {
        tenantId: params.tenantId,
        agentName: params.agentName,
        conversationId: params.conversationId ?? null,
        input: JSON.stringify(params.ctx),
        output: JSON.stringify({
          reply: params.result.reply,
          confidence: params.result.confidence,
          error: params.result.error ?? null,
        }),
        // El SDK actual no expone reasoning por separado — lo dejamos en null
        // para futuras integraciones con modelos con chain-of-thought visible.
        reasoning: null,
        confidence: params.result.confidence,
      },
    })
  } catch (err) {
    // Non-blocking: el log de decisión es secundario a la respuesta del
    // agente. Se captura para observabilidad pero no se propaga.
    log.warn(
      { err, agentName: params.agentName, tenantId: params.tenantId },
      'No se pudo persistir DecisionLog (non-blocking)',
    )
  }
}

// POST /api/agents/[agentName]
// Body: AgentContext (tenantId required; conversationId/customerId/perfil/items/query/etc optional)
// Returns: { reply, agent, confidence, error? }
//
// SPRINT8-SERVICES-REST-001 — left inline. The two db writes here are
// side-effects after the LLM call (profile detection → conversation
// update; vision JSON → ImageIdentification create). Per rule #2 (1-2
// simple db calls OK to leave), the migration cost outweighs the benefit
// — neither write benefits from a transaction or shared error surface.
// TODO: migrate to service layer if more agent side-effects accumulate.
//
// FIX-SECURITY-AUTH-001 (#30) — requireTenantAccess(ctx.tenantId). Any
// authed user used to be able to run any agent against any tenant (LLM
// cost + the `vision` agent side-effect writes to `ImageIdentification`
// on any tenant; the `profile` agent side-effect writes to
// `Conversation.perfilConversacion` on any tenant).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentName: string }> }
) {
  // FIX-REALTIME-WEBHOOKS-001 · P2 — per-route rate limit (10 req/min/IP).
  // Each call hits the LLM API ($0.01–0.10/call); the global 60/min/IP
  // middleware is too generous for an LLM endpoint.
  const limited = rateLimit(req, { max: 10, windowMs: 60_000, namespace: 'api:agents' })
  if (limited) return limited

  const { agentName } = await params
  if (!AGENT_NAMES.includes(agentName as AgentName)) {
    return NextResponse.json({ error: `Unknown agent. Valid: ${AGENT_NAMES.join(', ')}` }, { status: 400 })
  }
  const ctx = await req.json()
  if (!ctx.tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  // FIX-SECURITY-AUTH-001 (#30) — tenant gate before the LLM call.
  const { error } = await requireTenantAccess(ctx.tenantId)
  if (error) return error

  // Persist image identification result for vision agent (after the call)
  // (Done below if agentName === 'vision')

  try {
    const { system, user } = await buildAgentPrompt(agentName as AgentName, ctx)
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    })
    const reply = completion.choices[0]?.message?.content?.trim() || ''

    // Side-effects per agent
    if (agentName === 'profile') {
      // Try to detect the profile from the reply and persist on conversation
      const detected = ['mayorista', 'emprendedor', 'detal', 'regalo'].find(p => reply.toLowerCase().includes(p))
      if (detected && ctx.conversationId) {
        await db.conversation.update({ where: { id: ctx.conversationId }, data: { perfilConversacion: detected }})
      }
    }
    if (agentName === 'vision' && ctx.imageUrl && ctx.tenantId) {
      // Try to parse JSON from reply and persist as ImageIdentification
      try {
        const jsonMatch = reply.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          await db.imageIdentification.create({
            data: {
              tenantId: ctx.tenantId,
              contactoId: ctx.customerId,
              imagenUrl: ctx.imageUrl,
              skuDetectado: parsed.sku || null,
              metodo: parsed.metodo || 'vlm',
              confianza: parsed.confianza != null ? Number(parsed.confianza) : 0,
            }
          })
        }
      } catch { /* non-JSON reply, skip persist */ }
    }

    // SPRINT-GOVERNANCE-001 — pilar #4: persistir la decisión del agente.
    await persistDecisionLog({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      ctx,
      result: { reply, confidence: 0.9 },
    })

    return NextResponse.json({ reply, agent: agentName, confidence: 0.9 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    // Deterministic fallback per agent (kept generic for the 16 new agents
    // added in BUILD-AGENTS-LIB-001 — they can be specialized later).
    const fallbacks: Record<AgentName, string> = {
      profile: '¿Para ti o para surtir tu negocio?',
      speech: '¡Hola! ¿Qué producto te interesa?',
      quote: '¿Qué productos y cantidades quieres cotizar?',
      catalog: '¿Qué tema o producto buscas?',
      theme: '¿Qué personaje o tema te gusta?',
      objection: 'Entiendo. ¿Te confirmo el pedido?',
      address: '¿Cuál es tu ciudad y dirección completa?',
      logistics: '¿A qué ciudad enviamos y cuántas unidades?',
      vision: 'Por favor envíame una foto clara del producto para identificarlo.',
      checkout: '¿Confirmas el pedido?',
      // BUILD-AGENTS-LIB-001 — 16 new agent fallbacks
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
    const fallbackReply = fallbacks[agentName as AgentName]

    // SPRINT-GOVERNANCE-001 — pilar #4: persistir incluso los fallbacks
    // (la trazabilidad cubre los casos de error del agente).
    await persistDecisionLog({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      ctx,
      result: { reply: fallbackReply, confidence: 0.3, error: message },
    })

    return NextResponse.json({ reply: fallbackReply, agent: agentName, confidence: 0.3, error: message })
  }
}

// GET — list available agents with their labels
export async function GET() {
  const { error } = await requireAuth()
  if (error) return error
  return NextResponse.json({
    agents: AGENT_NAMES.map(name => ({ name, label: AGENT_LABELS[name] })),
  })
}
