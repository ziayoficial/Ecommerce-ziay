import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/capture-error'
import { requireRole } from '@/lib/auth-helpers'
import {
  runRetentionCleanup,
  RETENTION_POLICY_METADATA,
  type RetentionResult,
} from '@/lib/compliance/retention'
import { db } from '@/lib/db'

// ───────────────────────────────────────────────────────────────────────────
// /api/compliance/retention
//
// FIX-LEGAL-P0-001 L-2 — Ley 1581 Art 11 retention policy enforcement.
//
// GET  → returns the retention policy matrix + last run stats.
// POST → triggers a retention sweep immediately (admin-only). Idempotent.
//
// The retention sweep is also wired to run as a daily BullMQ recurring job
// (TODO in retention.ts). This endpoint provides a manual trigger for ops
// + debugging.
// ───────────────────────────────────────────────────────────────────────────

// GET /api/compliance/retention
// Public to admins (any role with `admin`). Returns the policy + stats.
export async function GET(_req: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    // Aggregate counts of each data type currently in the DB — surfaces how
    // much data is approaching its retention cutoff.
    const [
      customersTotal,
      conversationsTotal,
      messagesTotal,
      auditLogsTotal,
      consentsRevokedTotal,
      decisionLogsTotal,
    ] = await Promise.all([
      db.customer.count(),
      db.conversation.count(),
      db.message.count(),
      db.auditLog.count(),
      db.consentRecord.count({ where: { granted: false } }),
      db.decisionLog.count(),
    ])

    return NextResponse.json({
      policy: RETENTION_POLICY_METADATA,
      legalBasis: {
        customer_inactive:
          'Estatuto Tributario Art 632 — 5 años (retención fiscal)',
        conversation:
          'Ley 1581 de 2012 Art 11 — propósito cumplido (atención al cliente)',
        message:
          'Ley 1581 de 2012 Art 11 — propósito cumplido (atención al cliente)',
        audit_log:
          'Estatuto Tributario Art 632 — 7 años (retención fiscal/audit)',
        consent_revoked:
          'Ley 1581 de 2012 Art 11 — 5 años post-revocación (evidencia)',
        decision_log:
          'Ley 2573 de 2026 — 3 años (carga dinámica de la prueba)',
        webhook_event: 'Operacional — 90 días (debug)',
      },
      currentVolumes: {
        customers: customersTotal,
        conversations: conversationsTotal,
        messages: messagesTotal,
        auditLogs: auditLogsTotal,
        consentsRevoked: consentsRevokedTotal,
        decisionLogs: decisionLogsTotal,
      },
      lastRun: null, // TODO: persist last run to a Setting/audit row.
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/compliance/retention',
      method: 'GET',
    })
    return NextResponse.json(
      { error: 'No se pudo obtener la política de retención' },
      { status: 500 },
    )
  }
}

// POST /api/compliance/retention
// Triggers a retention sweep. Admin-only.
//
// TD-2: Zod schema accepts an optional body (the sweep takes no parameters,
// but the client may send an empty `{}`). `.passthrough()` keeps unknown
// keys so future optional filters don't 400 the caller.
const RetentionSweepSchema = z.object({}).passthrough()

export async function POST(req: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const raw = await req.json().catch(() => ({}))
    const parsed = RetentionSweepSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const result: RetentionResult = await runRetentionCleanup()

    // Best-effort: record the sweep in the audit log so admins can trace
    // manual triggers. Failure to write the audit row does NOT fail the
    // request — the retention work has already been done.
    try {
      await db.auditLog.create({
        data: {
          action: 'compliance.retention_sweep',
          entity: 'compliance',
          meta: JSON.stringify(result),
        },
      })
    } catch (auditErr) {
      captureError(auditErr as Error, {
        path: '/api/compliance/retention',
        method: 'POST',
        step: 'audit-log-write',
      })
    }

    return NextResponse.json({ ok: true, result }, { status: 200 })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/compliance/retention',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo ejecutar el barrido de retención' },
      { status: 500 },
    )
  }
}
