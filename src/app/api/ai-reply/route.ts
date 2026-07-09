import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'

// POST /api/ai-reply
// Generates context-aware sales replies using the LLM skill.
// Uses conversation history + channel payment strategy + catalog context.
export async function POST(req: NextRequest) {
  const { conversationId, tone = 'friendly' } = await req.json()
  if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })

  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      customer: true,
      channel: true,
      messages: { orderBy: { createdAt: 'asc' }, take: 12 },
    },
  })
  if (!conv) return NextResponse.json({ error: 'conversation not found' }, { status: 404 })

  // Build context for the model
  const products = await db.product.findMany({ where: { active: true }, take: 8 })
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
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: `Historia de la conversación:\n${history}\n\nGenera la siguiente respuesta del agente (solo el texto, sin prefijo "Agente:"):` },
      ],
      thinking: { type: 'disabled' },
    })
    const reply = completion.choices[0]?.message?.content?.trim() || ''
    return NextResponse.json({ reply, confidence: 0.9 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    // Fallback deterministic reply so the UI never breaks
    const fallback = `¡Hola ${conv.customer.name.split(' ')[0]}! 👋 Gracias por escribir. ¿Te ayudo a confirmar tu pedido? Cuéntame qué producto te interesa y tu ciudad para coordinar el envío.`
    return NextResponse.json({ reply: fallback, confidence: 0.3, error: message })
  }
}
