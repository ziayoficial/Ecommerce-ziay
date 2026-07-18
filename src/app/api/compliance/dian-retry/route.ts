// POST /api/compliance/dian-retry
//
// AUDIT-FINTECH R-8 — DIAN submission retry job (manual trigger).
//
// Background: when Alegra is not configured at the moment an order is paid
// (or Alegra is briefly down), `submitToDian()` returns `accepted: false`
// and the Invoice row stays `dianStatus = 'pending_submission'` FOREVER.
// There was no retry mechanism — the invoice was effectively lost.
//
// This endpoint walks the `pending_submission` backlog and re-submits each
// invoice via `submitToDian()` (see `retryPendingDianInvoices()` in
// `src/lib/compliance/dian-invoicing.ts` for the full retry policy).
//
// TODO(I2-FOLLOWUP): wire this to a BullMQ cron that fires every 5–10 min
// so the retry runs unattended. Today it is manual-only because the project
// hasn't shipped BullMQ yet (see ADR-0014 for the queue backlog decision).
// BullMQ queue name: `dian-retry`, schedule: `*/10 * * * *`.
//
// Auth: `admin` only — DIAN submission is a regulated action + the retry
// batch hits the Alegra API (rate-limit budget). A non-admin operator can
// already trigger a single-invoice retry via
// `/api/compliance/dian-invoice/[invoiceId]/submit`.
//
// Body (optional):
//   { tenantId?: string } — scope the retry to a single tenant. When
//   omitted, ALL tenants' pending invoices are processed. Platform admins
//   (no tenantId on session) can pass any tenantId; tenant-bound admins
//   can only retry their own tenant (the role check above is supplemented
//   by `requireTenantAccess` when `tenantId` is provided).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, requireTenantAccess } from '@/lib/auth-helpers'
import { retryPendingDianInvoices } from '@/lib/compliance/dian-invoicing'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const RetrySchema = z.object({
  tenantId: z.string().min(1).optional(),
})

/**
 * POST /api/compliance/dian-retry
 *
 * Manually trigger the DIAN pending-submission retry batch. Processes up
 * to 50 invoices per call (oldest first), each older than 5 minutes.
 *
 * @security Requires authentication + admin role (+ tenant access when tenantId is provided)
 * @returns Batch summary { processed, submitted, failed, permanentlyFailed, skipped }
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  // ── Auth: admin only — regulated DIAN submission + Alegra rate-limit budget ──
  const { error: roleErr, session } = await requireRole(['admin'])
  if (roleErr) return roleErr

  // Body is optional — empty body is allowed (retry across all tenants for
  // platform admins). Parse defensively so a malformed JSON doesn't 500.
  let raw: unknown = {}
  try {
    const text = await req.text()
    if (text.trim()) raw = JSON.parse(text)
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }

  const parsed = RetrySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Resolve effective tenantId:
  //   - tenant-bound admin → ALWAYS their own tenant, regardless of body.
  //   - platform admin (no tenantId on session) → honour body.tenantId or
  //     process all tenants when omitted.
  const sessionTenantId = session?.user?.tenantId ?? null
  let effectiveTenantId: string | undefined
  if (sessionTenantId) {
    effectiveTenantId = sessionTenantId
  } else if (parsed.data.tenantId) {
    // Platform admin scoping to a specific tenant — verify access.
    const { error: tenantErr } = await requireTenantAccess(parsed.data.tenantId)
    if (tenantErr) return tenantErr
    effectiveTenantId = parsed.data.tenantId
  }

  const result = await retryPendingDianInvoices(effectiveTenantId)

  return NextResponse.json({
    ok: true,
    ...result,
    scope: effectiveTenantId ?? 'all_tenants',
  })
})
