import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

// GET /api/tenants — list all tenants (for the switcher in the topbar)
export async function GET() {
  const { error } = await requireAuth()
  if (error) return error
  const tenants = await db.tenant.findMany({
    where: { activo: true },
    orderBy: { nombreNegocio: 'asc' },
    select: {
      id: true, slug: true, nombreNegocio: true, marca: true,
      planMonetizacion: true, proveedorIa: true, proveedorLogistico: true,
      plataformaCatalogo: true, politicaPago: true,
    }
  })
  return NextResponse.json({ tenants })
}
