import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'

// GET /api/buyer-behavior?tenantId=X
// Devuelve los BuyerBehavior del tenant + conteos por nivel de riesgo.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId is required' },
      { status: 400 },
    )
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const [rows, stats] = await Promise.all([
    db.buyerBehavior.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    }),
    db.buyerBehavior.groupBy({
      by: ['riskLevel'],
      where: { tenantId },
      _count: { _all: true },
    }),
  ])

  const counts: Record<string, number> = {
    normal: 0,
    caution: 0,
    high_risk: 0,
    blacklist: 0,
  }
  for (const s of stats) counts[s.riskLevel] = s._count._all

  return NextResponse.json({ behaviors: rows, stats: counts })
}

// POST /api/buyer-behavior
// Body: { tenantId, phone, riskLevel, patternDetails }
// Upserta el BuyerBehavior para (tenantId, phone). Si riskLevel='high_risk' o
// 'blacklist', crea además un BehaviorAlert para que el equipo revise.
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 60,
    windowMs: 60_000,
    namespace: 'api:buyer-behavior:post',
  })
  if (limited) return limited

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tenantId, phone, riskLevel, patternDetails } = body ?? {}
  if (!tenantId || !phone || !riskLevel) {
    return NextResponse.json(
      { error: 'tenantId, phone, riskLevel are required' },
      { status: 400 },
    )
  }

  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const validLevels = ['normal', 'caution', 'high_risk', 'blacklist']
  if (!validLevels.includes(riskLevel)) {
    return NextResponse.json(
      { error: `riskLevel must be one of: ${validLevels.join(', ')}` },
      { status: 400 },
    )
  }

  const behavior = await db.buyerBehavior.upsert({
    where: { tenantId_phone: { tenantId, phone: String(phone) } },
    create: {
      tenantId,
      phone: String(phone),
      riskLevel,
      patternDetails: patternDetails ?? null,
    },
    update: {
      riskLevel,
      patternDetails: patternDetails ?? null,
    },
  })

  // Si el cliente fue marcado como high_risk o blacklist, dispara una alerta.
  let alert: { id: string } | null = null
  if (riskLevel === 'high_risk' || riskLevel === 'blacklist') {
    alert = await db.behaviorAlert.create({
      data: {
        tenantId,
        buyerBehaviorId: behavior.id,
        alertType: riskLevel,
        message: patternDetails
          ? `Cliente ${phone} marcado como ${riskLevel}: ${patternDetails}`
          : `Cliente ${phone} marcado como ${riskLevel}`,
      },
      select: { id: true },
    })
  }

  return NextResponse.json({ behavior, alert })
}
