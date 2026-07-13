import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isRedisAvailable } from '@/lib/redis'

// GET /api/health/ready — readiness probe (Kubernetes / load balancer).
// Verifica que la DB responda a un SELECT 1. Si REDIS_URL está configurada,
// también hace PING a Redis. Si cualquiera falla, devuelve 503.
//
// Nota: Redis es opcional — si no está configurado, no afecta la readiness.
// Solo falla si REDIS_URL está seteada pero el ping falla (Redis caído).
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }

  // 1. Database must be reachable.
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    return NextResponse.json(
      { status: 'not ready', reason: 'database' },
      { status: 503, headers },
    )
  }

  // 2. Redis — only required if REDIS_URL is set. If it's set and ping
  //    fails, we're not ready (the orchestrator should wait for Redis).
  if (process.env.REDIS_URL) {
    const redisOk = await isRedisAvailable()
    if (!redisOk) {
      return NextResponse.json(
        { status: 'not ready', reason: 'redis' },
        { status: 503, headers },
      )
    }
  }

  return NextResponse.json({ status: 'ready' }, { headers })
}
