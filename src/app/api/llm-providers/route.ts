import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/llm-providers?tenantId=...
// Returns the IA provider config for a tenant + available providers + health check
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }})
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  const providers = [
    {
      id: 'zai',
      label: 'Z.ai (default, sin API key propia)',
      active: tenant.proveedorIa === 'zai',
      configured: true,
      vision: true,
      embeddings: false,
      note: 'Incluido en el stack. Sin costo adicional para el tenant.'
    },
    {
      id: 'chatgpt',
      label: 'OpenAI ChatGPT (BYO API key)',
      active: tenant.proveedorIa === 'chatgpt',
      configured: !!process.env.OPENAI_API_KEY,
      vision: true,
      embeddings: true,
      note: 'El tenant conecta su propia API key. Modelos: gpt-4o-mini (texto), gpt-4o (visión), text-embedding-3-small.'
    },
    {
      id: 'xai',
      label: 'xAI Grok (BYO API key)',
      active: tenant.proveedorIa === 'xai',
      configured: !!process.env.XAI_API_KEY,
      vision: true,
      embeddings: false,
      note: 'El tenant conecta su propia API key. Modelos: grok-2-latest (texto), grok-2-vision-latest (visión).'
    },
    {
      id: 'ollama',
      label: 'Ollama (autoalojado)',
      active: tenant.proveedorIa === 'ollama',
      configured: !!process.env.OLLAMA_BASE_URL,
      vision: true,
      embeddings: true,
      note: 'Autoalojado por el vendedor. Modelos: llama3.1 (texto), llama3.2-vision (visión), nomic-embed-text (embeddings).'
    },
  ]

  return NextResponse.json({
    current: tenant.proveedorIa,
    credencialesRef: tenant.credencialesIaRef,
    providers,
  })
}

// PATCH /api/llm-providers — change the tenant's IA provider
export async function PATCH(req: NextRequest) {
  const { tenantId, proveedorIa, credencialesIaRef } = await req.json()
  if (!tenantId || !proveedorIa) return NextResponse.json({ error: 'tenantId and proveedorIa required' }, { status: 400 })

  const valid = ['zai', 'chatgpt', 'xai', 'ollama']
  if (!valid.includes(proveedorIa)) return NextResponse.json({ error: `proveedorIa must be one of: ${valid.join(', ')}` }, { status: 400 })

  const updated = await db.tenant.update({
    where: { id: tenantId },
    data: {
      proveedorIa,
      ...(credencialesIaRef !== undefined ? { credencialesIaRef } : {}),
    },
  })

  await db.auditLog.create({
    data: {
      tenantId,
      action: `tenant.llm_provider_changed`,
      entity: 'Tenant',
      entityId: tenantId,
      meta: JSON.stringify({ proveedorIa }),
    },
  })

  return NextResponse.json({ tenant: { id: updated.id, proveedorIa: updated.proveedorIa } })
}
