import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { logger } from '@/lib/logger'
import { ZodError } from 'zod'

/**
 * Unified API error handler — document §TD-1
 * Replaces the 70x repeated try/catch boilerplate across API routes.
 *
 * Usage (direct):
 *   try { ... } catch (error) {
 *     return handleApiError(error, { route: '/api/foo', method: 'POST' })
 *   }
 *
 * Usage (wrapper):
 *   export const POST = withErrorHandler(async (req) => { ... })
 *
 * Differences vs the older `src/lib/middleware/api-error-handler.ts`
 * (SPRINT-MONITORING-DR-001):
 *   - This helper understands `ApiError` (thrown by handlers for known
 *     business-rule failures with a custom status code) and `ZodError`
 *     (auto-serialized to `{ code: 'VALIDATION_ERROR', details: ... }`).
 *   - The old wrapper only handled `NextResponse` throws + generic 500s.
 *   - Both can coexist; routes opt-in to either.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function handleApiError(error: unknown, context?: { route?: string; method?: string }) {
  // Zod validation error — never reaches Sentry, expected client input mistake.
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Validación fallida',
        code: 'VALIDATION_ERROR',
        details: error.flatten(),
      },
      { status: 400 }
    )
  }

  // ApiError — thrown by handlers for known business-rule failures (404, 409, ...).
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code || 'API_ERROR', details: error.details },
      { status: error.statusCode }
    )
  }

  // Unknown error — capture + log, respond with 500.
  const message = error instanceof Error ? error.message : 'Error interno del servidor'

  // Capture to Sentry (no-op if Sentry isn't initialised at runtime).
  Sentry.captureException(error, {
    tags: {
      route: context?.route || 'unknown',
      method: context?.method || 'unknown',
    },
  })

  // Structured log — never logs sensitive fields (logger redacts password/secret/token/apiKey).
  logger.error(
    {
      err: message,
      stack: error instanceof Error ? error.stack : undefined,
      route: context?.route,
      method: context?.method,
    },
    'Unhandled API error'
  )

  return NextResponse.json(
    { error: message, code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}

/**
 * Wraps an async route handler with error handling.
 * Usage: export const POST = withErrorHandler(async (req) => { ... })
 *
 * Note: for handlers that need the 2nd `params` arg (dynamic routes), pass the
 * full signature through — this wrapper only requires the first arg be a Request.
 */
export function withErrorHandler<T extends Request>(
  handler: (req: T) => Promise<NextResponse>
): (req: T) => Promise<NextResponse> {
  return async (req: T) => {
    try {
      return await handler(req)
    } catch (error) {
      const url = new URL(req.url)
      return handleApiError(error, {
        route: url.pathname,
        method: req.method,
      })
    }
  }
}
