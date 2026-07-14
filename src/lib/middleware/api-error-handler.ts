// ZIAY — API error handler middleware.
//
// SPRINT-MONITORING-DR-001 · M-1 — Sentry alerting pipeline.
//
// Context (AUDIT-MONITORING-DR-001): `captureError()` was only called from 2
// files. 63 `log.error`/`log.warn` sites across 20 files emitted logs no one
// reads. This wrapper funnels every unhandled API route exception through
// Sentry + the structured pino logger so that no API failure is silent.
//
// Usage:
//   import { withErrorHandling } from '@/lib/middleware/api-error-handler'
//   export const POST = withErrorHandling(async (req) => { ... })
//
// Behaviour:
//   1. Runs the handler in a try/catch.
//   2. On throw:
//      a. `Sentry.captureException(error, { tags, extra })` — tagged with the
//         route + method so Sentry can route to the right alert rule.
//      b. `logger.error(...)` — structured pino log (always emitted, even
//         when Sentry DSN isn't configured).
//      c. Returns a consistent JSON 500 with `{ error, code: 'INTERNAL_ERROR' }`
//         so the client contract is stable regardless of which route threw.
//   3. Errors that are already `NextResponse` (e.g. a route handler that
//      constructed a 4xx NextResponse and then `throw` it) are returned
//      untouched — the route's intent is preserved.
//
// NOTE: this is an opt-in wrapper. Routes that already call `captureError`
// in their own try/catch (e.g. webhook handlers that need finer-grained
// context) can continue to do so. The wrapper is the safety net for the
// 63 `log.error` sites that currently don't reach Sentry at all.

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { logger } from '@/lib/logger'

/**
 * Wraps an API route handler with error capture + structured logging.
 * Usage: export const POST = withErrorHandling(async (req) => { ... })
 */
export function withErrorHandling<T extends NextRequest>(
  handler: (req: T) => Promise<NextResponse>,
): (req: T) => Promise<NextResponse> {
  return async (req: T) => {
    try {
      return await handler(req)
    } catch (error) {
      // If the handler threw a NextResponse (a common Next.js pattern for
      // early-exit 4xx), preserve it as-is. This is checked before Sentry
      // capture so we don't alert on intentional control-flow throws.
      if (error instanceof NextResponse) {
        return error
      }

      // Capture to Sentry. The init guards in sentry.{server,client,edge}.config.ts
      // no-op when no DSN is set, so this is a safe no-op in dev.
      Sentry.captureException(error, {
        tags: {
          route: req.nextUrl.pathname,
          method: req.method,
        },
        extra: {
          url: req.url,
          userAgent: req.headers.get('user-agent'),
        },
      })

      // Structured log — always emitted (pino doesn't depend on Sentry).
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          route: req.nextUrl.pathname,
          method: req.method,
        },
        'API handler error',
      )

      // Return consistent error shape so the client contract is stable.
      const message =
        error instanceof Error ? error.message : 'Error interno del servidor'
      return NextResponse.json(
        { error: message, code: 'INTERNAL_ERROR' },
        { status: 500 },
      )
    }
  }
}
