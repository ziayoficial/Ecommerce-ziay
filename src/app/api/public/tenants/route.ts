import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { NextRequest } from 'next/server'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { setCacheHeaders } from '@/lib/middleware/cache-headers'

// GET /api/public/tenants — directorio público de tiendas activas.
// NO requiere auth. Devuelve solo { slug, nombreNegocio, marca } para SSR
// del storefront público /t/[slug].
/**
 * GET /api/public/tenants
 *
 * Public tenant directory (slug + display name) — used by login screen tenant picker.
 *
 * @security Public
 * @returns Tenant list (no sensitive fields)
 */
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

  return setCacheHeaders(
    NextResponse.json({
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        nombreNegocio: t.nombreNegocio,
        marca: t.marca,
        plataformaCatalogo: t.plataformaCatalogo,
      })),
    }),
    // SPRINT-PERFORMANCE-FINAL-001 — `public-short`: 60s CDN cache. The
    // tenant directory powers the login-screen tenant picker and the
    // storefront index; tenant activations/deactivations are rare but
    // 60s is short enough that a newly-activated tenant is visible to
    // the next request after the SWR window.
    'public-short',
  )

})
