import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// ───────────────────────────────────────────────────────────────────────────
// SPRINT-MONITORING-DR-001 · M-10 — Web Vitals ingestion endpoint.
//
// Receives Core Web Vitals (LCP, FID/INP, CLS, FCP, TTFB) posted from the
// client via `navigator.sendBeacon` (see src/app/layout.tsx `reportWebVitals`).
//
// Currently logs the metric through the structured pino logger so ops can
// tail/grep them. The shape is intentionally compatible with the most common
// analytics backends (Vercel Analytics, Grafana Loki, Datadog RUM) so the
// forwarding logic is a one-line change once we pick a backend.
//
// Auth: this route is NOT in PUBLIC_PATTERNS, so it requires a valid NextAuth
// JWT (rate-limited 60/min per IP at the middleware). The `reportWebVitals`
// callback in layout.tsx only fires in production, and `sendBeacon` includes
// session cookies automatically — so dashboard users will successfully post.
// Anonymous users on the storefront (`/t/[slug]`) will get 401s; the beacon
// failure is silent (no console noise). If we ever need storefront vitals,
// either (a) add this route to PUBLIC_PATTERNS + tighter rate limit, or
// (b) implement anonymous session-less ingestion via a signed upload token.
// ───────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

// Zod schema — same shape Next.js passes to reportWebVitals, plus `page`.
const WebVitalSchema = z.object({
  name: z.string().min(2).max(32),
  value: z.number(),
  id: z.string().min(1).max(128),
  page: z.string().min(1).max(512).optional().default('/'),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
      { status: 400 },
    )
  }

  const parsed = WebVitalSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid web vital payload',
        code: 'BAD_REQUEST',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const { name, value, id, page } = parsed.data

  // Log as structured JSON so the log shipper (Loki / CloudWatch / Datadog)
  // can index `metric.name` + `metric.value` directly. The `web_vital` event
  // type lets ops filter: `event=web_vital AND metric.name=LCP`.
  logger.info(
    {
      event: 'web_vital',
      metric: { name, value, id },
      page,
    },
    'web vital received',
  )

  return NextResponse.json({ ok: true }, { status: 202 })
}
