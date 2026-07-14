// SPRINT-MONITORING-002 · M-11 — public status page.
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
  const { checks, overall, timestamp } = await getSystemStatus()
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

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-muted-foreground">
          <p>Para soporte: soporte@ziay.co</p>
          <p className="mt-1">Actualizado cada 30 segundos</p>
        </div>
      </div>
    </main>
  )
}
