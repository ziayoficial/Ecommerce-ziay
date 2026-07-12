import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

// ───────────────────────────────────────────────────────────────────────────
// Route protection middleware (ZIAY).
//
// PUBLIC ROUTES (no token required):
//   /login, /t/[slug]/**, /vendedor/**, /directorio
//   /api/auth/**, /api/webhooks/**, /api/health/**, /api/public/**
//   /_next/**, /favicon.ico, /logo.svg, /sitemap.xml, /robots.txt
//
// EVERYTHING ELSE requires a valid NextAuth JWT.
// ───────────────────────────────────────────────────────────────────────────

const PUBLIC_PATTERNS: Array<RegExp | string> = [
  /^\/login(?:\/.*)?$/,
  /^\/t\/.+/,
  /^\/vendedor(?:\/.*)?$/,
  /^\/directorio(?:\/.*)?$/,
  /^\/api\/auth(?:\/.*)?$/,
  /^\/api\/webhooks(?:\/.*)?$/,
  /^\/api\/health(?:\/.*)?$/,
  /^\/api\/public(?:\/.*)?$/,
  '/_next',
  '/favicon.ico',
  '/logo.svg',
  '/favicon.svg',
  '/logo-white.svg',
  '/sitemap.xml',
  '/robots.txt',
  '/presentaciones',
]

function isPublic(path: string): boolean {
  for (const p of PUBLIC_PATTERNS) {
    if (typeof p === 'string') {
      if (path === p || path.startsWith(p)) return true
    } else if (p.test(path)) {
      return true
    }
  }
  return false
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  // Public routes pass straight through.
  if (isPublic(path)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Check for NextAuth JWT token.
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  if (token) {
    return addSecurityHeaders(NextResponse.next())
  }

  // No token → redirect to login (for pages) or 401 JSON (for APIs).
  if (path.startsWith('/api/')) {
    return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }

  const loginUrl = new URL('/login', req.url)
  loginUrl.searchParams.set('callbackUrl', path)
  return addSecurityHeaders(NextResponse.redirect(loginUrl))
}

function addSecurityHeaders(response: NextResponse) {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (response.headers.get('content-type')?.includes('application/json')) {
    response.headers.set('Content-Security-Policy', "default-src 'none'")
  }
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.svg|presentaciones|assets|files).*)',
  ],
}
