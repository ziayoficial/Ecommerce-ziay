'use client'

import Script from 'next/script'

/**
 * Client component that loads ReDoc standalone from CDN and initializes it.
 * Extracted from the server component page to allow `onLoad` event handler.
 */
export function RedocScript() {
  return (
    <Script
      src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"
      strategy="afterInteractive"
      onLoad={() => {
        if (typeof window === 'undefined') return
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
  )
}
