// ZIAY — Webhook error handler middleware.
//
// SPRINT-WEBHOOK-ERRORHANDLER-001 — closes the gap left by Sprint 5D, which
// migrated 80 routes to `withErrorHandling` but intentionally excluded the 8
// webhook routes (mercadopago, wompi, stripe, payu, whatsapp, meta, pse, pix).
//
// WHY NOT withErrorHandling?
//   `withErrorHandling` returns a 500 on any unhandled exception. That's the
//   correct behaviour for normal API routes, but it's WRONG for webhooks:
//     - Meta (WhatsApp + Messenger + Instagram) retries non-2xx responses for
//       up to 24 hours. A 500 from a transient DB error → 24h of duplicate
//       delivery + wasted gateway quota.
//     - Stripe retries non-2xx up to ~16 times over 3 days.
//     - MercadoPago, Wompi, PayU, PSE, PIX all follow the same convention.
//
//   The webhooks already had their own inner try/catch that returned
//   `status: 'processing_failed'` (200) on DB errors — but any unhandled
//   exception OUTSIDE those inner catches would still bubble up to Next.js's
//   default 500. This wrapper closes that hole: ANY unhandled exception
//   becomes a 200 with `{ received, status: 'error', message }`, plus a
//   Sentry capture + pino log so the failure is observable.
//
// DIFFERENCE from withErrorHandling:
//   - ALWAYS returns 200 (never 500) to stop gateway retries
//   - Returns `{ received: true, status: 'error', message }` on failure
//   - Still captures to Sentry + logs via pino for observability
//   - Adds `webhook: true` tag to Sentry events so they can be routed to a
//     webhook-specific alert rule (lower urgency than 500-bearing API errors)
//
// Usage:
//   import { withWebhookErrorHandling } from '@/lib/middleware/webhook-error-handler'
//   export const POST = withWebhookErrorHandling(async (req) => { ... })
//
// Behaviour:
//   1. Runs the handler in a try/catch.
//   2. On throw:
//      a. If the thrown value is a `NextResponse` (a Next.js control-flow
//         pattern), it's returned AS-IS — the handler's intent is preserved.
//         (This mirrors `withErrorHandling`'s behaviour. In practice no
//         webhook throws a NextResponse — they `return` them — but the
//         guard is here for parity + safety.)
//      b. `Sentry.captureException(error, { tags, extra })` — tagged with
//         `webhook: true` + the route + method so Sentry can route to a
//         webhook-specific alert rule (lower urgency than API 500s).
//      c. `logger.error(...)` — structured pino log (always emitted, even
//         when Sentry DSN isn't configured).
//      d. Returns a 200 with `{ received: true, status: 'error', message }`
//         so the gateway stops retrying but the failure is visible in the
//         response body for observability.

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { logger } from '@/lib/logger'

/**
 * Wraps a webhook route handler with error capture.
 *
 * Usage: export const POST = withWebhookErrorHandling(async (req) => { ... })
 *
 * The wrapper ALWAYS returns 200 on unhandled exceptions (never 500) so that
 * gateway retry policies (Meta: 24h, Stripe: 3 days, MP/Wompi/PayU/PSE/PIX:
 * similar) don't kick in on transient failures. The error is still captured
 * to Sentry + logged via pino so it's observable.
 */
export function withWebhookErrorHandling<T extends NextRequest>(
  handler: (req: T) => Promise<NextResponse>,
): (req: T) => Promise<NextResponse> {
  return async (req: T) => {
    try {
      return await handler(req)
    } catch (error) {
      // If the handler threw a NextResponse (a common Next.js pattern for
      // early-exit control flow), preserve it as-is. This mirrors
      // `withErrorHandling`'s behaviour. In practice webhooks `return`
      // NextResponses instead of throwing them, but the guard is here for
      // parity + safety.
      if (error instanceof NextResponse) {
        return error
      }

      // Capture to Sentry. The init guards in sentry.{server,client,edge}.config.ts
      // no-op when no DSN is set, so this is a safe no-op in dev. The
      // `webhook: true` tag lets Sentry route webhook errors to a separate
      // alert rule with lower urgency than API 500s (since the gateway
      // already de-dupes via retries).
      Sentry.captureException(error, {
        tags: {
          route: req.nextUrl.pathname,
          method: req.method,
          webhook: true,
        },
        extra: {
          url: req.url,
        },
      })

      // Structured log — always emitted (pino doesn't depend on Sentry).
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          route: req.nextUrl.pathname,
          method: req.method,
          webhook: true,
        },
        'Webhook handler error',
      )

      // ALWAYS return 200 to stop gateway retries. The body indicates the
      // error for observability — the gateway treats 2xx as "stop retrying",
      // so the body shape is for our logs / debugging, not for the gateway.
      return NextResponse.json(
        {
          received: true,
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Internal error',
        },
        { status: 200 },
      )
    }
  }
}
