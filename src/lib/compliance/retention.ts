import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ───────────────────────────────────────────────────────────────────────────
// Data retention policy — Ley 1581 de 2012 Art 11.
//
// FIX-LEGAL-P0-001 L-2 — PII must be deleted when the purpose for which it
// was collected is fulfilled. AUDIT-LEGAL-COMPLIANCE-001 P0-2 flagged that
// the platform had ZERO retention enforcement (PII retained forever).
//
// Policy matrix (referenced by the public /privacy page §6):
//
//   Data type               Retention               Legal basis
//   ─────────────────────── ─────────────────────── ────────────────────────
//   Active customer         No deletion (active)    Contract
//   Inactive customer       5 years after last      Estatuto Tributario
//                           interaction             Art 632 (tax/audit)
//   Conversations + msgs    2 years                 Ley 1581 Art 11
//                                                   (purpose fulfilled)
//   Audit logs              7 years                 Estatuto Tributario
//                                                   Art 632
//   Consent records         5 years after           Ley 1581 Art 11
//   (revoked)               revocation              (evidence retention)
//   Decision logs (AI)      3 years                 Ley 2573 de 2026
//                                                   (carga dinámica de
//                                                   la prueba)
//   Webhook events          90 days                 Operational/debug
//
// After the retention period elapses, PII is ANONYMIZED (for Customer —
// referential integrity preserved for Orders/Shipments) or DELETED (for
// Conversations, Messages, AuditLogs, DecisionLogs, ConsentRecords).
//
// Invocation:
//   - Manual: POST /api/compliance/retention (admin-only)
//   - Scheduled: BullMQ daily recurring job (TODO: wire to src/lib/queue.ts
//     once the queue handlers are split out — see remarketing/route.ts TODO).
// ───────────────────────────────────────────────────────────────────────────

const log = getLogger('compliance/retention')

const DAY_MS = 24 * 60 * 60 * 1000

const RETENTION_PERIODS = {
  // Active customer data: keep while active (no automated deletion).
  customer_active: null as number | null,
  // Inactive customer: 5 years after last interaction (tax/legal obligation).
  customer_inactive: 5 * 365 * DAY_MS,
  // Conversations: 2 years.
  conversation: 2 * 365 * DAY_MS,
  // Messages: 2 years (cascade-deleted with conversations, but also deleted
  // orphaned messages that survived a manual conversation prune).
  message: 2 * 365 * DAY_MS,
  // Audit logs: 7 years (Estatuto Tributario Art 632).
  audit_log: 7 * 365 * DAY_MS,
  // Consent records: 5 years after revocation (evidence retention).
  consent_revoked: 5 * 365 * DAY_MS,
  // Decision logs (AI agent traces): 3 years (Ley 2573 — carga dinámica).
  decision_log: 3 * 365 * DAY_MS,
  // Webhook events: 90 days (operational/debug). (No `WebhookEvent` model
  // exists today — value retained here for documentation/future use.)
  webhook_event: 90 * DAY_MS,
} as const

export interface RetentionResult {
  customersAnonymized: number
  conversationsDeleted: number
  messagesDeleted: number
  auditLogsArchived: number
  consentRecordsDeleted: number
  decisionLogsDeleted: number
  startedAt: string
  finishedAt: string
  durationMs: number
}

export const RETENTION_POLICY_METADATA = Object.freeze(
  Object.entries(RETENTION_PERIODS).map(([key, value]) => ({
    dataType: key,
    retentionMs: value,
    retentionHuman: value === null
      ? 'no deletion (active)'
      : formatDuration(value),
  })),
)

function formatDuration(ms: number): string {
  if (ms % (365 * DAY_MS) === 0) return `${ms / (365 * DAY_MS)} years`
  if (ms % (30 * DAY_MS) === 0) return `${ms / (30 * DAY_MS)} months`
  if (ms % DAY_MS === 0) return `${ms / DAY_MS} days`
  return `${ms} ms`
}

// ───────────────────────────────────────────────────────────────────────────
// AUDIT-FINTECH R-14 — Cold-storage export before AuditLog deletion.
//
// AuditLog rows are deleted after 7 years (Estatuto Tributario Art 632). For
// dispute resolution that spans beyond 7 years (rare but possible — e.g.
// tax audits reopening old periods, or class-action lawsuits), the raw
// evidence must remain available.
//
// Strategy: BEFORE deleting old AuditLog rows, write them to a JSONL file in
// `./data/cold-storage/auditlog-export-{YYYY-MM-DD}.jsonl`. Each line is a
// full JSON object. A checksum (SHA-256) of the file is recorded so we can
// prove the export was tamper-evident. An `AuditLogExport` Prisma model
// tracks what was exported (date, recordCount, filePath, checksum).
//
// Production TODO: replace the local file write with an S3/Glacier upload
// (the JSONL format is identical — just change the destination). The
// `AuditLogExport` row makes the migration traceable.
// ───────────────────────────────────────────────────────────────────────────

const COLD_STORAGE_DIR = path.join(process.cwd(), 'data', 'cold-storage')

interface AuditLogExportRecord {
  id: string
  tenantId: string | null
  userId: string | null
  action: string
  entity: string
  entityId: string | null
  metadata: string | null
  proofHash: string | null
  proofSignature: string | null
  credentialSchema: string | null
  createdAt: string
  exportedAt: string
}

/**
 * Export a batch of AuditLog rows to a dated JSONL file in cold storage.
 *
 * @returns the export metadata (filePath, recordCount, checksum) or null
 *          if the export failed (in which case the caller MUST NOT delete
 *          the rows — fail-closed to preserve evidence).
 */
async function exportAuditLogsToColdStorage(
  rows: AuditLogExportRecord[],
): Promise<{ filePath: string; recordCount: number; checksum: string } | null> {
  if (rows.length === 0) {
    return { filePath: '', recordCount: 0, checksum: '' }
  }

  const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const stamp = Date.now()
  const fileName = `auditlog-export-${dateStr}-${stamp}.jsonl`
  const filePath = path.join(COLD_STORAGE_DIR, fileName)

  try {
    await fs.mkdir(COLD_STORAGE_DIR, { recursive: true })

    // Stream-safe JSONL build (one JSON object per line).
    const lines = rows.map((r) => JSON.stringify(r))
    const payload = lines.join('\n') + '\n'

    await fs.writeFile(filePath, payload, 'utf8')

    // SHA-256 checksum of the exported file (tamper-evidence).
    const checksum = crypto.createHash('sha256').update(payload, 'utf8').digest('hex')

    log.info(
      { filePath, recordCount: rows.length, checksum: checksum.slice(0, 12) + '…' },
      'retention: AuditLog cold-storage export written',
    )

    return { filePath, recordCount: rows.length, checksum }
  } catch (err) {
    log.error(
      { err, filePath, recordCount: rows.length },
      'retention: AuditLog cold-storage export FAILED — rows will NOT be deleted (fail-closed)',
    )
    return null
  }
}

/**
 * Record an AuditLog export in the DB for traceability.
 * Best-effort: if the AuditLogExport table doesn't exist yet (migration
 * pending), the export still succeeds — we just skip the metadata row.
 */
async function recordAuditLogExport(
  filePath: string,
  recordCount: number,
  checksum: string,
): Promise<void> {
  try {
    // AuditLogExport model is added in the same schema push. If it's not
    // yet in the generated client, this call throws and we catch + warn.
    await (db as unknown as { auditLogExport: { create: (d: unknown) => Promise<unknown> } }).auditLogExport.create({
      data: {
        filePath,
        recordCount,
        checksum,
        exportedAt: new Date(),
      },
    })
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), filePath },
      'retention: AuditLogExport row not recorded (model may not be migrated yet) — export file still valid',
    )
  }
}

/**
 * Run a single retention sweep across all data types.
 *
 * Idempotent: re-running on the same day is a no-op (the cleanup targets
 * rows strictly older than the cutoff, so each row is touched at most once).
 * Returns aggregated counts so the API endpoint can log + surface them to
 * the admin UI.
 *
 * Failure isolation: each phase is wrapped in its own try/catch so a
 * transient error on one model (e.g. lock contention on AuditLog) does NOT
 * abort the rest of the cleanup. The aggregated counts reflect only what
 * actually succeeded.
 */
export async function runRetentionCleanup(): Promise<RetentionResult> {
  const startedAt = new Date()
  const startMs = startedAt.getTime()
  const now = startedAt

  const results: Omit<RetentionResult, 'startedAt' | 'finishedAt' | 'durationMs'> = {
    customersAnonymized: 0,
    conversationsDeleted: 0,
    messagesDeleted: 0,
    auditLogsArchived: 0,
    consentRecordsDeleted: 0,
    decisionLogsDeleted: 0,
  }

  // 1. Anonymize inactive customers (no orders + not updated in 5 years).
  // We keep `id`, `tenantId`, `createdAt` for referential integrity on
  // Orders/Shipments. PII fields are wiped.
  try {
    const inactiveCutoff = new Date(
      now.getTime() - (RETENTION_PERIODS.customer_inactive as number),
    )
    const inactiveCustomers = await db.customer.findMany({
      where: {
        updatedAt: { lt: inactiveCutoff },
        orders: { none: {} },
      },
      select: { id: true, tenantId: true },
      take: 1000, // batch cap to avoid locking the table for too long
    })
    for (const customer of inactiveCustomers) {
      await db.customer.update({
        where: { id: customer.id },
        data: {
          name: '[anonimizado]',
          email: null,
          phone: null,
          address: null,
          city: null,
          psid: null,
          igId: null,
          perfilDetectado: null,
          notes: null,
          tags: null,
        },
      })
      results.customersAnonymized++
    }
  } catch (err) {
    log.error({ err }, 'retention: failed to anonymize inactive customers')
  }

  // 2. Delete old conversations (2 years).
  try {
    const conversationCutoff = new Date(
      now.getTime() - RETENTION_PERIODS.conversation,
    )
    const oldConversations = await db.conversation.deleteMany({
      where: { createdAt: { lt: conversationCutoff } },
    })
    results.conversationsDeleted = oldConversations.count ?? 0
  } catch (err) {
    log.error({ err }, 'retention: failed to delete old conversations')
  }

  // 3. Delete orphaned old messages (2 years). Messages should be cascade-
  // deleted with their parent Conversation, but if a manual conversation
  // prune left orphans, this catches them.
  try {
    const messageCutoff = new Date(now.getTime() - RETENTION_PERIODS.message)
    const oldMessages = await db.message.deleteMany({
      where: { createdAt: { lt: messageCutoff } },
    })
    results.messagesDeleted = oldMessages.count ?? 0
  } catch (err) {
    log.error({ err }, 'retention: failed to delete old messages')
  }

  // 4. Archive (delete) old audit logs (7 years — Estatuto Tributario Art
  // 632 retention). R-14 fix: BEFORE deleting, export the rows to cold
  // storage (JSONL file with SHA-256 checksum). If the export fails, we
  // SKIP the deletion for this run (fail-closed — preserve evidence over
  // cleanup). The exported rows are then deleted in batches.
  try {
    const auditCutoff = new Date(now.getTime() - RETENTION_PERIODS.audit_log)

    // Fetch the rows about to be deleted (cap at 5000 per sweep to avoid
    // memory blowup — subsequent sweeps will catch up).
    const oldAuditRows = await db.auditLog.findMany({
      where: { createdAt: { lt: auditCutoff } },
      take: 5000,
      orderBy: { createdAt: 'asc' },
    })

    if (oldAuditRows.length > 0) {
      const exportRows: AuditLogExportRecord[] = oldAuditRows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        userId: r.userId,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        metadata: r.metadata,
        proofHash: r.proofHash,
        proofSignature: r.proofSignature,
        credentialSchema: r.credentialSchema,
        createdAt: r.createdAt.toISOString(),
        exportedAt: new Date().toISOString(),
      }))

      const exportMeta = await exportAuditLogsToColdStorage(exportRows)

      if (exportMeta) {
        // Export succeeded — safe to delete the exported rows.
        const idsToDelete = oldAuditRows.map((r) => r.id)
        const deleteResult = await db.auditLog.deleteMany({
          where: { id: { in: idsToDelete } },
        })
        results.auditLogsArchived = deleteResult.count ?? 0

        // Record the export metadata for traceability.
        if (exportMeta.recordCount > 0) {
          await recordAuditLogExport(
            exportMeta.filePath,
            exportMeta.recordCount,
            exportMeta.checksum,
          )
        }
      } else {
        // Export failed — DO NOT delete. Logs already emitted by the helper.
        results.auditLogsArchived = 0
      }
    }
  } catch (err) {
    log.error({ err }, 'retention: failed to archive old audit logs (cold-storage safeguard)')
  }

  // 5. Delete revoked consent records older than 5 years.
  try {
    const consentCutoff = new Date(
      now.getTime() - RETENTION_PERIODS.consent_revoked,
    )
    const oldConsents = await db.consentRecord.deleteMany({
      where: {
        granted: false,
        revokedAt: { lt: consentCutoff },
      },
    })
    results.consentRecordsDeleted = oldConsents.count ?? 0
  } catch (err) {
    log.error({ err }, 'retention: failed to delete revoked consents')
  }

  // 6. Delete old decision logs (3 years — Ley 2573 de 2026).
  try {
    const decisionCutoff = new Date(
      now.getTime() - RETENTION_PERIODS.decision_log,
    )
    const oldDecisions = await db.decisionLog.deleteMany({
      where: { createdAt: { lt: decisionCutoff } },
    })
    results.decisionLogsDeleted = oldDecisions.count ?? 0
  } catch (err) {
    log.error({ err }, 'retention: failed to delete old decision logs')
  }

  const finishedAt = new Date()
  const result: RetentionResult = {
    ...results,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startMs,
  }
  log.info({ result }, 'retention cleanup completed')
  return result
}
