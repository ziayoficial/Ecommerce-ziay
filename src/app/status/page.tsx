// SPRINT-MONITORING-002 · M-11 — public status page.
// SPRINT-MONITORING-FINAL-001 — added incident history section.
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

import { db } from '@/lib/db'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Estado del Sistema | ZIAY',
  description: 'Estado en tiempo real de la plataforma ZIAY',
  robots: { index: true, follow: true },
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
  // Run the live checks + incident query in parallel — they hit different
  // subsystems (DB ping + chat-service fetch vs. a Prisma SELECT) so
  // parallelizing shaves a few hundred ms off the render.
  const [{ checks, overall, timestamp }, incidents] = await Promise.all([
    getSystemStatus(),
    getRecentIncidents(),
  ])
  const overallConfig = statusConfig[overall]

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
      </div>
    </main>
  )
}
