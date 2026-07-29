import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'

// GET /api/image-identifications?tenantId=...
// Returns the history of image identifications persisted by the vision agent
//
// SECURITY · IF-2 · S-2 — cross-tenant bypass closed. The `tenantId` query
// param is gated by `requireTenantAccess` so an authenticated user can only
// list identifications for their own tenant.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  // IF-2 · S-2 — verify the caller may access this tenant before listing.
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const items = await db.imageIdentification.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({
    items: items.map(i => ({
      id: i.id,
      imagenUrl: i.imagenUrl,
      skuDetectado: i.skuDetectado,
      metodo: i.metodo,
      confianza: i.confianza,
      contactoId: i.contactoId,
      createdAt: i.createdAt,
    })),
  })
}
