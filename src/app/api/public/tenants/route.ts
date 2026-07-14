import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { NextRequest } from 'next/server'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// GET /api/public/tenants — directorio público de tiendas activas.
// NO requiere auth. Devuelve solo { slug, nombreNegocio, marca } para SSR
// del storefront público /t/[slug].
export const GET = withErrorHandling(async (req: NextRequest) => {

  const limited = rateLimit(req, {
    max: 60,
    windowMs: 60_000,
    namespace: 'api:public:tenants',
  })
  if (limited) return limited

  const tenants = await db.tenant.findMany({
    where: { activo: true },
    select: {
      id: true,
      slug: true,
      nombreNegocio: true,
      marca: true,
      plataformaCatalogo: true,
    },
    orderBy: { nombreNegocio: 'asc' },
  })

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      nombreNegocio: t.nombreNegocio,
      marca: t.marca,
      plataformaCatalogo: t.plataformaCatalogo,
    })),
  })

})
