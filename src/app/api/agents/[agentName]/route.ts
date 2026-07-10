import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { buildAgentPrompt, AGENT_NAMES, AGENT_LABELS, AgentName } from '@/lib/agents/prompts'

// POST /api/agents/[agentName]
// Body: AgentContext (tenantId required; conversationId/customerId/perfil/items/query/etc optional)
// Returns: { reply, agent, confidence, error? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentName: string }> }
) {
  const { agentName } = await params
  if (!AGENT_NAMES.includes(agentName as AgentName)) {
    return NextResponse.json({ error: `Unknown agent. Valid: ${AGENT_NAMES.join(', ')}` }, { status: 400 })
  }
  const ctx = await req.json()
  if (!ctx.tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

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

    return NextResponse.json({ reply, agent: agentName, confidence: 0.9 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    // Deterministic fallback per agent
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
    }
    return NextResponse.json({ reply: fallbacks[agentName as AgentName], agent: agentName, confidence: 0.3, error: message })
  }
}

// GET — list available agents with their labels
export async function GET() {
  return NextResponse.json({
    agents: AGENT_NAMES.map(name => ({ name, label: AGENT_LABELS[name] })),
  })
}
