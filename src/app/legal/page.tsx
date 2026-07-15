import type { Metadata } from 'next'
import Link from 'next/link'

// ───────────────────────────────────────────────────────────────────────────
// /legal — SSR índice legal
//
// FIX-LEGAL-P0-001 L-1 — public landing for legal documents. Single entry
// point for tenants, customers, regulators, and crawlers. Mirrors /privacy +
// /terms SSR pattern.
// ───────────────────────────────────────────────────────────────────────────

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Índice Legal',
  description:
    'Documentos legales de ZIAY — Política de Privacidad, Términos de Servicio, Política de Cookies. Indisutex SAS.',
  alternates: { canonical: `${BASE_URL}/legal` },
  openGraph: {
    title: 'Índice Legal · ZIAY',
    description:
      'Documentos legales de ZIAY — Política de Privacidad, Términos de Servicio, Política de Cookies.',
    url: `${BASE_URL}/legal`,
    type: 'website',
    locale: 'es_CO',
    siteName: 'ZIAY',
  },
  robots: { index: true, follow: true },
}

const LEGAL_DOCS = [
  {
    href: '/privacy',
    title: 'Política de Privacidad',
    description:
      'Tratamiento de datos personales conforme a la Ley 1581 de 2012 (Habeas Data).',
    legalRef: 'Ley 1581 / 2012 · Decreto 1377 / 2013',
  },
  {
    href: '/terms',
    title: 'Términos de Servicio',
    description:
      'Condiciones de uso de la plataforma ZIAY para comercios y clientes finales.',
    legalRef: 'Ley 1480 / 2011 · Ley 640 / 2001',
  },
  {
    href: '/legal#cookies',
    title: 'Política de Cookies',
    description:
      'Uso de cookies de sesión estrictamente necesarias y preferencias.',
    legalRef: 'ePrivacy · Ley 1581 Art 10',
  },
]

export default function LegalIndexPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <header className="mb-10 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Índice Legal</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Indisutex SAS · Bogotá D.C., Colombia ·{' '}
            <a
              href="mailto:datos@ziay.co"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              datos@ziay.co
            </a>
          </p>
        </header>

        <ul className="space-y-4 list-none p-0">
          {LEGAL_DOCS.map((doc) => (
            <li key={doc.href}>
              <Link
                href={doc.href}
                className="group block rounded-lg border p-6 hover:border-primary hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold group-hover:text-primary">
                      {doc.title}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {doc.description}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {doc.legalRef}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        <section
          id="cookies"
          className="mt-12 rounded-lg border p-6 scroll-mt-24"
        >
          <h2 className="text-xl font-semibold mb-2">Política de Cookies</h2>
          <p className="text-sm leading-relaxed">
            ZIAY utiliza únicamente cookies <strong>estrictamente necesarias</strong>{' '}
            para el funcionamiento de la sesión (autenticación NextAuth) y la
            preferencia de idioma y tema. No se instalan cookies de
            analítica ni publicidad sin consentimiento expreso. En consecuencia,
            no se requiere banner de consentimiento bajo la Directiva
            ePrivacy o la Ley 1581 de 2012 para las cookies actualmente
            desplegadas. Si en el futuro se incorporan cookies no esenciales
            (analítica, marketing), se instalará un banner de consentimiento
            y se actualizará esta política.
          </p>
        </section>

        <section className="mt-8 rounded-lg border p-6 bg-muted/30">
          <h2 className="text-lg font-semibold mb-2">Datos del Responsable</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Razón social</dt>
            <dd>Indisutex SAS</dd>
            <dt className="text-muted-foreground">Domicilio</dt>
            <dd>Bogotá D.C., Colombia</dd>
            <dt className="text-muted-foreground">Correo de contacto (DPO)</dt>
            <dd>
              <a
                href="mailto:datos@ziay.co"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                datos@ziay.co
              </a>
            </dd>
            <dt className="text-muted-foreground">Autoridad de control</dt>
            <dd>Superintendencia de Industria y Comercio (SIC)</dd>
          </dl>
        </section>

        <footer className="mt-12 border-t pt-6 text-xs text-muted-foreground">
          <Link
            href="/privacy"
            className="mr-4 hover:text-foreground hover:underline"
          >
            Política de Privacidad
          </Link>
          <Link href="/terms" className="mr-4 hover:text-foreground hover:underline">
            Términos de Servicio
          </Link>
          <Link href="/" className="hover:text-foreground hover:underline">
            Inicio
          </Link>
        </footer>
      </div>
    </main>
  )
}
