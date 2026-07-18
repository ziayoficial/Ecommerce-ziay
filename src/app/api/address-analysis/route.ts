import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildAgentPrompt } from '@/lib/agents/prompts'
import ZAI from 'z-ai-web-dev-sdk'
import { rateLimit } from '@/lib/middleware/rate-limit'

// POST /api/address-analysis
// Body: { tenantId, direccion, country, ciudad, departamento }
// Returns: { result: "dirección correcta" | "falta que proporcione ...", country, address }
export async function POST(req: NextRequest) {
  // Rate-limit: 10 req/min per IP — LLM-backed route.
  if (rateLimit(req, { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 })
  }
  const { tenantId, direccion, country = 'CO', ciudad, departamento } = await req.json()
  if (!tenantId || !direccion) {
    return NextResponse.json({ error: 'tenantId and direccion required' }, { status: 400 })
  }

  try {
    const { system, user } = await buildAgentPrompt('address_analysis', {
      tenantId,
      country,
      partialAddress: { direccion, ciudad, departamento, pais: country },
      message: direccion,
    })

    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    })
    const reply = completion.choices[0]?.message?.content?.trim() || 'dirección correcta'

    // Normalize result
    const isCorrect = reply.toLowerCase().includes('dirección correcta') || reply.toLowerCase().includes('direccion correcta')
    const missing = isCorrect ? null : reply.replace(/falta que proporcione/i, '').trim()

    // Audit log
    await db.auditLog.create({
      data: {
        tenantId,
        action: 'address_analysis.evaluated',
        entity: 'Address',
        metadata: JSON.stringify({ address: direccion.slice(0, 100), country, result: reply.slice(0, 100), isCorrect }),
      },
    })

    return NextResponse.json({
      result: reply,
      isCorrect,
      missing,
      country,
      address: direccion,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    // Deterministic fallback — basic Colombia rules
    const hasNumber = /\d/.test(direccion)
    const hasVia = /(calle|carrera|avenida|diagonal|transversal|cl|cr|av|dg|tv)/i.test(direccion)
    const isCorrect = hasNumber && hasVia
    return NextResponse.json({
      result: isCorrect ? 'dirección correcta' : 'falta que proporcione más detalles de la dirección (tipo de vía, número, barrio o referencia)',
      isCorrect,
      missing: isCorrect ? null : 'tipo de vía, número, barrio o referencia',
      country,
      address: direccion,
      error: message,
    })
  }
}
