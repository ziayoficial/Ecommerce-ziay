import { NextRequest, NextResponse } from 'next/server'
import { statfs } from 'fs/promises'
import net from 'net'
import { db } from '@/lib/db'
import { withCache } from '@/lib/cache'
import { isRedisAvailable } from '@/lib/redis'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// GET /api/health — reports status of all integrations + runtime metrics.
// SPRINT5-FINAL-001 · Part 3 (enhanced with latency / runtime / disk / socket)
//
// Cached for 30 seconds — the endpoint is polled frequently by the UI and
// runs ~15 DB / env checks per call. A 30s TTL smooths out load without
// masking real outages for long. Cache key is scoped by tenantId so the
// tenant-specific checks (`tenant_llm`, `tenant_catalog_adapter`, …) don't
// leak across tenants.
//
// NOTE: the runtime/disk/memory block is computed AFTER the cache lookup —
// those values change every second, so caching them would be misleading.
// Only the integration checks are cached; the runtime section is always
// fresh.

type CheckStatus = 'ok' | 'warning' | 'error' | 'not_configured'

interface Check {
  name: string
  status: CheckStatus
  detail: string
  /** Optional latency in ms (for `database_latency`, `socket_service`). */
  latency_ms?: number
}

export const GET = withErrorHandling(async (req: NextRequest) => {

  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined

  // Integration checks are cached; runtime metrics are recomputed each call.
  const { status, summary, checks, timestamp } = await withCache(
    `health:status:${tenantId ?? 'all'}`,
    30_000,
    () => runHealthChecks(tenantId),
  )

  const runtime = await collectRuntime()

  // FIX-REALTIME-WEBHOOKS-001 · O3 — return 503 when the overall status is
  // `error` (e.g. DB down). Load balancers and uptime monitors key off the
  // HTTP status code; a 200 with `status: 'error'` in the body was masking
  // outages. `warning` (slow DB, low disk) still returns 200 — the app is
  // serving traffic, just degraded.
  const httpStatus = status === 'error' ? 503 : 200
  return NextResponse.json({ status, summary, checks, runtime, timestamp }, { status: httpStatus })

})

async function runHealthChecks(tenantId: string | undefined) {
  const checks: Check[] = []

  // ── Database + latency ────────────────────────────────────────────────
  // We measure SELECT 1 latency — anything > 250ms on a local SQLite/PG
  // is suspicious and gets downgraded to `warning`.
  try {
    const t0 = Date.now()
    await db.$queryRaw`SELECT 1`
    const latencyMs = Date.now() - t0
    checks.push({
      name: 'database',
      status: latencyMs > 250 ? 'warning' : 'ok',
      detail: latencyMs > 250 ? `Slow — ${latencyMs}ms` : 'Connected',
      latency_ms: latencyMs,
    })
    checks.push({
      name: 'database_latency',
      status: latencyMs > 1000 ? 'error' : latencyMs > 250 ? 'warning' : 'ok',
      detail: `${latencyMs}ms`,
      latency_ms: latencyMs,
    })
  } catch (e) {
    checks.push({ name: 'database', status: 'error', detail: e instanceof Error ? e.message : 'unknown' })
    checks.push({ name: 'database_latency', status: 'error', detail: 'query failed' })
  }

  try {
    const count = await db.tenant.count({ where: { activo: true } })
    checks.push({ name: 'tenants', status: count > 0 ? 'ok' : 'warning', detail: `${count} active tenants` })
  } catch { checks.push({ name: 'tenants', status: 'error', detail: 'cannot query' }) }

  // ── Redis (SPRINT4-INFRA-001) ─────────────────────────────────────────
  // Reports `ok` if REDIS_URL is set AND PING succeeds, `error` if REDIS_URL
  // is set but PING fails (e.g. Redis is down), `not_configured` if no
  // REDIS_URL — the app still works, just with in-memory cache only.
  const redisAvailable = await isRedisAvailable()
  if (process.env.REDIS_URL) {
    checks.push({
      name: 'redis',
      status: redisAvailable ? 'ok' : 'error',
      detail: redisAvailable ? 'Connected' : 'REDIS_URL set but ping failed',
    })
  } else {
    checks.push({ name: 'redis', status: 'not_configured', detail: 'Set REDIS_URL to enable shared cache' })
  }

  const llmProviders = [
    { id: 'zai', env: null, alwaysOn: true },
    { id: 'chatgpt', env: 'OPENAI_API_KEY' },
    { id: 'xai', env: 'XAI_API_KEY' },
    { id: 'ollama', env: 'OLLAMA_BASE_URL' },
  ]
  for (const p of llmProviders) {
    if (p.alwaysOn) checks.push({ name: `llm_${p.id}`, status: 'ok', detail: 'Default provider' })
    else if (p.env && process.env[p.env]) checks.push({ name: `llm_${p.id}`, status: 'ok', detail: `Configured via ${p.env}` })
    else checks.push({ name: `llm_${p.id}`, status: 'not_configured', detail: `Set ${p.env} to enable` })
  }

  if (tenantId) {
    try {
      const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
      if (tenant) {
        checks.push({ name: 'tenant_llm', status: 'ok', detail: `proveedorIa='${tenant.proveedorIa}'` })
        checks.push({ name: 'tenant_catalog_adapter', status: 'ok', detail: `plataformaCatalogo='${tenant.plataformaCatalogo}'` })
        checks.push({ name: 'tenant_logistics_adapter', status: 'ok', detail: `proveedorLogistico='${tenant.proveedorLogistico}'` })
      }
    } catch { }
  }

  const adapterCreds = [
    { id: 'woocommerce', env: 'WOOCOMMERCE_CONSUMER_KEY' },
    { id: 'shopify', env: 'SHOPIFY_ACCESS_TOKEN' },
    { id: 'supabase', env: 'SUPABASE_URL' },
    { id: 'oracle', env: 'ORACLE_CONNECTION_STRING' },
  ]
  for (const a of adapterCreds) {
    checks.push({ name: `adapter_${a.id}`, status: process.env[a.env] ? 'ok' : 'not_configured', detail: process.env[a.env] ? 'Configured' : `Set ${a.env}` })
  }

  const logisticsCreds = [
    { id: 'dropi', env: 'DROPI_API_KEY' },
    { id: '99envios', env: 'ENVIOS99_API_KEY' },
    { id: 'aveonline', env: 'AVEONLINE_API_KEY' },
  ]
  for (const l of logisticsCreds) {
    checks.push({ name: `logistics_${l.id}`, status: process.env[l.env] ? 'ok' : 'not_configured', detail: process.env[l.env] ? 'Configured' : `Set ${l.env}` })
  }

  checks.push({ name: 'webhook_whatsapp', status: process.env.WA_VERIFY_TOKEN ? 'ok' : 'warning', detail: process.env.WA_VERIFY_TOKEN ? 'Token configured' : 'WA_VERIFY_TOKEN not set' })
  checks.push({ name: 'webhook_meta', status: process.env.META_VERIFY_TOKEN ? 'ok' : 'warning', detail: process.env.META_VERIFY_TOKEN ? 'Token configured' : 'META_VERIFY_TOKEN not set' })
  checks.push({ name: 'webhook_nocodb', status: process.env.NOCODB_WEBHOOK_URL ? 'ok' : 'not_configured', detail: process.env.NOCODB_WEBHOOK_URL ? 'Configured' : 'NocoDB sync disabled' })

  // ── Chat-service (socket.io on CHAT_SERVICE_PORT, default 3003) ────────
  // Soft check — never fails the overall health, only marks `warning`.
  // In dev the chat-service is a separate `bun --hot` process; in prod it
  // runs in a separate container. Either way, the main app can still serve
  // dashboards without it.
  checks.push(await checkSocketService())

  // ── Disk space ────────────────────────────────────────────────────────
  // <10% free → error, <25% → warning, else ok. fs.statfs is Node 18.17+.
  checks.push(await checkDiskSpace())

  const summary = {
    ok: checks.filter(c => c.status === 'ok').length,
    warning: checks.filter(c => c.status === 'warning').length,
    error: checks.filter(c => c.status === 'error').length,
    not_configured: checks.filter(c => c.status === 'not_configured').length,
  }
  const overall: CheckStatus = summary.error > 0 ? 'error' : summary.warning > 0 ? 'warning' : 'ok'

  return { status: overall, summary, checks, timestamp: new Date().toISOString() }
}

/**
 * Try a TCP connect to the chat-service. 500ms timeout — anything slower
 * means the service is unhealthy even if it eventually picks up.
 */
async function checkSocketService(): Promise<Check> {
  const port = Number(process.env.CHAT_SERVICE_PORT) || 3003
  const host = '127.0.0.1'

  return new Promise<Check>((resolve) => {
    const t0 = Date.now()
    const socket = new net.Socket()
    socket.setTimeout(500)

    const ok = () => {
      const latencyMs = Date.now() - t0
      socket.destroy()
      resolve({
        name: 'socket_service',
        status: 'ok',
        detail: `Reachable on ${host}:${port}`,
        latency_ms: latencyMs,
      })
    }
    const fail = (detail: string, status: CheckStatus = 'warning') => {
      socket.destroy()
      resolve({ name: 'socket_service', status, detail })
    }

    socket.on('connect', ok)
    socket.on('timeout', () => fail(`Timeout on ${host}:${port}`))
    socket.on('error', (err: NodeJS.ErrnoException) => {
      // ECONNREFUSED is the normal "service not running" state in dev —
      // don't scream, just warn. Anything else is suspicious.
      if (err.code === 'ECONNREFUSED') {
        fail(`Not running on ${host}:${port} (ECONNREFUSED)`)
      } else {
        fail(`${err.code || 'error'}: ${err.message}`)
      }
    })
    socket.connect(port, host)
  })
}

/**
 * Check free disk space on the volume that holds the app root.
 * Uses fs.statfs (Node 18.17+). On platforms where statfs isn't available
 * the check degrades to `not_configured` rather than throwing.
 */
async function checkDiskSpace(): Promise<Check> {
  try {
    // Use process.cwd() — the SQLite DB lives under ./db, so we care about
    // the same filesystem the app writes to.
    const stats = await statfs(process.cwd())
    // stats.bsize * stats.bfree = total free bytes
    const totalBytes = stats.bsize * stats.blocks
    const freeBytes = stats.bsize * stats.bfree
    if (totalBytes === 0) {
      return { name: 'disk_space', status: 'not_configured', detail: 'statfs returned 0 blocks' }
    }
    const freePct = (freeBytes / totalBytes) * 100
    const freeGb = freeBytes / (1024 * 1024 * 1024)
    const status: CheckStatus = freePct < 10 ? 'error' : freePct < 25 ? 'warning' : 'ok'
    return {
      name: 'disk_space',
      status,
      detail: `${freePct.toFixed(1)}% free (${freeGb.toFixed(2)} GB)`,
    }
  } catch (e) {
    return {
      name: 'disk_space',
      status: 'not_configured',
      detail: e instanceof Error ? `statfs unavailable: ${e.message}` : 'statfs unavailable',
    }
  }
}

/**
 * Collect process-level runtime metrics. Never throws — every field has a
 * fallback so the health endpoint itself can never 500 from this block.
 */
async function collectRuntime() {
  const mem = process.memoryUsage()
  return {
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: {
      rss: Math.round(mem.rss / (1024 * 1024)),
      heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
      external: Math.round(mem.external / (1024 * 1024)),
      arrayBuffers: Math.round(mem.arrayBuffers / (1024 * 1024)),
    },
    node_version: process.version,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
  }
}
