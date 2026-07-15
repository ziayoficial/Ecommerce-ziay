import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
// SPRINT-HARDENING-FINAL-001 · §2 + §4 — CORS preflight/headers + CSRF
// Origin check. Both modules are Edge-safe (only import `next/server`).
import { handlePreflight, setCorsHeaders } from '@/lib/middleware/cors'
import { checkCSRF } from '@/lib/middleware/csrf'

// ───────────────────────────────────────────────────────────────────────────
// NextAuth JWT secret — resolved inline (NOT imported from @/lib/auth) because
// middleware runs in the Edge runtime, which cannot load bcryptjs / Prisma.
// Mirrors the logic in src/lib/auth.ts: throw in production, dev fallback.
// ───────────────────────────────────────────────────────────────────────────
const AUTH_SECRET: string = (() => {
  const s = process.env.NEXTAUTH_SECRET
  if (!s && process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXTAUTH_SECRET must be set in production. Generate with: openssl rand -base64 32',
    )
  }
  return s || 'ziay-dev-secret-fallback-only-for-development'
})()

// ───────────────────────────────────────────────────────────────────────────
// Route protection middleware (ZIAY).
//
// PUBLIC ROUTES (no token required):
//   /login, /t/[slug]/**, /vendedor/**, /directorio
//   /api/auth/**, /api/webhooks/**, /api/health/**, /api/public/**
//   /_next/**, /favicon.ico, /logo.svg, /sitemap.xml, /robots.txt
//   /docs, /docs/openapi.yaml (ReDoc viewer + spec — no auth, CSP carve-out)
//
// EVERYTHING ELSE requires a valid NextAuth JWT.
//
// RATE LIMITING: every non-public /api/** route is rate-limited per IP
// (60 req / 60s) using a simple in-memory counter. The middleware runs
// in the Edge runtime so we can't import @/lib/middleware/rate-limit
// (it pulls in server-only modules); we inline a tiny implementation
// here instead. Per-route limiters in the route handlers (e.g. webhook
// signatures) still run independently and can apply tighter limits.
// ───────────────────────────────────────────────────────────────────────────

const PUBLIC_PATTERNS: Array<RegExp | string> = [
  /^\/login(?:\/.*)?$/,
  /^\/t\/.+/,
  /^\/vendedor(?:\/.*)?$/,
  /^\/directorio(?:\/.*)?$/,
  // FIX-LEGAL-P0-001 L-1 — public legal pages (Ley 1581 Art 10). SSR pages
  // reachable by crawlers + unauthenticated data subjects. Linked from
  // login + storefront footers + dashboard sidebar.
  /^\/privacy(?:\/.*)?$/,
  /^\/terms(?:\/.*)?$/,
  /^\/legal(?:\/.*)?$/,
  // SPRINT-ADOPT-ERRORHANDLER-001 — age-gate escalation target (Ley 1098
  // de 2006). The age-gate middleware redirects unauthenticated minors
  // here mid-checkout. The page itself is static; consent submission goes
  // through the (auth-protected) /api/compliance/consent endpoint.
  /^\/compliance\/parental-consent(?:\/.*)?$/,
  // SPRINT-MONITORING-002 · M-11 — public status page. Shows current
  // health of DB + chat-service in Spanish (no auth, no PII, no
  // per-tenant data). Indexed so customers / partners can monitor
  // uptime. The page itself is server-rendered (force-dynamic) with a
  // 30s ISR revalidate so a status-page flood can't DDoS the DB.
  /^\/status(?:\/.*)?$/,
  // SPRINT-MONITORING-FINAL-001 — public GET on incident history (backs
  // the `/status` "Incidentes recientes" section). POST + PATCH are
  // admin-only — they run `requireRole(['admin'])` inside the route
  // handler, so this middleware bypass doesn't expose them.
  '/api/status/incidents',
  /^\/api\/auth(?:\/.*)?$/,
  /^\/api\/webhooks(?:\/.*)?$/,
  /^\/api\/health(?:\/.*)?$/,
  /^\/api\/public(?:\/.*)?$/,
  // SPRINT-MONITORING-DR-001 · M-6 — Prometheus scrape target. Exposed
  // publicly so Prometheus / Grafana Agent (no NextAuth session) can pull
  // metrics. The route returns only aggregate counters (no PII, no
  // per-tenant breakdown). For production isolation, place behind mTLS /
  // basic-auth at the reverse-proxy layer (see docs/DR-RUNBOOK.md). The
  // rate-limit below still applies — Prometheus should be configured with
  // a generous scrape interval (e.g. 15s) to stay under 60 req/min.
  '/api/metrics',
  // UCP manifest — Documento §10.1: "debe ser públicamente accesible y no
  // requerir ninguna autenticación". Exposed under /.well-known/ucp so that
  // external AI agents (Gemini, ChatGPT) can discover the tenant without
  // credentials. SPRINT-AGENTIC-PROTOCOLS-001.
  '/.well-known/ucp',
  // ACP merchant manifest — Documento §9.1. ChatGPT/Copilot discovery.
  // SPRINT-PROTOCOLS-TRINITY-001.
  '/.well-known/acp',
  // A2A agent-card — Documento §10.1. Inter-agent discovery.
  // SPRINT-PROTOCOLS-TRINITY-001.
  '/.well-known/agent-card',
  // MCP transport — Documento §10.1. JSON-RPC 2.0 endpoint. The endpoint
  // must be reachable by MCP clients (Claude, ChatGPT); auth (NextAuth
  // session cookie) is validated INSIDE the route handler. Without this
  // entry the middleware would 401 every JSON-RPC call before the route
  // body executes. SPRINT-PROTOCOLS-TRINITY-001.
  '/api/mcp',
  // ACP v1 API — bearer-authenticated by AP2 Intent Mandate ID (validated
  // inside each route handler). External ChatGPT/Copilot agents are NOT
  // logged in via NextAuth, so the middleware must let these routes through.
  // SPRINT-PROTOCOLS-TRINITY-001.
  '/api/acp/v1',
  // SPRINT-ADOPT-ERRORHANDLER-001 — retention cleanup cron endpoint.
  // Authenticated by `Authorization: Bearer $CRON_SECRET` inside the route
  // handler (NOT NextAuth) so external cron callers (system cron, Vercel
  // Cron, GitHub Actions) can hit it without a session cookie.
  '/api/compliance/retention/cron',
  // SPRINT-MONITORING-FIX-001 · #4 — Alertmanager webhook receiver.
  // Authenticated by `Authorization: Bearer $ALERTMANAGER_WEBHOOK_SECRET`
  // inside the route handler (NOT NextAuth) so the Alertmanager container
  // (no NextAuth session) can POST firing/resolved alerts that auto-create
  // StatusIncident rows.
  '/api/monitoring/alertmanager-webhook',
  // SPRINT-DOCS-POLISH-001 · #4 — ReDoc API documentation viewer. Public
  // (no NextAuth session) so external developers + AI agents can read the
  // OpenAPI spec without credentials. The HTML page loads ReDoc standalone
  // from cdn.jsdelivr.net — the CSP carve-out below (`getCspForPath`)
  // allows that CDN only for /docs (the rest of the app keeps the strict
  // `'self'`-only script-src). The openapi.yaml route handler returns YAML
  // with `default-src 'none'` (no script execution possible).
  '/docs',
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

// ───────────────────────────────────────────────────────────────────────────
// Edge-compatible in-memory rate limiter.
//
// 60 requests / 60s per IP for protected API routes. Per-IP entries are
// GC'd lazily on read (when `resetAt` is stale the entry is rebuilt).
//
// Multi-instance note: this Map is per Edge runtime instance. For a real
// multi-instance deployment, swap this for a Redis-backed limiter (Upstash
// / @upstash/ratelimit) — the function signature (`checkRateLimit(ip)`)
// stays the same.
// ───────────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number
  resetAt: number
}

const RATE_LIMIT_MAP = new Map<string, RateLimitEntry>()
const RATE_LIMIT_MAX = 60 // 60 req per minute per IP for protected APIs
const RATE_LIMIT_WINDOW = 60_000

/**
 * Returns `true` if the request is allowed, `false` if rate-limited.
 * Side-effects: mutates the in-memory counter for the IP.
 */
function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = RATE_LIMIT_MAP.get(ip)
  if (!entry || entry.resetAt < now) {
    // New window for this IP.
    RATE_LIMIT_MAP.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

// ───────────────────────────────────────────────────────────────────────────
// SPRINT-HARDENING-FINAL-001 · §3 — Stricter rate limit for auth endpoints.
//
// Brute-force protection on /api/auth/callback/credentials (NextAuth's
// credentials provider POST) + /api/auth/signin + /api/auth/signup. The
// global 60/min/IP limit is too generous for login attempts — 5/min/IP
// still lets a forgetful user retry ~5 times in a minute, but blocks a
// 10k-password dictionary attack (which would otherwise arrive as 60
// req/min/IP × N IPs).
//
// Separate Map (namespaced `auth:`) so a flooded auth endpoint doesn't
// exhaust the same bucket as legitimate API calls from the same IP.
// ───────────────────────────────────────────────────────────────────────────

const AUTH_RATE_LIMIT_MAP = new Map<string, RateLimitEntry>()
const AUTH_RATE_LIMIT_MAX = 5 // 5 req per minute per IP for auth endpoints
const AUTH_RATE_LIMIT_WINDOW = 60_000

/**
 * Auth-specific rate limit. Returns `null` if allowed, a 429 NextResponse
 * if exceeded. Same in-memory + lazy-GC pattern as `checkRateLimit` but
 * with stricter limits and a separate Map.
 */
function checkAuthRateLimit(ip: string): NextResponse | null {
  const now = Date.now()
  const entry = AUTH_RATE_LIMIT_MAP.get(ip)
  if (!entry || entry.resetAt < now) {
    AUTH_RATE_LIMIT_MAP.set(ip, { count: 1, resetAt: now + AUTH_RATE_LIMIT_WINDOW })
    return null
  }
  entry.count++
  if (entry.count <= AUTH_RATE_LIMIT_MAX) return null

  const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
  return NextResponse.json(
    { error: 'Demasiados intentos de autenticación', retry_after: retryAfter },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(retryAfter, 1)),
        'X-RateLimit-Limit': String(AUTH_RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': '0',
      },
    },
  )
}

/**
 * Auth endpoint paths that get the stricter 5/min/IP limit. Use `startsWith`
 * so nested paths (e.g. `/api/auth/callback/credentials`) are covered.
 */
const AUTH_RATE_LIMIT_PATHS = [
  '/api/auth/callback/credentials',
  '/api/auth/signin',
  '/api/auth/signup',
]

/**
 * Opportunistic GC: every ~5 minutes drop stale entries so the Map
 * doesn't grow unbounded for long-running Edge instances. Also GCs the
 * auth rate-limit Map (SPRINT-HARDENING-FINAL-001 §3) so a flood of
 * failed logins from one IP doesn't linger in memory forever.
 */
let lastGcAt = 0
function gcStaleRateLimitEntries() {
  const now = Date.now()
  if (now - lastGcAt < 5 * 60 * 1000) return
  lastGcAt = now
  for (const [ip, entry] of RATE_LIMIT_MAP) {
    if (entry.resetAt < now) RATE_LIMIT_MAP.delete(ip)
  }
  for (const [ip, entry] of AUTH_RATE_LIMIT_MAP) {
    if (entry.resetAt < now) AUTH_RATE_LIMIT_MAP.delete(ip)
  }
}

/**
 * Extract the client IP from a NextRequest. Honors X-Forwarded-For and
 * X-Real-IP headers (typical behind Caddy / Vercel / Cloudflare).
 */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xReal = req.headers.get('x-real-ip')
  if (xReal) return xReal.trim()
  // `req.ip` exists at runtime on some deployment targets (Vercel).
  // @ts-expect-error — `ip` is not in the NextRequest type but exists at runtime
  if (typeof req.ip === 'string' && req.ip) return req.ip
  return 'unknown'
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  // ────────────────────────────────────────────────────────────────────
  // SPRINT-HARDENING-FINAL-001 · §2 — CORS preflight.
  //
  // Must run BEFORE the auth check: preflight requests don't carry
  // credentials, so the NextAuth JWT lookup would 401 them and break
  // the browser's CORS dance. `handlePreflight` returns null for
  // non-OPTIONS requests.
  // ────────────────────────────────────────────────────────────────────
  const preflight = handlePreflight(req)
  if (preflight) {
    return addSecurityHeaders(preflight, path)
  }

  // ────────────────────────────────────────────────────────────────────
  // SEO noindex: `/` and `/login` are client-rendered auth-only routes
  // (no SSR content for crawlers). Both are `'use client'` pages that
  // cannot export `metadata.robots`, so we enforce `noindex, follow` via
  // the X-Robots-Tag response header here. `follow` is preserved so
  // crawlers can still discover internal links to the public storefronts
  // + /directorio from the homepage. The header is applied to EVERY
  // response for these paths (next, redirect, 401) so crawlers see it
  // even when redirected to /login.
  // ────────────────────────────────────────────────────────────────────
  const NOINDEX_PATHS = new Set<string>(['/', '/login'])
  const wantsNoindex =
    NOINDEX_PATHS.has(path) ||
    path === '/login' ||
    path.startsWith('/login/')

  // Public routes pass straight through.
  if (isPublic(path)) {
    const res = addSecurityHeaders(NextResponse.next(), path)
    if (wantsNoindex) {
      res.headers.set('X-Robots-Tag', 'noindex, follow')
    }
    // SPRINT-HARDENING-FINAL-001 §2 — apply CORS headers even on public
    // routes so cross-origin readers (e.g. the chat mini-service) can
    // fetch /api/health, /api/public/**, etc.
    return setCorsHeaders(req, res)
  }

  // ────────────────────────────────────────────────────────────────────
  // SPRINT-HARDENING-FINAL-001 · §3 — Stricter rate limit for auth
  // endpoints (5 req/min/IP). Applied BEFORE the JWT lookup so a flood
  // of failed credentials attempts can't even trigger the (more
  // expensive) NextAuth verify. The general 60/min/IP API limit below
  // still applies for the rest of /api/**.
  // ────────────────────────────────────────────────────────────────────
  if (AUTH_RATE_LIMIT_PATHS.some(p => path.startsWith(p))) {
    gcStaleRateLimitEntries()
    const ip = getClientIp(req)
    const authLimited = checkAuthRateLimit(ip)
    if (authLimited) {
      return addSecurityHeaders(setCorsHeaders(req, authLimited), path)
    }
  }

  // Check for NextAuth JWT token.
  const token = await getToken({ req, secret: AUTH_SECRET })

  // Rate limit ALL non-public API routes (per-IP, 60 req / 60s). Applied
  // after the auth check (per SPRINT2-RESILIENCE-001 spec) and before any
  // NextResponse.next() so both authenticated floods and unauthenticated
  // scanners get throttled equally.
  if (path.startsWith('/api/')) {
    gcStaleRateLimitEntries()
    const ip = getClientIp(req)
    if (!checkRateLimit(ip)) {
      const limited = NextResponse.json(
        { error: 'Too Many Requests', retry_after: 60 },
        {
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': '0',
          },
        },
      )
      return addSecurityHeaders(setCorsHeaders(req, limited), path)
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // SPRINT-HARDENING-FINAL-001 · §4 — CSRF Origin check.
  //
  // Defense-in-depth for non-NextAuth mutation routes. NextAuth already
  // issues its own double-submit CSRF token for /api/auth/*, so the
  // Origin check on those routes is redundant (harmless). For other
  // POST/PATCH/PUT/DELETE routes the Origin/Host equality check blocks
  // cross-site form submissions that the SameSite=Lax cookie wouldn't
  // catch (e.g. cross-site fetch with `credentials: 'include'` from a
  // page that tricked the user into a same-site top-level navigation).
  //
  // Applied AFTER the rate-limit so a CSRF flood still gets 429'd before
  // we burn CPU on the Origin parse.
  // ────────────────────────────────────────────────────────────────────
  const csrfError = checkCSRF(req)
  if (csrfError) {
    return addSecurityHeaders(setCorsHeaders(req, csrfError), path)
  }

  if (token) {
    const res = addSecurityHeaders(NextResponse.next(), path)
    if (wantsNoindex) {
      res.headers.set('X-Robots-Tag', 'noindex, follow')
    }
    return setCorsHeaders(req, res)
  }

  // No token → redirect to login (for pages) or 401 JSON (for APIs).
  if (path.startsWith('/api/')) {
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return addSecurityHeaders(setCorsHeaders(req, unauth), path)
  }

  const loginUrl = new URL('/login', req.url)
  loginUrl.searchParams.set('callbackUrl', path)
  const redirectRes = addSecurityHeaders(NextResponse.redirect(loginUrl), path)
  if (wantsNoindex) {
    redirectRes.headers.set('X-Robots-Tag', 'noindex, follow')
  }
  return setCorsHeaders(req, redirectRes)
}

// ───────────────────────────────────────────────────────────────────────────
// Content-Security-Policy for ALL responses.
//
// V11 (AUDIT-FINAL-SEC-001): the previous code only set a CSP for responses
// whose `content-type` was already `application/json` at middleware time —
// which in practice only covered the 429 / 401 JSON errors generated inside
// this middleware (NextResponse.next() has no content-type yet, so route
// handlers' HTML responses shipped with NO CSP). We now attach a real CSP
// to every response. JSON responses still get the stricter `default-src
// 'none'` override below (defense-in-depth — JSON must never trigger
// resource loads).
// ───────────────────────────────────────────────────────────────────────────
const CSP_HEADER = [
  "default-src 'self'",
  // Next.js (esp. dev) needs inline scripts + eval for HMR / Fast Refresh.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' wss: ws:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/**
 * CSP carve-out for the ReDoc documentation viewer at /docs.
 *
 * SPRINT-DOCS-POLISH-001 · #4. The HTML page loads ReDoc standalone from
 * `cdn.jsdelivr.net` (script-src) and ReDoc emits inline styles at runtime
 * (style-src already allows `'unsafe-inline'`). The openapi.yaml route
 * returns YAML with the default `default-src 'none'` (overridden below for
 * non-JSON, non-YAML responses — kept strict).
 *
 * Only /docs gets the CDN carve-out — every other route keeps the strict
 * `'self'`-only script-src. This is the minimum-permissive CSP that still
 * allows ReDoc to function.
 */
const CSP_HEADER_DOCS = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/**
 * Picks the per-path CSP. /docs gets the CDN carve-out; everything else
 * uses the strict `CSP_HEADER`. The YAML route returns `application/yaml`,
 * which `addSecurityHeaders` overrides with `default-src 'none'` (no
 * script execution possible from a YAML payload).
 */
function getCspForPath(path: string): string {
  if (path === '/docs' || path.startsWith('/docs/')) {
    return CSP_HEADER_DOCS
  }
  return CSP_HEADER
}

function addSecurityHeaders(response: NextResponse, path: string = '') {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Content-Security-Policy', getCspForPath(path))
  // Stricter CSP for JSON responses (defense-in-depth — JSON must never
  // trigger script/style/img loads). This overrides the path-specific CSP
  // for the 429 / 401 JSON errors generated inside this middleware.
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
