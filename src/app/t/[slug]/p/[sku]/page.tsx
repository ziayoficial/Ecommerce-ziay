import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Image from 'next/image'
import { db } from '@/lib/db'
import { formatCurrency } from '@/lib/format'
import { safeJsonLd } from '@/lib/seo/json-ld'

// ───────────────────────────────────────────────────────────────────────────
// SSR Product Detail — /t/[slug]/p/[sku]
// Server-rendered product page with rich Product + BreadcrumbList JSON-LD.
// ───────────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ slug: string; sku: string }>
}

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'

// ── Static params: all products × tenants ──
export async function generateStaticParams() {
  try {
    const tenants = await db.tenant.findMany({
      where: { activo: true },
      select: { slug: true, id: true },
    })
    const out: { slug: string; sku: string }[] = []
    for (const t of tenants) {
      const products = await db.product.findMany({
        where: { tenantId: t.id, active: true },
        select: { sku: true },
      })
      for (const p of products) out.push({ slug: t.slug, sku: p.sku })
    }
    return out
  } catch {
    return []
  }
}

// ── Metadata ──
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, sku } = await params
  const tenant = await db.tenant.findUnique({ where: { slug } })
  if (!tenant) return { title: 'Producto no encontrado' }

  const product = await db.product.findUnique({
    where: { tenantId_sku: { tenantId: tenant.id, sku } },
  })
  if (!product) return { title: 'Producto no encontrado' }

  const url = `${BASE_URL}/t/${tenant.slug}/p/${product.sku}`
  const title = `${product.name} · ${tenant.marca}`
  const description =
    product.description ||
    `Compra ${product.name} por WhatsApp en ${tenant.marca}. Pago anticipado o contra entrega. Envíos a toda Colombia.`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: tenant.marca,
      type: 'website',
      images: product.imageUrl ? [{ url: product.imageUrl, alt: product.name }] : undefined,
      locale: 'es_CO',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
    robots: { index: true, follow: true },
  }
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug, sku } = await params
  const tenant = await db.tenant.findUnique({ where: { slug } })
  if (!tenant || !tenant.activo) notFound()

  const product = await db.product.findUnique({
    where: { tenantId_sku: { tenantId: tenant.id, sku } },
  })
  if (!product || !product.active) notFound()

  const url = `${BASE_URL}/t/${tenant.slug}/p/${product.sku}`
  const prefilledText = `Hola ${tenant.marca} 👋, quiero comprar:${'\n'}${'\n'}🛍️ *${product.name}*${'\n'}SKU: ${product.sku}${'\n'}Precio: ${formatCurrency(product.price, 'COP')}${'\n'}${'\n'}¿Cómo procedo con el pago y el envío?`
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(prefilledText)}`

  // ── JSON-LD: Product ──
  const jsonLdProduct = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || undefined,
    sku: product.sku,
    image: product.imageUrl ? [product.imageUrl] : undefined,
    category: product.categoria || undefined,
    brand: { '@type': 'Brand', name: tenant.marca },
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'COP',
      price: product.price,
      availability:
        product.stock > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: tenant.marca },
    },
  }

  // ── JSON-LD: BreadcrumbList ──
  const jsonLdBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: tenant.marca,
        item: `${BASE_URL}/t/${tenant.slug}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: product.categoria || 'Catálogo',
        item: `${BASE_URL}/t/${tenant.slug}#catalogo`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: product.name,
        item: url,
      },
    ],
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLdProduct) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLdBreadcrumb) }}
      />

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
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
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            <WhatsAppIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Comprar por WhatsApp</span>
            <span className="sm:hidden">Comprar</span>
          </a>
        </div>
      </header>

      {/* ── Breadcrumb ── */}
      <nav
        aria-label="Breadcrumb"
        className="mx-auto w-full max-w-5xl px-4 pt-4"
      >
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <li>
            <a href={`/t/${tenant.slug}`} className="hover:underline">
              {tenant.marca}
            </a>
          </li>
          <li aria-hidden="true">/</li>
          {product.categoria && (
            <>
              <li>
                <a
                  href={`/t/${tenant.slug}#catalogo`}
                  className="hover:underline"
                >
                  {product.categoria}
                </a>
              </li>
              <li aria-hidden="true">/</li>
            </>
          )}
          <li className="text-foreground font-medium">{product.name}</li>
        </ol>
      </nav>

      {/* ── Main ── */}
      <main className="flex-1 mx-auto max-w-5xl w-full px-4 py-6">
        <div className="grid gap-8 md:grid-cols-2">
          {/* Image */}
          <div className="relative">
            <div className="aspect-square w-full overflow-hidden rounded-xl border bg-muted">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  width={400}
                  height={400}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <span className="text-6xl">🛍️</span>
                </div>
              )}
            </div>
            {product.stock > 0 ? (
              <span className="absolute top-3 left-3 rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white">
                En stock
              </span>
            ) : (
              <span className="absolute top-3 left-3 rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white">
                Agotado
              </span>
            )}
          </div>

          {/* Info */}
          <div className="flex flex-col">
            {product.categoria && (
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {product.categoria}
              </span>
            )}
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold leading-tight">
              {product.name}
            </h1>
            {product.diseno && (
              <span className="mt-2 inline-block text-sm text-muted-foreground">
                Diseño: {product.diseno}
              </span>
            )}
            <p className="mt-4 text-3xl font-bold text-primary">
              {formatCurrency(product.price, 'COP')}
            </p>

            {product.description && (
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                {product.description}
              </p>
            )}

            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border bg-card p-3">
                <dt className="text-xs text-muted-foreground">SKU</dt>
                <dd className="font-mono font-medium">{product.sku}</dd>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <dt className="text-xs text-muted-foreground">Disponibilidad</dt>
                <dd className="font-medium">
                  {product.stock > 0
                    ? `${product.stock} unidades`
                    : 'Agotado'}
                </dd>
              </div>
            </dl>

            {/* WhatsApp CTA — prefilled text */}
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-green-600 px-6 py-3 text-base font-semibold text-white hover:bg-green-700 transition-colors"
            >
              <WhatsAppIcon className="h-5 w-5" />
              Comprar por WhatsApp
            </a>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Se abre WhatsApp con tu pedido listo para enviar.
            </p>
          </div>
        </div>

        {/* Back to catalog */}
        <div className="mt-10">
          <a
            href={`/t/${tenant.slug}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            ← Volver al catálogo de {tenant.marca}
          </a>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted-foreground">
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
