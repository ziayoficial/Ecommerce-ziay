import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// GET /api/health/uptime — lightweight for Uptime Kuma
/**
 * GET /api/health/uptime
 *
 * Uptime + process metrics (uptime_seconds, memory, pid).
 *
 * @security Public
 * @returns Uptime + runtime metrics
 */
export const GET = withErrorHandling(async () => {

  const start = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'connected', latencyMs: Date.now() - start }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  } catch (_e) {
    return NextResponse.json({ status: 'error', db: 'disconnected' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

})
