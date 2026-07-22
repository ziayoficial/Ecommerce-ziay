// ZIAY — Alert service for operational events.
//
// GAP-FIX #1: circuit breaker + Governor failures were silent — nobody
// knew a circuit opened at 3am without manually checking the dashboard.
//
// This service provides a unified `sendAlert()` that fans out to:
//   1. Structured pino log (always — captured by Loki/Promtail in prod)
//   2. Sentry captureMessage (when SENTRY_DSN is configured)
//   3. Socket.io real-time event to tenant admins (dashboard notification)
//   4. Slack/Discord webhook (when ALERT_WEBHOOK_URL is configured)
//
// The Slack/Discord webhook is optional — if ALERT_WEBHOOK_URL is not set,
// alerts go to logs + Sentry + dashboard only. This avoids requiring a
// new dependency while enabling teams to wire Slack/Discord via env var.

import { getLogger } from '@/lib/logger'
import { captureMessage } from '@/lib/capture-error'

const log = getLogger('alerts')

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AlertInput {
  /** Which tenant is affected (or 'platform' for system-wide alerts) */
  tenantId: string
  /** Short title for the alert */
  title: string
  /** Detailed description of what happened */
  message: string
  /** Severity level — critical triggers immediate notification */
  severity: AlertSeverity
  /** Additional structured data for debugging */
  metadata?: Record<string, unknown>
  /** Which component triggered the alert */
  source: 'circuit-breaker' | 'governor' | 'pipeline' | 'budget' | 'manual'
}

export interface AlertResult {
  sent: boolean
  channels: string[]
  error?: string
}

/**
 * Send an operational alert through all configured channels.
 *
 * Channels (in order of reliability):
 * 1. pino structured log — always fires (captured by Loki in prod)
 * 2. Sentry captureMessage — fires when SENTRY_DSN is set
 * 3. Socket.io emit — fires when the chat-emit module is loaded
 * 4. Slack/Discord webhook — fires when ALERT_WEBHOOK_URL is set
 *
 * All channels are best-effort and non-blocking — if one fails, the others
 * still fire. The function never throws (it returns AlertResult instead).
 */
export async function sendAlert(input: AlertInput): Promise<AlertResult> {
  const channels: string[] = []
  const errors: string[] = []

  // 1. Structured log — always
  try {
    const logFn = input.severity === 'critical' ? log.error.bind(log) : log.warn.bind(log)
    logFn(
      {
        tenantId: input.tenantId,
        title: input.title,
        severity: input.severity,
        source: input.source,
        ...input.metadata,
      },
      `[ALERT] ${input.title}: ${input.message}`,
    )
    channels.push('log')
  } catch {
    // Logging should never fail, but if it does, don't block other channels
  }

  // 2. Sentry captureMessage — when configured
  try {
    const level = input.severity === 'critical' ? 'error' : 'warning'
    captureMessage(
      `[${input.source}] ${input.title}: ${input.message} (tenant=${input.tenantId})`,
      level,
    )
    channels.push('sentry')
  } catch {
    // Sentry may not be configured — skip silently
  }

  // 3. Socket.io real-time event to tenant admins
  try {
    const { emitToTenant } = await import('@/lib/chat-emit')
    emitToTenant(input.tenantId, 'alert:operational', {
      title: input.title,
      message: input.message,
      severity: input.severity,
      source: input.source,
      timestamp: new Date().toISOString(),
      ...input.metadata,
    })
    channels.push('socket')
  } catch {
    // Socket may not be initialized — skip silently
  }

  // 4. Slack/Discord webhook — when ALERT_WEBHOOK_URL is set
  const webhookUrl = process.env.ALERT_WEBHOOK_URL
  if (webhookUrl) {
    try {
      const payload = formatSlackPayload(input)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      channels.push('webhook')
    } catch (err) {
      errors.push(`webhook: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  return {
    sent: channels.length > 0,
    channels,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  }
}

/**
 * Format an alert as a Slack/Discord webhook payload.
 * Uses Slack's incoming webhook format (also compatible with Discord).
 */
function formatSlackPayload(input: AlertInput): Record<string, unknown> {
  const emoji = input.severity === 'critical' ? '🚨' : input.severity === 'warning' ? '⚠️' : 'ℹ️'
  const color = input.severity === 'critical' ? '#ff0000' : input.severity === 'warning' ? '#ffaa00' : '#36a64f'

  return {
    text: `${emoji} ${input.title}`,
    attachments: [
      {
        color,
        fields: [
          { title: 'Severidad', value: input.severity, short: true },
          { title: 'Fuente', value: input.source, short: true },
          { title: 'Tenant', value: input.tenantId, short: true },
          { title: 'Mensaje', value: input.message, short: false },
        ],
        footer: 'ZIAY Alerts',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  }
}

/**
 * Track Governor SLA violations and alert when threshold is exceeded.
 * Uses a simple in-memory counter — resets every 5 minutes.
 */
const governorSlaViolations: Array<{ timestamp: number; tenantId: string }> = []
const GOVERNOR_SLA_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const GOVERNOR_SLA_THRESHOLD = 3 // 3 violations in 5 min = alert

export async function recordGovernorSlaViolation(tenantId: string, latencyMs: number): Promise<void> {
  const now = Date.now()
  governorSlaViolations.push({ timestamp: now, tenantId })

  // Prune old entries (older than 5 min)
  while (governorSlaViolations.length > 0 && governorSlaViolations[0].timestamp < now - GOVERNOR_SLA_WINDOW_MS) {
    governorSlaViolations.shift()
  }

  // Count violations for this tenant in the window
  const recentCount = governorSlaViolations.filter(v => v.tenantId === tenantId).length

  if (recentCount >= GOVERNOR_SLA_THRESHOLD) {
    // Alert and reset counter to avoid alerting on every subsequent violation
    governorSlaViolations.splice(0, governorSlaViolations.length, ...governorSlaViolations.filter(v => v.tenantId !== tenantId))

    await sendAlert({
      tenantId,
      title: 'Governor SLA excedido',
      message: `El Governor ha excedido su SLA de 300ms ${recentCount} veces en los últimos 5 minutos. Latencia última: ${latencyMs}ms. El Governor sigue operando (fail-open) pero esto puede indicar saturación del LLM.`,
      severity: 'warning',
      source: 'governor',
      metadata: { latencyMs, violationCount: recentCount, window: '5min' },
    })
  }
}
