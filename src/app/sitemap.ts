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

export const dynamic = 'force-dynamic'
// Re-validate at most once per hour.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  // Base static entries.
  const entries: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/directorio`,
      lastModified: now,
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
