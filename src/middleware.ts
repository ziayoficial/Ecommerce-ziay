import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

// ───────────────────────────────────────────────────────────────────────────
// Route protection middleware.
//
// PUBLIC ROUTES (no token required):
//   /login                       — sign-in page
//   /t/[slug]/**                 — public storefront SSR (per-tenant)
//   /t/[slug]/p/[sku]            — public product SSR
//   /vendedor/**                 — public seller profile SSR
//   /directorio                  — public tenant directory
//   /api/auth/**                 — NextAuth endpoints (sign-in, sign-out, session…)
//   /api/webhooks/**             — inbound webhooks (WhatsApp, Meta, payment gateways)
//   /api/health, /api/health/**  — uptime/health probes
//   /api/public/**               — explicitly public API surface
//   /_next/**, /favicon.ico, /logo.svg, /sitemap.xml, /robots.txt
//
// EVERYTHING ELSE (including `/` dashboard and all `/api/*` data routes)
// requires a valid NextAuth JWT.
// ───────────────────────────────────────────────────────────────────────────

const PUBLIC_PATTERNS: Array<RegExp | string> = [
  /^\/login(?:\/.*)?$/,
  /^\/t\/.+/, // public storefront SSR (per-tenant slug)
  /^\/vendedor(?:\/.*)?$/,
  /^\/directorio(?:\/.*)?$/,
  /^\/api\/auth(?:\/.*)?$/,
  /^\/api\/webhooks(?:\/.*)?$/,
  /^\/api\/health(?:\/.*)?$/,
  /^\/api\/public(?:\/.*)?$/,
  '/_next',
  '/favicon.ico',
  '/logo.svg',
  '/sitemap.xml',
  '/robots.txt',
]

function isPublic(path: string): boolean {
  for (const p of PUBLIC_PATTERNS) {
    if (typeof p === 'string') {
      if (path === p || path.startsWith(p + '/')) return true
    } else if (p.test(path)) {
      return true
    }
  }
  return false
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    // Public routes pass straight through.
    if (isPublic(path)) {
      return NextResponse.next()
    }

    // Authenticated users pass through.
    if (token) {
      return NextResponse.next()
    }

    // Unauthenticated users are redirected to login with a callback URL.
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', path)
    return NextResponse.redirect(loginUrl)
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname
        // Public routes never need a token — let the middleware fn handle them.
        if (isPublic(path)) return true
        return !!token
      },
    },
    pages: { signIn: '/login' },
  },
)

export const config = {
  // Run middleware on every route except static asset prefixes and the
  // Next.js image optimizer. We do NOT exclude /api/* — most API routes
  // are protected (the public API/webhook paths are whitelisted above).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.svg|presentaciones|assets|files).*)',
  ],
}
