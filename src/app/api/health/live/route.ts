import { NextResponse } from 'next/server'

// GET /api/health/live — liveness probe (Kubernetes / load balancer).
// Solo verifica que el proceso responda — no toca la DB. Si esto falla, el
// proceso debe ser reiniciado.
export async function GET() {
  return NextResponse.json(
    { status: 'alive', timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
