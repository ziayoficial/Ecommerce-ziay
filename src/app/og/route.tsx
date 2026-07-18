// ZIAY — Dynamic Open Graph image (PNG) route.
//
// SEO-3 (IF-3) — replaces the legacy `/og-default.svg` static asset. Twitter,
// Facebook, LinkedIn, and Slack do NOT render SVG as an OG image — they need
// PNG / JPG / WebP. CTR of shared links was effectively 0%.
//
// This route uses Next.js' built-in `next/og` `ImageResponse` (powered by
// `@vercel/og` under the hood — bundled inside `next` since v13). It runs on
// the Edge runtime so the image is generated close to the user (cached on the
// CDN after the first request).
//
// Output: 1200×630 PNG (the canonical OG image size recommended by Twitter
// and Facebook). The design matches the brand palette already in use across
// the app:
//   - Background: deep `#0a0f0d` (matches the dark theme body)
//   - Accent:     `#10b981` (emerald-500, ZIAY brand color)
//   - Subtle:     `#e8f0ec` (off-white for secondary text)
//
// Note on JSX-in-ImageResponse: only a SUBSET of CSS is supported (flexbox,
// no grid; no `position: absolute` unless parent is `relative` + `display:
// flex`; limited pseudo-classes). All styles are inline to keep the bundle
// small + avoid runtime CSS parsing.
//
// File extension: `.tsx` (not `.ts`) because the route uses JSX to render
// the image. Next.js App Router supports both, but JSX forces `.tsx`.
//
// Replaces: `/public/og-default.svg` (kept on disk for backward compat with
// any cached social-graph crawlers that may still reference it).

import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

// Cache the generated image at the CDN for 1 hour. `revalidate` (in seconds)
// is Next's ISR knob for route handlers — re-runs the generator at most once
// per hour per edge region.
export const revalidate = 3600

// Static metadata exported so crawlers + dev tools can introspect the route.
export const alt = 'ZIAY · Comercio Conversacional + Atribución Inteligente'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * GET /og — returns a 1200×630 PNG branded for ZIAY.
 *
 * Query params (optional, for per-page overrides):
 *   - `?title=`    Brand mark text (default: "ZIAY").
 *   - `?subtitle=` Tagline under the brand mark (default: the full ZIAY
 *                  descriptor).
 *
 * Example: `/og?title=Mi%20Producto&subtitle=Descripción` returns a PNG with
 * the product name as the brand mark — useful for product-detail pages that
 * want a contextual OG card.
 */
export async function GET(req: NextRequest): Promise<ImageResponse> {
  const title = req.nextUrl.searchParams.get('title') ?? 'ZIAY'
  const subtitle =
    req.nextUrl.searchParams.get('subtitle') ??
    'Comercio Conversacional + Atribución Inteligente'

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#0a0f0d',
          backgroundImage:
            'radial-gradient(circle at 25% 20%, rgba(16,185,129,0.18) 0%, rgba(10,15,13,0) 50%), radial-gradient(circle at 80% 80%, rgba(13,148,136,0.15) 0%, rgba(10,15,13,0) 50%)',
          color: '#e8f0ec',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: '60px',
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        {/* Decorative border — mirrors the SVG's `stroke="#10b981"` ring */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 50,
            left: 50,
            right: 50,
            bottom: 50,
            borderRadius: 24,
            border: '2px solid rgba(16,185,129,0.3)',
          }}
        />
        {/* Brand mark */}
        <div
          style={{
            display: 'flex',
            fontSize: 96,
            fontWeight: 800,
            color: '#10b981',
            letterSpacing: '-0.02em',
            marginBottom: 12,
          }}
        >
          {title}
        </div>
        {/* Tagline */}
        <div
          style={{
            display: 'flex',
            fontSize: 32,
            color: '#e8f0ec',
            opacity: 0.85,
            textAlign: 'center',
            maxWidth: 900,
          }}
        >
          {subtitle}
        </div>
        {/* Footer chips */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            marginTop: 40,
          }}
        >
          {['LATAM', 'WhatsApp', 'Messenger', 'Instagram', 'IA'].map((chip) => (
            <div
              key={chip}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '8px 20px',
                borderRadius: 999,
                backgroundColor: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.35)',
                color: '#10b981',
                fontSize: 22,
                fontWeight: 600,
              }}
            >
              {chip}
            </div>
          ))}
        </div>
        {/* Domain footer */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            bottom: 70,
            fontSize: 22,
            color: '#10b981',
            opacity: 0.5,
            letterSpacing: '0.04em',
          }}
        >
          ziay.com
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
