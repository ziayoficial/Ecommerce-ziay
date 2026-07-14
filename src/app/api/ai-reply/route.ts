import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'
// FIX-AI-AGENTS-001 — defensas anti-inyección + confidence real.
import { wrapUserInput, ANTI_INJECTION_PREFIX } from '@/lib/agents/sanitize'
import { emitToTenant } from '@/lib/chat-emit'

// TD-2: Zod schema for ai-reply POST.
const AiReplySchema = z.object({
  conversationId: z.string().min(1),
  tone: z.string().optional(),
}).passthrough()

// POST /api/ai-reply
// Generates context-aware sales replies using the LLM skill.
// Uses conversation history + channel payment strategy + catalog context.
//
// SPRINT8-SERVICES-REST-001 — left inline. The two db calls here
// (conversation.findUnique with messages/customer/channel relations +
// product.findMany for catalog context) load LLM context, not data for
// the response. Per rule #2 (1-2 simple db calls OK to leave), the
// existing `conversationService.getConversationById` would also clear
// the unread badge (side-effect we don't want here) and `catalogService.
// getProducts` filters by `active=true` but doesn't take a `take` limit
// (the route uses `take: 8`). The shapes don't match cleanly — migrate
// only when those services gain LLM-context-shaped methods.
// TODO: migrate to service layer when conversationService gains a
// "context-only" read method (no side-effects).
//
// FIX-SECURITY-AUTH-001 (#11) — fetch the conversation, verify tenant
// ownership before the LLM call. Any authed user used to be able to feed
// any tenant's customer PII + message history into the LLM (cross-tenant
// PII exfiltration via the LLM response).
export async function POST(req: NextRequest) {
  // FIX-REALTIME-WEBHOOKS-001 · P2 — per-route rate limit (10 req/min/IP).
  // Each call hits the LLM API ($0.01–0.10/call); the global 60/min/IP
  // middleware is too generous for an LLM endpoint.
  const limited = rateLimit(req, { max: 10, windowMs: 60_000, namespace: 'api:ai-reply' })
  if (limited) return limited

  const raw = await req.json()
  const parseResult = AiReplySchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validación fallida', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const { conversationId, tone = 'friendly' } = parseResult.data as {
    conversationId: string
    tone?: string
  }

  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      customer: true,
      channel: true,
      messages: { orderBy: { createdAt: 'asc' }, take: 12 },
    },
  })
  if (!conv) return NextResponse.json({ error: 'conversation not found' }, { status: 404 })

  // FIX-SECURITY-AUTH-001 (#11) — tenant gate before the LLM gets fed PII.
  const { error } = await requireTenantAccess(conv.tenantId)
  if (error) return error

  // Build context for the model
  const products = await db.product.findMany({ where: { active: true, tenantId: conv.tenantId }, take: 8 })
  const catalog = products.map(p => `- ${p.name} ($${p.price.toLocaleString('es-CO')} COP, sku ${p.sku})`).join('\n')

  const strategyText = (() => {
    switch (conv.channel.paymentStrategy) {
      case 'advance':
        return `Este canal exige PAGO ANTICIPADO. Ofrece ${conv.channel.prepayDiscountPct || 0}% de descuento por pago anticipado y envía link de pago del carrito.`
      case 'cod':
        return `Este canal opera solo CONTRA ENTREGA. Costo de envío contra entrega: $${conv.channel.codFee || 0}. Confirma dirección y ciudad antes de cerrar.`
      case 'hybrid':
      default:
        return `Este canal es HÍBRIDO. Para pedidos > $${conv.channel.requirePrepayMin || 0} recomienda pago anticipado (${conv.channel.prepayDiscountPct || 0}% off). Para pedidos menores permite contra entrega (recargo $${conv.channel.codFee || 0}).`
    }
  })()

  const history = conv.messages.map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.body}`).join('\n')

  const systemPrompt = `Eres un asistente de ventas conversacional experto para una tienda de belleza y cuidado personal en Colombia (y expansión internacional).
Canal: ${conv.channel.displayName} (${conv.channel.type}).
Estrategia de pago del canal: ${strategyText}
Cliente: ${conv.customer.name} (${conv.customer.country || 'N/A'}, ${conv.customer.city || ''}).
Contexto de atribución: ${conv.sourceCampaign ? 'vino por campaña "' + conv.sourceCampaign + '"' : 'orgánico'}.

Catálogo disponible:
${catalog}

Tono: ${tone}, cálido, cercano (estilo LATAM), emojis moderados. Máximo 2 mensajes cortos. Cierra hacia la venta: confirma producto, cantidad, modo de pago y dirección. NO inventes precios fuera del catálogo. Si el cliente pregunta por contra entrega y el canal es solo 'advance', explica amablemente que ese canal requiere pago anticipado pero ofrece descuento.`

  try {
    const zai = await ZAI.create()
    // FIX-AI-AGENTS-001 §A-1: el system prompt va con rol `system`
    // (antes iba con rol `assistant` — el modelo lo trataba como una
    // respuesta previa suya, debilitando los guardrails "NO inventes
    // precios fuera del catálogo" y habilitando prompt injection).
    //
    // FIX-AI-AGENTS-001 §A-4: se antepone `ANTI_INJECTION_PREFIX` al
    // system prompt (instrucciones anti-inyección en español) y se envuelve
    // el user prompt con `wrapUserInput()` — el historial de la conversación
    // es input del cliente y debe ir delimitado con <user_message>.
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: ANTI_INJECTION_PREFIX + systemPrompt },
        { role: 'user', content: wrapUserInput(`Historia de la conversación:\n${history}\n\nGenera la siguiente respuesta del agente (solo el texto, sin prefijo "Agente:"):`) },
      ],
      thinking: { type: 'disabled' },
    })
    const reply = completion.choices[0]?.message?.content?.trim() || ''
    // FIX-AI-AGENTS-001 §A-3: confidence real — esta ruta devuelve texto
    // libre (no JSON), no hay esquema Zod que validar → 0.6.
    // (Antes era 0.9 hardcodeado en cada éxito.)
    const confidence = 0.6
    return NextResponse.json({ reply, confidence })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    // Fallback deterministic reply so the UI never breaks
    const fallback = `¡Hola ${conv.customer.name.split(' ')[0]}! 👋 Gracias por escribir. ¿Te ayudo a confirmar tu pedido? Cuéntame qué producto te interesa y tu ciudad para coordinar el envío.`
    // FIX-AI-AGENTS-001 §A-3: la llamada LLM falló completamente → 0.1
    // (antes era 0.3 — pero 0.3 implicaba "teníamos fallback", mientras
    // que 0.1 implica "nunca llegamos a tener output del modelo").
    const confidence = 0.1
    // §A-3 auto-escalación: 0.1 < 0.6 → persistir DecisionLog con
    // `humanReviewed: false` y emitir `agent:low_confidence` al tenant.
    try {
      await db.decisionLog.create({
        data: {
          tenantId: conv.tenantId,
          agentName: 'ai_reply',
          conversationId: conv.id,
          input: JSON.stringify({ conversationId: conv.id, tone }),
          output: JSON.stringify({ reply: fallback, confidence, error: message }),
          reasoning: null,
          confidence,
          // humanReviewed: false (default del schema Prisma).
        },
      })
    } catch {
      // Non-blocking: la escalada es best-effort.
    }
    emitToTenant(conv.tenantId, 'agent:low_confidence', {
      agentName: 'ai_reply',
      conversationId: conv.id,
      confidence,
      reply: fallback,
      error: message,
      humanReviewed: false,
    })
    return NextResponse.json({ reply: fallback, confidence, error: message })
  }
}
