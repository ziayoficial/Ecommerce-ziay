import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'

// POST /api/onboarding — self-service wizard to register a new tenant (Saramantha §13.6, §16.3)
// Body: { slug, nombreNegocio, marca, plataformaCatalogo, proveedorLogistico, proveedorIa, tonoMarca, nombreAsesora, politicaPago, preguntaPerfil, planMonetizacion }
//
// SECURITY · IF-2 · S-8 — privilege escalation closed.
//   - `requireRole(['admin'])` — only authenticated admins may provision a
//     new tenant (was previously open to ANY authenticated user, including
//     read-only `agent` / `marketing` roles, which let anyone create
//     unlimited tenants and configure `feeBaseMensual` defaults).
//   - Zod schema for the request body — slug MUST match `^[a-z0-9-]{3,40}$`,
//     enums are validated, lengths capped. Was previously parsed with bare
//     `await req.json()` + ad-hoc `if (!slug)` checks (S-14).
//   - Rate-limit 5/hour/IP — defense-in-depth against a stolen admin token
//     being used to flood the tenants table.
const ONBOARDING_SCHEMA = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]{3,40}$/, 'slug must be 3-40 chars of lowercase letters, digits or hyphens'),
  nombreNegocio: z.string().min(1).max(120),
  marca: z.string().min(1).max(120),
  plataformaCatalogo: z
    .enum(['whatsapp_catalog', 'woocommerce', 'shopify', 'catalogo_propio_cliente', 'catalogo_nuestro'])
    .optional(),
  bdCatalogo: z.enum(['supabase_cliente', 'supabase_nuestro', 'oracle_nuestro']).optional(),
  proveedorIa: z.enum(['zai', 'chatgpt', 'xai', 'ollama']).optional(),
  proveedorLogistico: z.enum(['dropi', '99envios', 'aveonline']).optional(),
  tonoMarca: z.string().max(500).optional(),
  nombreAsesora: z.string().max(120).optional(),
  politicaPago: z.string().max(500).optional(),
  preguntaPerfil: z.string().max(500).optional(),
  planMonetizacion: z.enum(['conecta', 'catalogo_incluido', 'completo']).optional(),
  feeBaseMensual: z.number().int().nonnegative().max(10_000_000).optional(),
})

export async function POST(req: NextRequest) {
  // IF-2 · S-8 — only admins may provision new tenants.
  const { error: roleError } = await requireRole(['admin'])
  if (roleError) return roleError

  // IF-2 · S-8 — rate-limit 5/hour/IP to defend against token abuse floods.
  if (rateLimit(req, { max: 5, windowMs: 3_600_000 })) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 })
  }

  const raw = await req.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })

  const parsed = ONBOARDING_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data
  const { slug, nombreNegocio, marca } = body

  // Check slug is unique
  const existing = await db.tenant.findUnique({ where: { slug } })
  if (existing) return NextResponse.json({ error: `Tenant slug '${slug}' already exists` }, { status: 409 })

  const tenant = await db.tenant.create({
    data: {
      slug, nombreNegocio, marca,
      plataformaCatalogo: body.plataformaCatalogo || 'whatsapp_catalog',
      bdCatalogo: body.bdCatalogo || 'supabase_nuestro',
      proveedorIa: body.proveedorIa || 'zai',
      proveedorLogistico: body.proveedorLogistico || 'dropi',
      tonoMarca: body.tonoMarca || null,
      nombreAsesora: body.nombreAsesora || null,
      politicaPago: body.politicaPago || 'híbrido: prepay 5% off > $250k, COD debajo',
      preguntaPerfil: body.preguntaPerfil || '¿Para ti o para surtir tu negocio?',
      planMonetizacion: body.planMonetizacion || 'conecta',
      feeBaseMensual: body.feeBaseMensual || 250000,
      comisionPctInicial: 4.5,
    },
  })

  // Create default WhatsApp channel for the new tenant
  const channel = await db.channel.create({
    data: {
      tenantId: tenant.id,
      type: 'whatsapp',
      name: `WhatsApp ${marca}`,
      displayName: `WhatsApp · ${marca}`,
      country: 'CO',
      paymentStrategy: 'hybrid',
      requirePrepayMin: 250000,
      prepayDiscountPct: 5,
      codFee: 8000,
    },
  })

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      action: 'tenant.onboarded',
      entity: 'Tenant',
      entityId: tenant.id,
      metadata: JSON.stringify({ slug, plan: tenant.planMonetizacion, channel: channel.id }),
    },
  })

  return NextResponse.json({
    tenant: { id: tenant.id, slug: tenant.slug, marca: tenant.marca },
    channel: { id: channel.id, type: channel.type },
    nextSteps: [
      '1. Verify WhatsApp Business Account in Meta Business Manager',
      '2. Configure webhook URL pointing to /api/webhooks/whatsapp',
      '3. Set WA_VERIFY_TOKEN in .env',
      '4. Sync initial catalog via /api/catalog/sync',
      '5. Test the 10 agents via the Orquestador module',
    ],
  })
}

// GET /api/onboarding — returns the wizard schema (available options)
export async function GET() {
  return NextResponse.json({
    plataformaCatalogo: ['whatsapp_catalog', 'woocommerce', 'shopify', 'catalogo_propio_cliente', 'catalogo_nuestro'],
    bdCatalogo: ['supabase_cliente', 'supabase_nuestro', 'oracle_nuestro'],
    proveedorIa: ['zai', 'chatgpt', 'xai', 'ollama'],
    proveedorLogistico: ['dropi', '99envios', 'aveonline'],
    planMonetizacion: ['conecta', 'catalogo_incluido', 'completo'],
  })
}
