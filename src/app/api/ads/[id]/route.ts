import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { adsService } from '@/lib/services'

// Kill / pause / resume an ad (simulates pushing action to ad platform)
//
// SPRINT8-SERVICES-REST-001 — migrated the ad.update + auditLog.create
// (2 db calls) to `adsService.updateAd`. The service stamps the audit
// log entry internally (best-effort — non-fatal on failure). Response
// shape unchanged.
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

    const updated = await adsService.updateAd(id, {
      status: statusMap[action],
      autoKill: action === 'kill',
      killReason: action === 'kill' ? (reason || 'Manual kill by trafficker') : null,
      userId: body.userId || null,
      action,
      reason,
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
