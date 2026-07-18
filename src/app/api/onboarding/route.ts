import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/onboarding — self-service wizard to register a new tenant (Saramantha §13.6, §16.3)
// Body: { slug, nombreNegocio, marca, plataformaCatalogo, proveedorLogistico, proveedorIa, tonoMarca, nombreAsesora, politicaPago, preguntaPerfil, planMonetizacion }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { slug, nombreNegocio, marca } = body
  if (!slug || !nombreNegocio || !marca) {
    return NextResponse.json({ error: 'slug, nombreNegocio, marca required' }, { status: 400 })
  }

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
