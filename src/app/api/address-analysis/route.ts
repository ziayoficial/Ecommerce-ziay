import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buildAgentPrompt } from '@/lib/agents/prompts'
import ZAI from 'z-ai-web-dev-sdk'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { requireTenantAccess } from '@/lib/auth-helpers'

// Zod validation for request body
const AddressAnalysisSchema = z.object({
  tenantId: z.string().min(1),
  direccion: z.string().min(1).max(500),
  country: z.string().length(2).default('CO'),
  ciudad: z.string().max(100).optional(),
  departamento: z.string().max(100).optional(),
})

// POST /api/address-analysis
// Body: { tenantId, direccion, country, ciudad, departamento }
// Returns: { result: "dirección correcta" | "falta que proporcione ...", country, address }
//
// SECURITY · IF-2 · S-5 — cross-tenant bypass closed. `requireTenantAccess`
// runs BEFORE the LLM call + AuditLog write so an attacker can no longer
// spend a victim tenant's LLM budget or inject audit-log rows. The 10/min
// IP rate-limit stays as defense-in-depth but does NOT close the bypass.
export async function POST(req: NextRequest) {
  // Rate-limit: 10 req/min per IP — LLM-backed route.
  if (rateLimit(req, { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 })
  }
  const parsed = AddressAnalysisSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const { tenantId, direccion, country, ciudad, departamento } = parsed.data

  // IF-2 · S-5 — verify the caller may access this tenant BEFORE the LLM call.
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  try {
    // v0.4.1 · IA-3: el agente `address_analysis` se consolidó en `address`.
    // El caller pasa `mode: 'analyze'` para activar la rama de análisis de
    // calidad/entregabilidad; el `address` agent ahora cubre los 2 modos
    // (collect = formulario, analyze = validación estructural).
    const { system, user } = await buildAgentPrompt('address', {
      tenantId,
      country,
      mode: 'analyze',
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
