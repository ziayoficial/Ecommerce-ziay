// Unit tests for src/lib/compliance/retention.ts
// TASK: SPRINT-TESTS-001
//
// Covers:
//   - RETENTION_PERIODS constants (Ley 1581 de 2012 Art 11 + Estatuto
//     Tributario Art 632 + Ley 2573 de 2026 — the legal retention matrix)
//   - RETENTION_POLICY_METADATA (the human-readable mirror exposed via
//     /api/compliance/retention GET)
//   - runRetentionCleanup (DB-backed sweep across 6 data types — verifies
//     each phase runs + counts are aggregated + failures are isolated so a
//     transient error on one model doesn't abort the rest)
//
// The retention matrix is a legal control — wrong values here are a Ley 1581
// violation (over-retention = data-subject complaint; under-retention = tax
// audit failure).

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock db ─────────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const mockDb = {
    customer: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      deleteMany: vi.fn(),
    },
    message: {
      deleteMany: vi.fn(),
    },
    auditLog: {
      deleteMany: vi.fn(),
    },
    consentRecord: {
      deleteMany: vi.fn(),
    },
    decisionLog: {
      deleteMany: vi.fn(),
    },
  }
  return { db: mockDb }
})

vi.mock('@/lib/db', () => ({ db }))

// Stub logger.
const { loggerMock } = vi.hoisted(() => {
  const m = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => m,
  }
  return { loggerMock: m }
})
vi.mock('@/lib/logger', () => ({
  getLogger: () => loggerMock,
  logger: loggerMock,
  default: loggerMock,
}))

import {
  RETENTION_POLICY_METADATA,
  runRetentionCleanup,
} from '@/lib/compliance/retention'

const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_MS = 365 * DAY_MS

// `RETENTION_PERIODS` is NOT exported from the source module (it's a private
// const consumed by `runRetentionCleanup` + the exported
// `RETENTION_POLICY_METADATA`). The tests below assert on the metadata array
// instead — it's the public surface that the `/api/compliance/retention` GET
// endpoint exposes to admins + the privacy page.
function retentionMs(dataType: string): number | null {
  const entry = RETENTION_POLICY_METADATA.find((e) => e.dataType === dataType)
  if (!entry) throw new Error(`Unknown retention dataType: ${dataType}`)
  return entry.retentionMs
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// RETENTION_PERIODS (asserted via RETENTION_POLICY_METADATA) — the legal matrix
// ─────────────────────────────────────────────────────────────────────────────
describe('RETENTION_PERIODS (via RETENTION_POLICY_METADATA)', () => {
  it('retains inactive customers for 5 years (Estatuto Tributario Art 632)', () => {
    expect(retentionMs('customer_inactive')).toBe(5 * YEAR_MS)
  })

  it('retains conversations for 2 years (Ley 1581 Art 11)', () => {
    expect(retentionMs('conversation')).toBe(2 * YEAR_MS)
  })

  it('retains messages for 2 years (cascade-deleted with conversations)', () => {
    expect(retentionMs('message')).toBe(2 * YEAR_MS)
  })

  it('retains audit logs for 7 years (Estatuto Tributario Art 632)', () => {
    expect(retentionMs('audit_log')).toBe(7 * YEAR_MS)
  })

  it('retains revoked consent records for 5 years (evidence retention)', () => {
    expect(retentionMs('consent_revoked')).toBe(5 * YEAR_MS)
  })

  it('retains AI decision logs for 3 years (Ley 2573 de 2026 — carga dinámica)', () => {
    expect(retentionMs('decision_log')).toBe(3 * YEAR_MS)
  })

  it('retains webhook events for 90 days (operational/debug)', () => {
    expect(retentionMs('webhook_event')).toBe(90 * DAY_MS)
  })

  it('does NOT auto-delete active customers (null retention)', () => {
    expect(retentionMs('customer_active')).toBeNull()
  })

  it('covers all 8 required data types', () => {
    // If a new data type is added to RETENTION_PERIODS without updating this
    // list, the test fails — forcing the test author to add a retention
    // assertion for the new type.
    const requiredKeys = [
      'customer_active',
      'customer_inactive',
      'conversation',
      'message',
      'audit_log',
      'consent_revoked',
      'decision_log',
      'webhook_event',
    ]
    const actualKeys = RETENTION_POLICY_METADATA.map((e) => e.dataType).sort()
    expect(actualKeys).toEqual(requiredKeys.sort())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RETENTION_POLICY_METADATA — human-readable mirror
// ─────────────────────────────────────────────────────────────────────────────
describe('RETENTION_POLICY_METADATA', () => {
  it('exposes one entry per data type', () => {
    expect(RETENTION_POLICY_METADATA).toHaveLength(8)
  })

  it('each entry has { dataType, retentionMs, retentionHuman }', () => {
    for (const entry of RETENTION_POLICY_METADATA) {
      expect(entry).toHaveProperty('dataType')
      expect(entry).toHaveProperty('retentionMs')
      expect(entry).toHaveProperty('retentionHuman')
      expect(typeof entry.retentionHuman).toBe('string')
    }
  })

  it('reports "5 years" for customer_inactive (year-aligned)', () => {
    const entry = RETENTION_POLICY_METADATA.find(
      (e) => e.dataType === 'customer_inactive',
    )
    expect(entry!.retentionHuman).toBe('5 years')
  })

  it('reports "no deletion (active)" for customer_active', () => {
    const entry = RETENTION_POLICY_METADATA.find(
      (e) => e.dataType === 'customer_active',
    )
    expect(entry!.retentionHuman).toBe('no deletion (active)')
  })

  it('reports "3 months" for webhook_event (90 days is day-aligned to 30-day months)', () => {
    // The `formatDuration` helper checks year-alignment first, then
    // month-alignment (30 days), then day-alignment. 90 % 30 == 0 → "3 months".
    const entry = RETENTION_POLICY_METADATA.find(
      (e) => e.dataType === 'webhook_event',
    )
    expect(entry!.retentionHuman).toBe('3 months')
    // And the raw ms value is exactly 90 days (the human label is just a display).
    expect(entry!.retentionMs).toBe(90 * DAY_MS)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runRetentionCleanup
// ─────────────────────────────────────────────────────────────────────────────
describe('runRetentionCleanup', () => {
  it('runs all 6 cleanup phases + returns aggregated counts', async () => {
    // 1. Inactive customers: 2 found, each anonymized.
    db.customer.findMany.mockResolvedValue([
      { id: 'cus-1', tenantId: 'ten-1' },
      { id: 'cus-2', tenantId: 'ten-1' },
    ])
    db.customer.update.mockResolvedValue({ id: 'cus-1' })
    // 2. Conversations: 5 deleted.
    db.conversation.deleteMany.mockResolvedValue({ count: 5 })
    // 3. Messages: 3 deleted.
    db.message.deleteMany.mockResolvedValue({ count: 3 })
    // 4. Audit logs: 1 deleted.
    db.auditLog.deleteMany.mockResolvedValue({ count: 1 })
    // 5. Consents: 0 deleted.
    db.consentRecord.deleteMany.mockResolvedValue({ count: 0 })
    // 6. Decision logs: 2 deleted.
    db.decisionLog.deleteMany.mockResolvedValue({ count: 2 })

    const result = await runRetentionCleanup()

    expect(result).toEqual(
      expect.objectContaining({
        customersAnonymized: 2,
        conversationsDeleted: 5,
        messagesDeleted: 3,
        auditLogsArchived: 1,
        consentRecordsDeleted: 0,
        decisionLogsDeleted: 2,
      }),
    )

    // The customer anonymization was called for each inactive customer.
    expect(db.customer.update).toHaveBeenCalledTimes(2)
    expect(db.customer.update).toHaveBeenCalledWith({
      where: { id: 'cus-1' },
      data: expect.objectContaining({
        name: '[anonimizado]',
        email: null,
        phone: null,
        address: null,
      }),
    })

    // Each deleteMany was scoped to a cutoff Date.
    expect(db.conversation.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    })
    expect(db.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    })

    // Consents are filtered to REVOKED only (granted=false).
    expect(db.consentRecord.deleteMany).toHaveBeenCalledWith({
      where: {
        granted: false,
        revokedAt: { lt: expect.any(Date) },
      },
    })

    // The result includes timing metadata.
    expect(result.startedAt).toEqual(expect.any(String))
    expect(result.finishedAt).toEqual(expect.any(String))
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('returns 0 counts when no rows match the cleanup criteria', async () => {
    db.customer.findMany.mockResolvedValue([])
    db.conversation.deleteMany.mockResolvedValue({ count: 0 })
    db.message.deleteMany.mockResolvedValue({ count: 0 })
    db.auditLog.deleteMany.mockResolvedValue({ count: 0 })
    db.consentRecord.deleteMany.mockResolvedValue({ count: 0 })
    db.decisionLog.deleteMany.mockResolvedValue({ count: 0 })

    const result = await runRetentionCleanup()

    expect(result.customersAnonymized).toBe(0)
    expect(result.conversationsDeleted).toBe(0)
    expect(result.messagesDeleted).toBe(0)
    expect(result.auditLogsArchived).toBe(0)
    expect(result.consentRecordsDeleted).toBe(0)
    expect(result.decisionLogsDeleted).toBe(0)
  })

  it('isolates failures — a transient error on one phase does NOT abort the rest', async () => {
    // Customer anonymization fails, but everything else should still run.
    db.customer.findMany.mockRejectedValue(new Error('customer table locked'))
    db.conversation.deleteMany.mockResolvedValue({ count: 5 })
    db.message.deleteMany.mockResolvedValue({ count: 3 })
    db.auditLog.deleteMany.mockResolvedValue({ count: 1 })
    db.consentRecord.deleteMany.mockResolvedValue({ count: 0 })
    db.decisionLog.deleteMany.mockResolvedValue({ count: 2 })

    const result = await runRetentionCleanup()

    // The customer phase failed → 0 anonymized (not an abort).
    expect(result.customersAnonymized).toBe(0)
    // But the other 5 phases still ran + their counts are reflected.
    expect(result.conversationsDeleted).toBe(5)
    expect(result.messagesDeleted).toBe(3)
    expect(result.auditLogsArchived).toBe(1)
    expect(result.decisionLogsDeleted).toBe(2)

    // The error was logged (non-fatal — captured per-phase).
    expect(loggerMock.error).toHaveBeenCalled()
  })

  it('handles null count from deleteMany (defaults to 0)', async () => {
    db.customer.findMany.mockResolvedValue([])
    db.conversation.deleteMany.mockResolvedValue({ count: null })
    db.message.deleteMany.mockResolvedValue({ count: null })
    db.auditLog.deleteMany.mockResolvedValue({ count: null })
    db.consentRecord.deleteMany.mockResolvedValue({ count: null })
    db.decisionLog.deleteMany.mockResolvedValue({ count: null })

    const result = await runRetentionCleanup()

    expect(result.conversationsDeleted).toBe(0)
    expect(result.auditLogsArchived).toBe(0)
  })

  it('anonymization preserves id + tenantId (referential integrity on Orders/Shipments)', async () => {
    db.customer.findMany.mockResolvedValue([{ id: 'cus-x', tenantId: 'ten-x' }])
    db.customer.update.mockResolvedValue({ id: 'cus-x' })
    db.conversation.deleteMany.mockResolvedValue({ count: 0 })
    db.message.deleteMany.mockResolvedValue({ count: 0 })
    db.auditLog.deleteMany.mockResolvedValue({ count: 0 })
    db.consentRecord.deleteMany.mockResolvedValue({ count: 0 })
    db.decisionLog.deleteMany.mockResolvedValue({ count: 0 })

    await runRetentionCleanup()

    // The update call wipes PII fields but does NOT touch id / tenantId.
    const updateCall = db.customer.update.mock.calls[0][0]
    expect(updateCall.where).toEqual({ id: 'cus-x' })
    expect(updateCall.data).not.toHaveProperty('id')
    expect(updateCall.data).not.toHaveProperty('tenantId')
    // PII is wiped:
    expect(updateCall.data.name).toBe('[anonimizado]')
    expect(updateCall.data.email).toBeNull()
    expect(updateCall.data.phone).toBeNull()
    expect(updateCall.data.address).toBeNull()
    expect(updateCall.data.city).toBeNull()
  })
})
