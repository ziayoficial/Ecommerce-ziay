import type { MetadataRoute } from 'next'
import { db } from '@/lib/db'

// ───────────────────────────────────────────────────────────────────────────
// Dynamic sitemap — homepage + /directorio + 1 per tenant + 1 per product.
// Generated at request time via the Next.js Metadata API.
// ───────────────────────────────────────────────────────────────────────────

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'

// ───────────────────────────────────────────────────────────────────────────
// ISR: revalidate at most once per hour. (Removing `force-dynamic` — the
// previous combination of `force-dynamic` + `revalidate` was contradictory:
// `force-dynamic` wins and `revalidate` was silently ignored.)
// ───────────────────────────────────────────────────────────────────────────
export const revalidate = 3600

// Stable lastmod for static entries (homepage + /directorio). Using `now`
// would dilute the lastmod signal Google uses to schedule recrawls — every
// sitemap fetch would show these as just-modified. We use the latest tenant
// `updatedAt` (the homepage's content is effectively derived from the active
// tenant set), falling back to a build-time constant when the DB is
// unreachable. Set NEXT_BUILD_TIME at deploy time for a deterministic
// baseline across instances.
const SITE_BUILD_TIME = new Date(
  process.env.NEXT_BUILD_TIME || '2025-01-01T00:00:00.000Z',
)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Resolve the most-recent tenant updatedAt so the homepage + /directorio
  // entries don't churn every fetch. Defaults to a stable build-time stamp.
  let latestTenantUpdate: Date = SITE_BUILD_TIME
  try {
    const latest = await db.tenant.findFirst({
      where: { activo: true },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    })
    if (latest?.updatedAt) {
      latestTenantUpdate = latest.updatedAt
    }
  } catch {
    // DB unavailable — fall back to build-time constant.
  }

  // Base static entries.
  const entries: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: latestTenantUpdate,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/directorio`,
      lastModified: latestTenantUpdate,
      changeFrequency: 'daily',
      priority: 0.9,
    },
  ]

  // Tenants + their products in a single query (relation include).
  try {
    const tenants = await db.tenant.findMany({
      where: { activo: true },
      select: {
        slug: true,
        updatedAt: true,
        products: {
          where: { active: true },
          select: { sku: true, updatedAt: true },
        },
      },
    })

    for (const t of tenants) {
      // Tenant storefront.
      entries.push({
        url: `${BASE_URL}/t/${t.slug}`,
        lastModified: t.updatedAt,
        changeFrequency: 'daily',
        priority: 0.8,
      })

      // Product detail pages under this tenant.
      for (const p of t.products) {
        entries.push({
          url: `${BASE_URL}/t/${t.slug}/p/${p.sku}`,
          lastModified: p.updatedAt,
          changeFrequency: 'weekly',
          priority: 0.6,
        })
      }
    }
  } catch {
    // If DB is unavailable, return only the static entries.
  }

  return entries
}
