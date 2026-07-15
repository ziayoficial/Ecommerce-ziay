import { Metadata } from 'next'
import { RedocScript } from './redoc-script'

export const metadata: Metadata = {
  title: 'API Documentation',
  description: 'ZIAY API documentation',
  robots: { index: false, follow: false },
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
      <RedocScript />
      <div id="redoc-container" />
    </main>
  )
}
