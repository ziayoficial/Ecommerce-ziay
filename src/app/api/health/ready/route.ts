import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/health/ready — readiness probe (Kubernetes / load balancer).
// Verifica que la DB responda a un SELECT 1. Si falla, devuelve 503.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json(
      { status: 'ready' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json(
      { status: 'not ready' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
