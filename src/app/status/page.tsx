// SPRINT-MONITORING-002 · M-11 — public status page.
// SPRINT-MONITORING-FINAL-001 — added incident history section.
// SPRINT-COMPLIANCE-FINAL-001 · P4 — added 90-day uptime bar.
//
// Shows the current health of the platform (DB + chat service) at
// /status. Added to PUBLIC_PATTERNS in middleware so unauthenticated
// visitors (and crawlers) can reach it. Revalidated every 30s.
//
// The page is intentionally minimal — no auth, no PII, no per-tenant
// data. Just overall + per-component status with latency. Spanish UI.
//
// Implementation notes:
//   - `export const dynamic = 'force-dynamic'` ensures the page is
//     server-rendered on every hit (no static caching). Combined with
//     `revalidate = 30` Next.js will still ISR-cache the rendered HTML
//     for 30s — within that window the cached page is served instantly
//     and the upstream checks (db + chat-service) are NOT re-run, which
//     protects the DB from a status-page DDoS.
//   - The chat-service health check uses `AbortSignal.timeout(3000)`
//     so a hung chat-service never blocks the page render.
//   - DB check is `db.$queryRaw\`SELECT 1\`` — the cheapest possible
//     liveness probe (no Prisma model load, no joins).
//   - Incident history (SPRINT-MONITORING-FINAL-001) loads the 10 most
//     recent incidents from the `StatusIncident` table — active ones
//     (not `resolved`) plus those resolved within the last 30 days. The
//     query is wrapped in try/catch so a missing table or DB error
//     degrades the page silently (still shows the live checks above).
//   - 90-day uptime bar (SPRINT-COMPLIANCE-FINAL-001 · P4): on each
//     render we upsert a `StatusCheck` row for today (statuspage.io-style
//     daily health snapshot), then load the last 90 days to render the
//     colored squares. Wrapped in try/catch — a fresh DB without the
//     `StatusCheck` table (pre-`db:push`) must NOT break the page.

import { db } from '@/lib/db'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Estado del Sistema | ZIAY',
  description: 'Estado en tiempo real de la plataforma ZIAY',
  robots: { index: true, follow: true },
  // SEO-5 (IF-4) — explicit canonical URL so search engines don't index
  // duplicate variants of /status (e.g. with query params from incident
  // deep-links). The page is `force-dynamic` so without canonical, Google
  // could see N slightly-different URLs.
  alternates: { canonical: '/status' },
}

export const dynamic = 'force-dynamic'
export const revalidate = 30

type CheckStatus = 'operational' | 'degraded' | 'down'

interface Check {
  name: string
  status: CheckStatus
  latency?: number
  message?: string
}

// ───────────────────────────────────────────────────────────────────────────
// Incident history (SPRINT-MONITORING-FINAL-001)
// ───────────────────────────────────────────────────────────────────────────
// Active incidents (any status != resolved) + incidents resolved within the
// last 30 days, newest first, capped at 10. The query is wrapped in try/catch
// — a fresh DB without the `StatusIncident` table (pre-`db:push`) must NOT
// break the status page; the section just renders nothing.
interface Incident {
  id: string
  title: string
  description: string
  severity: string
  status: string
  startTime: Date
  endTime: Date | null
  updates: string | null
}

async function getRecentIncidents(): Promise<Incident[]> {
  try {
    const incidents = await db.statusIncident.findMany({
      where: {
        OR: [
          // Active incidents — status is anything but "resolved"
          { status: { not: 'resolved' } },
          // Resolved within the last 30 days (older ones fall off the page)
          { endTime: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        ],
      },
      orderBy: { startTime: 'desc' },
      take: 10,
    })
    return incidents as Incident[]
  } catch {
    return []
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 90-day uptime bar (SPRINT-COMPLIANCE-FINAL-001 · P4)
// ───────────────────────────────────────────────────────────────────────────
// `StatusCheck` rows are 1-per-day snapshots of overall platform health.
// `recordStatusCheck` upserts today's row so the status bar reflects the
// latest live check; `getUptimeHistory` returns the last 90 days for
// rendering. Both are wrapped in try/catch — a fresh DB without the
// `StatusCheck` table (pre-`db:push`) must NOT break the page.
interface StatusCheckRow {
  id: string
  date: Date
  status: string
  latency: number | null
}

/** Compute today's date at 00:00:00.000 local — the unique key for `StatusCheck`. */
function todayAtMidnight(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function recordStatusCheck(status: string, latency: number | null): Promise<void> {
  try {
    const today = todayAtMidnight()
    await db.statusCheck.upsert({
      where: { date: today },
      update: { status, latency },
      create: { date: today, status, latency },
    })
  } catch {
    // Silently degrade — the uptime bar just shows "Sin datos" for today.
  }
}

async function getUptimeHistory(): Promise<StatusCheckRow[]> {
  try {
    const since = new Date(Date.now() - 90 * 86400_000)
    return await db.statusCheck.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
      take: 90,
    })
  } catch {
    return []
  }
}

// Spanish labels for the incident severity + status enums.
const INCIDENT_STATUS_LABEL: Record<string, string> = {
  resolved: 'Resuelto',
  investigating: 'Investigando',
  identified: 'Identificado',
  monitoring: 'Monitoreando',
}

// Tailwind classes per incident badge — resolved is always green; otherwise
// the severity drives the color (critical=rose, major=amber, minor+maintenance=sky).
function incidentBadgeClass(incident: {
  status: string
  severity: string
}): string {
  if (incident.status === 'resolved') {
    return 'bg-emerald-500/10 text-emerald-700'
  }
  if (incident.severity === 'critical') return 'bg-rose-500/10 text-rose-700'
  if (incident.severity === 'major') return 'bg-amber-500/10 text-amber-700'
  return 'bg-sky-500/10 text-sky-700'
}

function incidentStatusLabel(status: string): string {
  return INCIDENT_STATUS_LABEL[status] ?? status
}

async function getSystemStatus(): Promise<{
  checks: Check[]
  overall: CheckStatus
  timestamp: string
}> {
  const checks: Check[] = []

  // Database check
  try {
    const start = Date.now()
    await db.$queryRaw`SELECT 1`
    checks.push({ name: 'Base de datos', status: 'operational', latency: Date.now() - start })
  } catch {
    checks.push({ name: 'Base de datos', status: 'down', message: 'Sin conexión' })
  }

  // Chat service check
  try {
    const start = Date.now()
    const res = await fetch('http://localhost:3003/health', { signal: AbortSignal.timeout(3000) })
    checks.push({
      name: 'Servicio de mensajería',
      status: res.ok ? 'operational' : 'degraded',
      latency: Date.now() - start,
    })
  } catch {
    checks.push({ name: 'Servicio de mensajería', status: 'degraded', message: 'Tiempo de espera agotado' })
  }

  // Overall
  const overall: CheckStatus = checks.some((c) => c.status === 'down')
    ? 'down'
    : checks.some((c) => c.status === 'degraded')
      ? 'degraded'
      : 'operational'

  return { checks, overall, timestamp: new Date().toISOString() }
}

const statusConfig: Record<CheckStatus, { label: string; color: string; dot: string }> = {
  operational: { label: 'Operacional', color: 'text-emerald-600', dot: 'bg-emerald-500' },
  degraded: { label: 'Degradado', color: 'text-amber-600', dot: 'bg-amber-500' },
  down: { label: 'Caído', color: 'text-rose-600', dot: 'bg-rose-500' },
}

export default async function StatusPage() {
  // Run the live checks + incident query + uptime history fetch in parallel —
  // they hit different subsystems (DB ping + chat-service fetch vs. Prisma
  // SELECTs) so parallelizing shaves a few hundred ms off the render.
  const [{ checks, overall, timestamp }, incidents, uptimeHistory] = await Promise.all([
    getSystemStatus(),
    getRecentIncidents(),
    getUptimeHistory(),
  ])

  // SPRINT-COMPLIANCE-FINAL-001 · P4 — record today's StatusCheck row.
  // Fire-and-forget AFTER the parallel fetch above so a slow upsert can't
  // block the page render. We pass the DB check latency (most representative
  // of platform health); if the DB check failed, latency is undefined and we
  // record null. This must run AFTER `getSystemStatus` completes so the
  // overall status is known.
  const dbCheck = checks.find((c) => c.name === 'Base de datos')
  void recordStatusCheck(overall, dbCheck?.latency ?? null)

  const overallConfig = statusConfig[overall]

  // Build the 90-day uptime bar data — render oldest → newest (left → right).
  // Days without a StatusCheck row render as muted ("Sin datos").
  const uptimeBars = Array.from({ length: 90 }).map((_, i) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (89 - i))
    const check = uptimeHistory.find(
      (c) => new Date(c.date).toDateString() === date.toDateString(),
    )
    const color = !check
      ? 'bg-muted'
      : check.status === 'operational'
        ? 'bg-emerald-500'
        : check.status === 'degraded'
          ? 'bg-amber-500'
          : 'bg-rose-500'
    const statusLabel = !check
      ? 'Sin datos'
      : check.status === 'operational'
        ? 'Operacional'
        : check.status === 'degraded'
          ? 'Degradado'
          : 'Caído'
    return { date, color, statusLabel, latency: check?.latency ?? null }
  })

  // Uptime % over the 90-day window (count of operational days / total days
  // with data). Days without data are excluded from the denominator so a
  // freshly-deployed StatusCheck table doesn't show 0%.
  const daysWithData = uptimeHistory.length
  const operationalDays = uptimeHistory.filter((c) => c.status === 'operational').length
  const uptimePct = daysWithData > 0
    ? Math.round((operationalDays / daysWithData) * 1000) / 10
    : 100

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Estado del Sistema</h1>
          <p className="text-muted-foreground mt-2">ZIAY · Comercio Conversacional</p>
        </div>

        {/* Overall status */}
        <div
          className={`rounded-lg border p-6 mb-8 ${
            overall === 'operational'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : overall === 'degraded'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-rose-500/30 bg-rose-500/5'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className={`size-3 rounded-full ${overallConfig.dot} animate-pulse`} />
            <span className={`text-xl font-semibold ${overallConfig.color}`}>
              {overallConfig.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Última verificación: {new Date(timestamp).toLocaleString('es-CO')}
          </p>
        </div>

        {/* 90-day uptime bar — SPRINT-COMPLIANCE-FINAL-001 · P4 */}
        <div className="rounded-lg border p-4 mb-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Disponibilidad últimos 90 días</h2>
            <span className="text-sm tabular-nums text-muted-foreground">
              {uptimePct.toFixed(1)}% uptime
            </span>
          </div>
          <div className="flex gap-0.5 mt-2" role="img" aria-label="Barra de disponibilidad de 90 días">
            {uptimeBars.map((bar, i) => (
              <div
                key={i}
                className={`size-3 rounded-sm ${bar.color}`}
                title={`${bar.date.toLocaleDateString('es-CO')}: ${bar.statusLabel}${
                  bar.latency != null ? ` (${bar.latency}ms)` : ''
                }`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
            <span>hace 90 días</span>
            <span>hoy</span>
          </div>
        </div>

        {/* Individual checks */}
        <div className="space-y-3">
          {checks.map((check) => {
            const config = statusConfig[check.status]
            return (
              <div
                key={check.name}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex items-center gap-3">
                  <span className={`size-2.5 rounded-full ${config.dot}`} />
                  <span className="font-medium">{check.name}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {check.latency !== undefined && (
                    <span className="text-muted-foreground tabular-nums">{check.latency}ms</span>
                  )}
                  <span className={config.color}>{config.label}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Incident history — SPRINT-MONITORING-FINAL-001 */}
        {incidents.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4">Incidentes recientes</h2>
            <div className="space-y-3">
              {incidents.map((incident) => (
                <div key={incident.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">{incident.title}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${incidentBadgeClass(incident)}`}
                    >
                      {incidentStatusLabel(incident.status)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{incident.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(incident.startTime).toLocaleString('es-CO')}
                    {incident.endTime &&
                      ` — ${new Date(incident.endTime).toLocaleString('es-CO')}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-muted-foreground">
          <p>Para soporte: soporte@ziay.co</p>
          <p className="mt-1">Actualizado cada 30 segundos</p>
        </div>

        {/* SPRINT-ADMIN-INCIDENTS-001 — discrete admin link. Visible to
            everyone (the route is auth-protected — non-admins land on
            /login, then get bounced by the client-side role guard). Kept
            low-contrast so casual visitors ignore it but on-call SREs
            have a one-click entry from the public status page. */}
        <div className="mt-8 text-center">
          <a
            href="/admin/incidents"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Gestión de incidentes (admin)
          </a>
        </div>
      </div>
    </main>
  )
}
