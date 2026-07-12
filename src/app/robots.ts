import type { MetadataRoute } from 'next'

// ───────────────────────────────────────────────────────────────────────────
// robots.txt — allow public storefronts + directory, disallow API & admin.
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
        allow: ['/t/', '/directorio', '/'],
        disallow: [
          '/api/',
          '/vendedor',
          '/_next/',
          '/admin',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
