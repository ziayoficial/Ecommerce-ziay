import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Image from 'next/image'
import { db } from '@/lib/db'
import { formatCurrency } from '@/lib/format'
import { safeJsonLd } from '@/lib/seo/json-ld'

// ───────────────────────────────────────────────────────────────────────────
// SSR Tenant Storefront — /t/[slug]
// Public, server-rendered, SEO-optimized storefront for a single tenant.
// ───────────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ slug: string }>
}

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'

// Defensive accessor for the SEOConfig model. In dev, the globalThis-cached
// PrismaClient instance may lag one schema-regeneration behind (the getter
// doesn't exist on the old instance). We tolerate that gracefully.
type SeoConfigRow = {
  metaTitle?: string | null
  metaDescription?: string | null
  keywords?: string | null
  ogImage?: string | null
} | null

async function fetchSeoConfig(tenantId: string): Promise<SeoConfigRow> {
  try {
    const model = (db as unknown as Record<string, { findFirst?: (a: unknown) => Promise<SeoConfigRow> }>).sEOConfig
    if (!model?.findFirst) return null
    return await model.findFirst({ where: { tenantId } })
  } catch {
    return null
  }
}

// ── Static params: pre-render one storefront per active tenant ──
export async function generateStaticParams() {
  try {
    const tenants = await db.tenant.findMany({
      where: { activo: true },
      select: { slug: true },
    })
    return tenants.map((t) => ({ slug: t.slug }))
  } catch {
    // Database may not be available at build time — return empty list so
    // the page falls back to on-demand SSR.
    return []
  }
}

// ── Metadata: SEO + OG + robots ──
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params
  const tenant = await db.tenant.findUnique({ where: { slug } })
  if (!tenant) {
    return { title: 'Tienda no encontrada · ZIAY' }
  }

  const seo = await fetchSeoConfig(tenant.id)
  const title = seo?.metaTitle || `${tenant.marca} · ${tenant.nombreNegocio}`
  const description =
    seo?.metaDescription ||
    `Catálogo online de ${tenant.marca}. Compra por WhatsApp con pago anticipado o contra entrega. Envíos a toda Colombia.`
  const keywords = seo?.keywords?.split(',').map((k) => k.trim()) || [
    tenant.marca,
    'tienda online',
    'WhatsApp',
    'Colombia',
    'ecommerce',
  ]
  const ogImage = seo?.ogImage || undefined
  const url = `${BASE_URL}/t/${tenant.slug}`

  return {
    title,
    description,
    keywords,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: tenant.marca,
      type: 'website',
      images: ogImage ? [{ url: ogImage, alt: tenant.marca }] : undefined,
      locale: 'es_CO',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
    robots: { index: true, follow: true },
  }
}

export default async function TenantStorefrontPage({ params }: PageProps) {
  const { slug } = await params
  const tenant = await db.tenant.findUnique({ where: { slug } })
  if (!tenant || !tenant.activo) notFound()

  const [products, seo] = await Promise.all([
    db.product.findMany({
      where: { tenantId: tenant.id, active: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    fetchSeoConfig(tenant.id),
  ])

  const whatsappLink = (text: string) =>
    `https://wa.me/?text=${encodeURIComponent(text)}`

  const jsonLdOnlineStore = {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: tenant.marca,
    description:
      seo?.metaDescription ||
      `Catálogo online de ${tenant.marca}. Compras por WhatsApp en Colombia.`,
    url: `${BASE_URL}/t/${tenant.slug}`,
    image: seo?.ogImage || undefined,
    paymentAccepted: 'Anticipado, Contra entrega',
    currenciesAccepted: 'COP',
    areaServed: 'CO',
  }

  const jsonLdItemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Catálogo de ${tenant.marca}`,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${BASE_URL}/t/${tenant.slug}/p/${p.sku}`,
      name: p.name,
    })),
  }

  const jsonLdFaq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: '¿Cómo compro por WhatsApp?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Toca el botón verde de WhatsApp, elige los productos que quieres y un asesor te atenderá al instante para confirmar tu pedido.`,
        },
      },
      {
        '@type': 'Question',
        name: '¿Qué métodos de pago aceptan?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Aceptamos pago anticipado (con descuento) y pago contra entrega. La política de pago de ${tenant.marca}: ${tenant.politicaPago || 'híbrido según el monto del pedido'}.`,
        },
      },
      {
        '@type': 'Question',
        name: '¿Hacen envíos a toda Colombia?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Sí. Trabajamos con transportadoras como Interrapidísimo, Coordinadora, Servientrega y TCC. El costo de envío se calcula según tu ciudad al confirmar el pedido.`,
        },
      },
    ],
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLdOnlineStore) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLdItemList) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLdFaq) }}
      />

      {/* ── Header with WhatsApp CTA ── */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <a
            href={`/t/${tenant.slug}`}
            className="flex items-center gap-2 font-semibold"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm">
              {tenant.marca.slice(0, 2).toUpperCase()}
            </span>
            <span className="hidden sm:inline">{tenant.marca}</span>
          </a>
          <a
            href={whatsappLink(
              `Hola ${tenant.marca}, quiero hacer un pedido 🛍️`
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            <WhatsAppIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Comprar por WhatsApp</span>
            <span className="sm:hidden">WhatsApp</span>
          </a>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="border-b bg-gradient-to-b from-muted/50 to-background">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-16 text-center">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">
            {tenant.marca}
          </h1>
          <p className="mt-3 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            {seo?.metaDescription ||
              `Bienvenido a ${tenant.nombreNegocio}. Descubre nuestro catálogo y compra fácil por WhatsApp.`}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
            {tenant.politicaPago && (
              <span className="rounded-full border bg-background px-3 py-1">
                💳 {tenant.politicaPago}
              </span>
            )}
            <span className="rounded-full border bg-background px-3 py-1">
              🚚 Envíos a toda Colombia
            </span>
            <span className="rounded-full border bg-background px-3 py-1">
              💬 Atención por WhatsApp
            </span>
          </div>
        </div>
      </section>

      {/* ── Product grid ── */}
      <main className="flex-1 mx-auto max-w-6xl w-full px-4 py-8 sm:py-12">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-xl sm:text-2xl font-semibold">Catálogo</h2>
          <span className="text-sm text-muted-foreground">
            {products.length} producto{products.length === 1 ? '' : 's'}
          </span>
        </div>

        {products.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            <p className="font-medium">Aún no hay productos publicados.</p>
            <p className="mt-1 text-sm">
              Vuelve pronto, estamos actualizando el catálogo.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <a
                key={p.id}
                href={`/t/${tenant.slug}/p/${p.sku}`}
                className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
              >
                <div className="aspect-square w-full overflow-hidden bg-muted">
                  {p.imageUrl ? (
                    <Image
                      src={p.imageUrl}
                      alt={p.name}
                      width={400}
                      height={400}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <span className="text-3xl">🛍️</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <h3 className="line-clamp-2 text-sm font-medium leading-tight">
                    {p.name}
                  </h3>
                  {p.categoria && (
                    <span className="text-xs text-muted-foreground">
                      {p.categoria}
                    </span>
                  )}
                  <p className="mt-auto pt-2 text-base font-semibold text-primary">
                    {formatCurrency(p.price, 'COP')}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* ── SEO content block ── */}
        <section className="mt-12 prose prose-sm max-w-none rounded-xl border bg-muted/30 p-6">
          <h2 className="text-lg font-semibold">
            Sobre {tenant.marca} — {tenant.nombreNegocio}
          </h2>
          <p className="text-muted-foreground">
            {tenant.marca} es una tienda en línea colombiana que vende a través
            de WhatsApp con atención personalizada. Ofrecemos pago anticipado
            con descuento y pago contra entrega, con envíos a toda Colombia
            través de las principales transportadoras.
          </p>
          <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
            <li>Atención directa por WhatsApp con un asesor humano.</li>
            <li>Pago anticipado o contra entrega según el monto del pedido.</li>
            <li>Envíos nacionales con seguimiento de guía.</li>
            <li>Catálogo actualizado con precios y disponibilidad en tiempo real.</li>
          </ul>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground">
          <p>
            © {new Date().getFullYear()} {tenant.marca}. Todos los derechos
            reservados.
          </p>
          <p className="mt-1 text-xs">
            Powered by{' '}
            <a
              href={BASE_URL}
              className="font-medium underline-offset-2 hover:underline"
            >
              ZIAY
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.978-.999zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  )
}
