import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { setCacheHeaders } from '@/lib/middleware/cache-headers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ───────────────────────────────────────────────────────────────────────────
// SPRINT-MONITORING-DR-001 · M-6 — Prometheus metrics endpoint.
//
// Exposes a `/metrics` scrape target for Prometheus / Grafana Agent. Returns
// the text exposition format (v0.0.4) — see
// https://prometheus.io/docs/instrumenting/exposition_formats/.
//
// Metrics exposed:
//   - ziay_db_connected               (gauge) — 1 if `SELECT 1` succeeds, 0 otherwise
//   - ziay_tenants_total              (gauge) — total tenant count
//   - ziay_orders_today               (gauge) — orders created since local midnight
//   - ziay_conversations_open         (gauge) — conversations with status='open'
//   - ziay_withdrawals_pending        (gauge) — withdrawal requests in
//                                                pending_2fa / pending_processing
//   - ziay_node_memory_rss_bytes      (gauge) — process RSS (bytes)
//   - ziay_node_memory_heap_used_bytes (gauge) — V8 heap used (bytes)
//   - ziay_node_uptime_seconds        (gauge) — process uptime (seconds)
//
// SECURITY: this route is added to PUBLIC_PATTERNS in src/middleware.ts so
// Prometheus (which has no NextAuth session) can scrape it. The exposed
// numbers are aggregate counters (no PII, no per-tenant breakdown). For
// production deployments that need stronger isolation, place this route
// behind an mTLS / basic-auth firewall at the reverse-proxy layer (Caddy /
// nginx) instead of exposing it publicly. See docs/DR-RUNBOOK.md.
// ───────────────────────────────────────────────────────────────────────────

/**
 * GET /api/metrics
 *
 * Prometheus-style metrics endpoint (counters + histograms).
 *
 * @security Public (intended for scraping)
 * @returns Prometheus text-format metrics
 */
export const GET = withErrorHandling(async () => {

  const metrics: string[] = []

  // DB connection check — always run first so that if the DB is down, the
  // other queries short-circuit and we still return a valid scrape (with
  // `ziay_db_connected 0` and the process metrics).
  let dbConnected = 0
  try {
    await db.$queryRaw`SELECT 1`
    dbConnected = 1
  } catch {
    dbConnected = 0
  }

  metrics.push('# HELP ziay_db_connected Database connection status (1=up, 0=down)')
  metrics.push('# TYPE ziay_db_connected gauge')
  metrics.push(`ziay_db_connected ${dbConnected}`)

  // Tenant count
  try {
    const tenantCount = await db.tenant.count()
    metrics.push('# HELP ziay_tenants_total Total number of tenants')
    metrics.push('# TYPE ziay_tenants_total gauge')
    metrics.push(`ziay_tenants_total ${tenantCount}`)

    // Orders today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const ordersToday = await db.order.count({
      where: { createdAt: { gte: today } },
    })
    metrics.push('# HELP ziay_orders_today Orders created today')
    metrics.push('# TYPE ziay_orders_today gauge')
    metrics.push(`ziay_orders_today ${ordersToday}`)

    // Open conversations
    const openConversations = await db.conversation.count({
      where: { status: 'open' },
    })
    metrics.push('# HELP ziay_conversations_open Open conversations')
    metrics.push('# TYPE ziay_conversations_open gauge')
    metrics.push(`ziay_conversations_open ${openConversations}`)

    // Pending withdrawals
    const pendingWithdrawals = await db.withdrawalRequest.count({
      where: { status: { in: ['pending_2fa', 'pending_processing'] } },
    })
    metrics.push('# HELP ziay_withdrawals_pending Pending withdrawal requests')
    metrics.push('# TYPE ziay_withdrawals_pending gauge')
    metrics.push(`ziay_withdrawals_pending ${pendingWithdrawals}`)
  } catch {
    // DB error — just return the connection status. The other metrics are
    // omitted so Prometheus doesn't see stale values from a prior scrape.
  }

  // Process metrics — always available (Node.js process API).
  const memUsage = process.memoryUsage()
  metrics.push('# HELP ziay_node_memory_rss_bytes Node.js RSS memory in bytes')
  metrics.push('# TYPE ziay_node_memory_rss_bytes gauge')
  metrics.push(`ziay_node_memory_rss_bytes ${memUsage.rss}`)

  metrics.push('# HELP ziay_node_memory_heap_used_bytes Node.js heap used in bytes')
  metrics.push('# TYPE ziay_node_memory_heap_used_bytes gauge')
  metrics.push(`ziay_node_memory_heap_used_bytes ${memUsage.heapUsed}`)

  metrics.push('# HELP ziay_node_uptime_seconds Process uptime in seconds')
  metrics.push('# TYPE ziay_node_uptime_seconds gauge')
  metrics.push(`ziay_node_uptime_seconds ${process.uptime()}`)

  // SPRINT-PERFORMANCE-FINAL-001 — `public-short` (60s CDN, 5s SWR):
  // Prometheus scrapes every 15–30s; without a CDN cache, every scrape
  // hits the origin + runs 4 DB count queries. With s-maxage=60 the CDN
  // serves the cached scrape for up to 60s and SWRs in the background,
  // cutting origin load by ~75% on a 15s scrape interval. The 5s SWR
  // window keeps the data fresh enough for alerting (a 60s-stale gauge
  // is fine; alerts threshold on sustained values, not single samples).
  const response = new NextResponse(metrics.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4',
    },
  })
  return setCacheHeaders(response, 'public-short')

})
