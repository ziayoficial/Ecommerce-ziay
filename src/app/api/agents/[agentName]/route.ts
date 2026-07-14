import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess, requireAuth } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { buildAgentPrompt, AGENT_NAMES, AGENT_LABELS, AgentName } from '@/lib/agents/prompts'
import { getLogger } from '@/lib/logger'
// FIX-AI-AGENTS-001 — defensas y validación de salida para los 26 agentes.
import { parseAgentOutput, hasOutputSchema } from '@/lib/agents/schemas'
import { wrapUserInput, ANTI_INJECTION_PREFIX } from '@/lib/agents/sanitize'
import { emitToTenant } from '@/lib/chat-emit'

const log = getLogger('api/agents/[agentName]')

// FIX-AI-AGENTS-001 §A-3 — tabla de fallbacks movida a module-scope para
// que sea accesible tanto del bloque try (cuando la validación de salida
// falla y queremos usar el fallback) como del catch (cuando la llamada
// LLM falla completamente). El contenido es idéntico al que estaba
// inline en el catch — se mantiene el comportamiento existente.
const AGENT_FALLBACKS: Record<AgentName, string> = {
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

/**
 * FIX-AI-AGENTS-001 §A-3 — auto-escalación a revisión humana.
 *
 * Si `confidence < 0.6`, creamos un DecisionLog (ya creado por la ruta
 * con `humanReviewed: false` por defecto en el schema) Y emitimos un
 * evento `agent:low_confidence` al room del tenant para que cualquier
 * dashboard conectado por socket.io pueda notificar al agente humano.
 *
 * Fire-and-forget: si el chat-service está caído, la escalada sigue
 * registrada en DecisionLog y se vera en la UI de governance.
 */
function escalateLowConfidence(params: {
  tenantId: string
  agentName: string
  conversationId?: string
  confidence: number
  reply: string
  rawReply?: string
  error?: string
}): void {
  // Umbral < 0.6 cubre: call fallida (0.1), validación fallida (0.3).
  // Agentes de texto libre (0.6) y JSON validado (0.8) NO escalan.
  if (params.confidence >= 0.6) return
  emitToTenant(params.tenantId, 'agent:low_confidence', {
    agentName: params.agentName,
    conversationId: params.conversationId ?? null,
    confidence: params.confidence,
    reply: params.reply,
    rawReply: params.rawReply,
    error: params.error,
    // humanReviewed: false se persiste en DecisionLog con el valor default
    // del schema Prisma — la UI de governance filtra por este flag.
    humanReviewed: false,
  })
}

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
    // FIX-AI-AGENTS-001 §A-1: el system prompt va con rol `system`
    // (antes iba con rol `assistant` — el modelo lo trataba como una
    // respuesta previa suya y debilitaba los guardrails "Nunca inventes…",
    // habilitando prompt injection).
    //
    // FIX-AI-AGENTS-001 §A-4: se antepone `ANTI_INJECTION_PREFIX` al
    // system prompt (instrucciones anti-inyección en español) y se envuelve
    // el user prompt con `wrapUserInput()` para delimitar el contenido
    // del cliente con <user_message>…</user_message>.
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: ANTI_INJECTION_PREFIX + system },
        { role: 'user', content: wrapUserInput(user) },
      ],
      thinking: { type: 'disabled' },
    })
    const reply = completion.choices[0]?.message?.content?.trim() || ''

    // FIX-AI-AGENTS-001 §A-2: validar la salida contra el esquema Zod
    // del agente (si existe). 11 agentes tienen esquema; los 15 restantes
    // son de texto libre y no se validan.
    const parsed = parseAgentOutput<unknown>(agentName, reply)
    const schemaExists = hasOutputSchema(agentName)

    // FIX-AI-AGENTS-001 §A-3: confidence real basada en validación.
    //   - 0.8: salida JSON validada contra esquema Zod.
    //   - 0.6: agente de texto libre (sin esquema) — no se puede validar.
    //   - 0.3: agente con esquema pero la salida no validó → fallback.
    //   - 0.1: la llamada LLM falló completamente (bloque catch).
    let confidence: number
    let finalReply = reply
    if (parsed) {
      confidence = 0.8 // JSON validado OK
    } else if (schemaExists) {
      // El agente debería devolver JSON válido pero no pasó la validación.
      // Usamos el fallback para no entregar al cliente un JSON roso/prose.
      confidence = 0.3
      finalReply = AGENT_FALLBACKS[agentName as AgentName]
    } else {
      // Agente de texto libre — no hay esquema, se entrega el reply tal cual.
      confidence = 0.6
    }

    // Side-effects per agent (preservados del comportamiento existente).
    // Para vision, el side-effect parsea el JSON del reply crudo (no del
    // Zod-validated parsed) porque los campos {sku, confianza, metodo}
    // no están en el VisionSchema de §A-2 — se mantiene la lógica original.
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
          const parsedVision = JSON.parse(jsonMatch[0])
          await db.imageIdentification.create({
            data: {
              tenantId: ctx.tenantId,
              contactoId: ctx.customerId,
              imagenUrl: ctx.imageUrl,
              skuDetectado: parsedVision.sku || null,
              metodo: parsedVision.metodo || 'vlm',
              confianza: parsedVision.confianza != null ? Number(parsedVision.confianza) : 0,
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
      result: { reply: finalReply, confidence },
    })

    // FIX-AI-AGENTS-001 §A-3: auto-escalación si confidence < 0.6.
    // El DecisionLog ya quedó persistido con `humanReviewed: false`
    // (default del schema Prisma). Emitimos el evento al tenant room para
    // que cualquier dashboard conectado notifique al agente humano.
    escalateLowConfidence({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      confidence,
      reply: finalReply,
      rawReply: reply,
    })

    return NextResponse.json({ reply: finalReply, agent: agentName, confidence })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    const fallbackReply = AGENT_FALLBACKS[agentName as AgentName]
    // FIX-AI-AGENTS-001 §A-3: la llamada LLM falló completamente → 0.1
    // (antes era 0.3 — pero 0.3 implica "teníamos un fallback y lo usamos",
    // mientras que 0.1 implica "nunca llegamos a tener output del modelo").
    const confidence = 0.1

    // SPRINT-GOVERNANCE-001 — pilar #4: persistir incluso los fallbacks
    // (la trazabilidad cubre los casos de error del agente).
    await persistDecisionLog({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      ctx,
      result: { reply: fallbackReply, confidence, error: message },
    })

    // §A-3 auto-escalación: 0.1 < 0.6 → emitir evento.
    escalateLowConfidence({
      tenantId: ctx.tenantId,
      agentName,
      conversationId: ctx.conversationId,
      confidence,
      reply: fallbackReply,
      error: message,
    })

    return NextResponse.json({ reply: fallbackReply, agent: agentName, confidence, error: message })
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
