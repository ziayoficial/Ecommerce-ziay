import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'

// Kill / pause / resume an ad (simulates pushing action to ad platform)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const { id } = await params
    const body = await req.json()
    const action = body.action as 'pause' | 'kill' | 'resume' | 'scale' | undefined
    if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

    const statusMap: Record<string, string> = {
      pause: 'paused',
      kill: 'killed',
      resume: 'active',
      scale: 'active',
    }
    const reason = body.reason as string | undefined

    const updated = await db.ad.update({
      where: { id },
      data: {
        status: statusMap[action],
        autoKill: action === 'kill',
        killReason: action === 'kill' ? (reason || 'Manual kill by trafficker') : null,
      },
    })

    await db.auditLog.create({
      data: {
        userId: body.userId || null,
        action: `ad.${action}`,
        entity: 'Ad',
        entityId: id,
        meta: JSON.stringify({ reason, status: updated.status }),
      },
    })

    // In production: call Meta/Google/TikTok API here to push the change.
    // e.g. POST https://graph.facebook.com/v19.0/{ad_id} { status: PAUSED }

    return NextResponse.json({ ad: updated, action })
  } catch (err) {
    captureError(err as Error, { path: '/api/ads/[id]', method: 'PATCH' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
