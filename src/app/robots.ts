import type { MetadataRoute } from 'next'

// ───────────────────────────────────────────────────────────────────────────
// robots.txt — allow public storefronts + directory, disallow API, admin,
// and private auth pages (login is a client-only SPA behind noindex).
// ───────────────────────────────────────────────────────────────────────────

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // `/` is allowed for crawling (so Google can follow internal links
        // to public storefronts + directorio) but is marked `noindex` via
        // the X-Robots-Tag response header set in src/middleware.ts.
        allow: ['/t/', '/directorio', '/'],
        disallow: [
          '/api/',
          '/vendedor',
          '/_next/',
          '/admin',
          '/login',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
