import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// GET /api/health/live — liveness probe (Kubernetes / load balancer).
// Solo verifica que el proceso responda — no toca la DB. Si esto falla, el
// proceso debe ser reiniciado.
/**
 * GET /api/health/live
 *
 * Liveness probe (Kubernetes / load balancer). No DB touch — process must be restarted if this fails.
 *
 * @security Public
 * @returns { status: 'alive', timestamp }
 */
export const GET = withErrorHandling(async () => {

  return NextResponse.json(
    { status: 'alive', timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  )

})
