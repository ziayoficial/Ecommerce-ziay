import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { adsService } from '@/lib/services'

// TD-2: Zod schema for ads PATCH.
const AdActionSchema = z.enum(['pause', 'kill', 'resume', 'scale'])
const AdPatchSchema = z.object({
  action: AdActionSchema,
  reason: z.string().optional(),
  userId: z.string().optional(),
}).passthrough()

// Kill / pause / resume an ad (simulates pushing action to ad platform)
//
// SPRINT8-SERVICES-REST-001 — migrated the ad.update + auditLog.create
// (2 db calls) to `adsService.updateAd`. The service stamps the audit
// log entry internally (best-effort — non-fatal on failure). Response
// shape unchanged.
//
// FIX-SECURITY-AUTH-001 (#15) — fetch the ad (with campaign → tenant),
// verify `campaign.tenantId === session.user.tenantId` before update.
// Any authed user used to be able to pause/kill/resume any ad of any
// tenant. Ad has no direct tenantId column — it's scoped via Campaign.
//
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapped with `withErrorHandling`. The
// 2nd `ctx` arg is forwarded so dynamic routes can destructure `params`.
export const PATCH = withErrorHandling(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { session, error: authErr } = await requireAuth()
    if (authErr) return authErr

    const { id } = await params

    // Fetch the ad including its campaign's tenantId for the tenant guard.
    const existing = await db.ad.findUnique({
      where: { id },
      select: { id: true, campaign: { select: { tenantId: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
    }
    const userTenantId = session?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== existing.campaign.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    const raw = await req.json()
    const parseResult = AdPatchSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const body = parseResult.data as {
      action: 'pause' | 'kill' | 'resume' | 'scale'
      reason?: string
      userId?: string
    }
    const action = body.action

    const statusMap: Record<string, string> = {
      pause: 'paused',
      kill: 'killed',
      resume: 'active',
      scale: 'active',
    }
    const reason = body.reason

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
  },
)
