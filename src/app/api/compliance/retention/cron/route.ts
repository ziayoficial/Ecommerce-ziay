import { NextRequest, NextResponse } from 'next/server'
import { runRetentionCleanup } from '@/lib/compliance/retention'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// ───────────────────────────────────────────────────────────────────────────
// /api/compliance/retention/cron
//
// SPRINT-ADOPT-ERRORHANDLER-001 — daily retention sweep triggered by an
// external cron (e.g. system cron, Vercel Cron, GitHub Actions) calling
// this endpoint at 02:00 America/Bogota.
//
// Why an HTTP endpoint instead of BullMQ's `repeat: { cron }`?
//   - The BullMQ surface in `src/lib/queue.ts` is intentionally minimal
//     (no `Queue.add(name, data, { repeat })` signature), and in dev
//     mode it falls back to inline execution — BullMQ recurring jobs
//     don't fire without a worker process running.
//   - An HTTP endpoint works in every deployment target (Vercel, Docker,
//     bare metal) and is trivially schedulable via the platform's native
//     cron mechanism (Vercel Cron, systemd timers, k8s CronJob).
//
// Auth: `Authorization: Bearer $CRON_SECRET`. The secret is shared
// between this route and the external cron caller — never exposed to the
// browser. If `CRON_SECRET` is unset, the route 500s with an explicit
// message so the misconfiguration surfaces in the cron job's logs
// instead of silently skipping the sweep.
//
// Idempotent: `runRetentionCleanup()` only touches rows strictly older
// than the cutoff — running it twice in the same day is a no-op the
// second time.
// ───────────────────────────────────────────────────────────────────────────

export const GET = withErrorHandling(async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    )
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = await runRetentionCleanup()
  return NextResponse.json({ success: true, results })
})
