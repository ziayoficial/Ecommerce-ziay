import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/image-identifications?tenantId=...
// Returns the history of image identifications persisted by the vision agent
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

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
