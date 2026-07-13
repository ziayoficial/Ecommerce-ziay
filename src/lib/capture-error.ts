// ZIAY — Centralised error capture.
//
// Every unhandled error in API routes / server components / server actions
// should funnel through `captureError`. It:
//   1. Logs the error locally via the structured pino logger (always —
//      useful even when Sentry is disabled).
//   2. Forwards to Sentry ONLY if a DSN is configured. This guard keeps dev
//      environments (where SENTRY_DSN is empty) from breaking on import.
//
// Use `captureMessage` for non-throwable events you still want to track
// (e.g. "tenant X exceeded free-tier quota").
//
// Saramantha §13 — observability layer.

import * as Sentry from '@sentry/nextjs'
import { logger } from './logger'

/**
 * Capture an unexpected error.
 *
 * @param error   The thrown value (Error instance preferred).
 * @param context Optional extra metadata attached to the Sentry event.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  const err = error instanceof Error ? error : new Error(String(error))

  // Local structured log — always emitted.
  logger.error({ err, ...context }, 'Error captured')

  // Forward to Sentry only when a DSN is configured. The init guards in
  // sentry.{server,client,edge}.config.ts also no-op without a DSN, so this
  // call is a safe no-op in dev even if we don't check — but the check avoids
  // paying the cost of building the event payload.
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  if (dsn) {
    Sentry.captureException(err, { extra: context })
  }
}

/**
 * Capture a non-error message (info / warning / error level).
 *
 * The local pino log uses the matching level; Sentry only receives the event
 * when a DSN is configured.
 */
export function captureMessage(
  msg: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  if (dsn) {
    Sentry.captureMessage(msg, level)
  }
  if (level === 'error') {
    logger.error(msg)
  } else if (level === 'warning') {
    logger.warn(msg)
  } else {
    logger.info(msg)
  }
}
