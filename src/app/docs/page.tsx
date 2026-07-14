import { Metadata } from 'next'
import Script from 'next/script'

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
 * El spec YAML vive en `docs/openapi.yaml` (file system) y se sirve vía
 * una route handler con `force-static` + Cache-Control 1h.
 *
 * Usa `next/script` con `strategy="afterInteractive"` para cumplir con la
 * regla `@next/next/no-sync-scripts` (los `<script src="...">` síncronos
 * bloquean el render; `next/script` los carga de forma no bloqueante).
 * Cuando el bundle de ReDoc termina de cargar, `onLoad` invoca
 * `Redoc.init('/docs/openapi.yaml', ...)` sobre el `<div id="redoc-container">`.
 *
 * El middleware añade `cdn.jsdelivr.net` al CSP `script-src` solo para
 * esta ruta — el resto del app mantiene el CSP estricto (`'self'`).
 *
 * @see docs/openapi.yaml
 * @see src/app/docs/openapi.yaml/route.ts
 * @see src/middleware.ts — PUBLIC_PATTERNS + getCspForPath
 */
export default function DocsPage() {
  return (
    <main className="min-h-screen">
      <Script
        src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"
        strategy="afterInteractive"
        onLoad={() => {
          if (typeof window === 'undefined') return
          // ReDoc standalone expone `window.Redoc` cuando el bundle termina
          // de cargarse. El cast `any` es intencional — no hay tipos para
          // el bundle UMD global.
          const Redoc = (window as unknown as { Redoc?: unknown }).Redoc as
            | { init: (specUrl: string, opts: unknown, el: HTMLElement | null) => void }
            | undefined
          if (Redoc && typeof Redoc.init === 'function') {
            Redoc.init(
              '/docs/openapi.yaml',
              { theme: { colors: { primary: { main: '#10b981' } } } },
              document.getElementById('redoc-container'),
            )
          }
        }}
      />
      <div id="redoc-container" />
    </main>
  )
}
