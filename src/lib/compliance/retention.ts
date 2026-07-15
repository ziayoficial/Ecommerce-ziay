import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'

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
  // 632 retention). Pre-step: in production this should be exported to cold
  // storage (S3 Glacier / BigQuery) before deletion. For now we delete.
  try {
    const auditCutoff = new Date(now.getTime() - RETENTION_PERIODS.audit_log)
    const oldAudits = await db.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    })
    results.auditLogsArchived = oldAudits.count ?? 0
  } catch (err) {
    log.error({ err }, 'retention: failed to delete old audit logs')
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
