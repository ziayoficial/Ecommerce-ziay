import { Metadata } from 'next'
import { RedocScript } from './redoc-script'

export const metadata: Metadata = {
  title: 'API Documentation',
  description: 'ZIAY API documentation',
  robots: { index: false, follow: false },
  // SEO-5 (IF-4) — canonical declared even on noindex pages so search
  // engines consolidate any stray inbound links to the canonical URL.
  alternates: { canonical: '/docs' },
}

/**
 * Página de documentación ReDoc.
 *
 * Monta el visor ReDoc standalone (CDN) y carga el OpenAPI spec desde
 * `/docs/openapi.yaml` (servido por `src/app/docs/openapi.yaml/route.ts`).
 *
 * El Script con onLoad vive en un Client Component separado (`redoc-script.tsx`)
 * porque Next.js 16 no permite pasar event handlers (funciones) desde
 * Server Components a Client Components.
 */
export default function DocsPage() {
  return (
    <main className="min-h-screen">
      <h1 className="sr-only">Documentación de API</h1>
      <RedocScript />
      <div id="redoc-container" />
    </main>
  )
}
