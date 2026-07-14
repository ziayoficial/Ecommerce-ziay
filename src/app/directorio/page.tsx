import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@/lib/db'

// ───────────────────────────────────────────────────────────────────────────
// SSR Tenant Directory — /directorio
//
// Public, server-rendered hub page that lists every active tenant on ZIAY.
// Resolves AUDIT-SEO-001 P0 finding #1 (sitemap referenced /directorio but
// the page didn't exist) + P2 finding #17 (orphan-page cluster — tenants
// were only linked from the sitemap with no internal hub).
//
// Reads tenant data server-side via Prisma (NOT fetch to /api/public/tenants)
// — avoids the extra HTTP round-trip and the public rate limiter.
// ───────────────────────────────────────────────────────────────────────────

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'

// Always SSR — tenant list changes whenever a new tenant is onboarded.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Directorio de marcas',
  description:
    'Explora todas las marcas y tiendas que operan en ZIAY — comercio conversacional con atribución inteligente.',
  alternates: { canonical: `${BASE_URL}/directorio` },
  openGraph: {
    title: 'Directorio de marcas · ZIAY',
    description:
      'Explora todas las marcas y tiendas que operan en ZIAY — comercio conversacional con atribución inteligente.',
    url: `${BASE_URL}/directorio`,
    type: 'website',
    locale: 'es_CO',
    siteName: 'ZIAY',
    images: [
      {
        url: '/og-default.png',
        width: 1200,
        height: 630,
        alt: 'Directorio de marcas ZIAY',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Directorio de marcas · ZIAY',
    description:
      'Explora todas las marcas y tiendas que operan en ZIAY — comercio conversacional con atribución inteligente.',
    images: ['/og-default.png'],
  },
  robots: { index: true, follow: true },
}

type DirectorioTenant = {
  id: string
  slug: string
  nombreNegocio: string
  marca: string
  tonoMarca: string | null
  planMonetizacion: string
}

async function fetchTenants(): Promise<DirectorioTenant[]> {
  try {
    return await db.tenant.findMany({
      where: { activo: true },
      select: {
        id: true,
        slug: true,
        nombreNegocio: true,
        marca: true,
        tonoMarca: true,
        planMonetizacion: true,
      },
      orderBy: { marca: 'asc' },
    })
  } catch {
    // Database may be unavailable (build time, transient outage).
    // Render the page shell so the route still returns 200 and the
    // sitemap entry isn't broken; an empty list is shown.
    return []
  }
}

function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c')
}

export default async function DirectorioPage() {
  const tenants = await fetchTenants()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Directorio de marcas ZIAY',
    description: 'Marcas que operan en ZIAY',
    url: `${BASE_URL}/directorio`,
    hasPart: tenants.map((t) => ({
      '@type': 'Store',
      name: t.marca,
      url: `${BASE_URL}/t/${t.slug}`,
    })),
  }

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      <div className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight">
          Directorio de marcas
        </h1>
        <p className="mt-2 text-muted-foreground">
          Explora las tiendas que operan en ZIAY
        </p>

        {tenants.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            Aún no hay tiendas publicadas en el directorio. Vuelve pronto.
          </p>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 list-none p-0">
            {tenants.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/t/${t.slug}`}
                  className="group block rounded-lg border p-6 h-full hover:border-primary hover:shadow-md transition-all"
                >
                  <h2 className="text-xl font-semibold group-hover:text-primary">
                    {t.marca}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.nombreNegocio}
                  </p>
                  {t.tonoMarca ? (
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                      {t.tonoMarca}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs text-muted-foreground capitalize">
                    Plan: {t.planMonetizacion}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
