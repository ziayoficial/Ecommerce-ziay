// LLM budget unit tests.
// SPRINT-TESTS-FINAL-001 · §3.
//
// Tests `src/lib/llm/budget.ts::checkBudgetBeforeCall` — the per-tenant
// daily + monthly LLM cost gatekeeper. Every LLM call site (`/api/agents`,
// `/api/orchestrate`, `/api/ai-reply`) calls this function before invoking
// the provider; if `allowed === false`, the caller returns 429.
//
// Covers:
//   - allows when under both daily + monthly budget
//   - blocks when daily budget exceeded (returns daily message)
//   - blocks when monthly budget exceeded (returns monthly message)
//   - emits 80% warning via `emitToTenant` (dashboard banner)
//   - fails open on DB error (returns `allowed: true`)
//   - returns the more restrictive `remaining` (min of daily/monthly)
//   - respects tenant Setting overrides (vs. defaults: $10/day, $200/mo)
//
// Mock strategy:
//   - `vi.mock('@/lib/db')` — provides `db.decisionLog.aggregate` (spent
//     lookup) + `db.setting.findFirst` (budget override lookup).
//   - `vi.mock('@/lib/chat-emit')` — captures `emitToTenant` calls so we
//     can assert the 80% warning payload.
//   - `vi.mock('@/lib/logger')` — silences pino output.
//   - `invalidateBudgetCache(tenantId)` in `beforeEach` — the budget
//     module caches the {budget, spent, fetchedAt} tuple for 5 min (daily)
//     / 15 min (monthly) to avoid hitting the DB on every LLM call.
//     Without invalidation, the second test in this file would see the
//     stale cached value from the first test (mocked DB never gets called
//     again), and the assertion would fail.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock DB ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => {
  const mockDb = {
    decisionLog: {
      aggregate: vi.fn(),
    },
    setting: {
      findFirst: vi.fn(),
    },
  }
  return { db: mockDb }
})

// ── Mock chat-emit (captures 80% warning events) ────────────────────────────
vi.mock('@/lib/chat-emit', () => ({
  emitToTenant: vi.fn(),
}))

// ── Mock logger ─────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => {
  const mock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mock),
  }
  return {
    getLogger: vi.fn(() => mock),
    logger: mock,
    default: mock,
  }
})

import { checkBudgetBeforeCall, invalidateBudgetCache } from '@/lib/llm/budget'
import { db } from '@/lib/db'
import { emitToTenant } from '@/lib/chat-emit'

beforeEach(() => {
  vi.clearAllMocks()
  // CRITICAL: clear the in-memory budget cache between tests. The budget
  // module caches {budget, spent} per tenant for 5 min (daily) / 15 min
  // (monthly) — without invalidation, subsequent tests in this file
  // would see stale cached values from earlier tests and never invoke
  // the mocked `db.decisionLog.aggregate`.
  invalidateBudgetCache('ten-1')
  invalidateBudgetCache('ten-2')

  // Default: no Setting override → budgets fall back to defaults ($10/day,
  // $200/month).
  vi.mocked(db.setting.findFirst).mockResolvedValue(null)
})

// ─────────────────────────────────────────────────────────────────────────────

describe('LLM Budget · checkBudgetBeforeCall', () => {
  it('allows when under both daily and monthly budget', async () => {
    // Daily spent $5 / $10 default = 50%. Monthly spent $5 / $200 default = 2.5%.
    vi.mocked(db.decisionLog.aggregate).mockResolvedValue({
      _sum: { costUsd: 5 },
    } as any)

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBeGreaterThan(0)
    // No warning emitted (both pcts < 80%).
    expect(emitToTenant).not.toHaveBeenCalled()
  })

  it('blocks when daily budget exceeded (returns daily message)', async () => {
    // Daily spent $15 / $10 default → exceeded.
    vi.mocked(db.decisionLog.aggregate).mockResolvedValue({
      _sum: { costUsd: 15 },
    } as any)

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(false)
    expect(result.message).toMatch(/excedido/i)
    expect(result.message).toMatch(/diario/i)
    // Daily check short-circuits — monthly aggregate is never queried.
    expect(db.decisionLog.aggregate).toHaveBeenCalledTimes(1)
  })

  it('blocks when monthly budget exceeded (returns monthly message)', async () => {
    // Daily is fine ($5 / $10 = 50%), but monthly is over ($250 / $200 = 125%).
    vi.mocked(db.decisionLog.aggregate)
      .mockResolvedValueOnce({ _sum: { costUsd: 5 } } as any) // daily
      .mockResolvedValueOnce({ _sum: { costUsd: 250 } } as any) // monthly

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(false)
    expect(result.message).toMatch(/excedido/i)
    expect(result.message).toMatch(/mensual/i)
    // Both daily + monthly aggregates were queried (daily passed, then
    // monthly failed).
    expect(db.decisionLog.aggregate).toHaveBeenCalledTimes(2)
  })

  it('emits 80% daily warning when daily spent crosses 80% threshold', async () => {
    // Daily spent $8.50 / $10 = 85% → triggers the 80% warning (not blocking).
    // Monthly spent $8.50 / $200 = 4.25% → no monthly warning.
    vi.mocked(db.decisionLog.aggregate).mockResolvedValue({
      _sum: { costUsd: 8.5 },
    } as any)

    const result = await checkBudgetBeforeCall('ten-1')

    // The call is allowed (85% < 100%).
    expect(result.allowed).toBe(true)
    // Warning emitted to the tenant's dashboard room.
    expect(emitToTenant).toHaveBeenCalledWith(
      'ten-1',
      'llm:budget_warning',
      expect.objectContaining({
        type: 'daily',
        pct: 85,
        spent: 8.5,
        budget: 10,
      }),
    )
    // Result includes the human-readable warning for the caller's logs.
    expect(result.warning).toMatch(/85%/)
  })

  it('emits 80% monthly warning when monthly spent crosses 80% threshold', async () => {
    // Daily spent $5 / $10 = 50% (no warning). Monthly spent $170 / $200 = 85%.
    vi.mocked(db.decisionLog.aggregate)
      .mockResolvedValueOnce({ _sum: { costUsd: 5 } } as any) // daily
      .mockResolvedValueOnce({ _sum: { costUsd: 170 } } as any) // monthly

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(true)
    expect(emitToTenant).toHaveBeenCalledWith(
      'ten-1',
      'llm:budget_warning',
      expect.objectContaining({
        type: 'monthly',
        pct: 85,
        spent: 170,
        budget: 200,
      }),
    )
  })

  it('fails open on DB error (allows the LLM call)', async () => {
    // DB is down — both daily and monthly aggregates reject. The budget
    // module catches and returns `{allowed: true, ...}` (fail-open) so a
    // transient DB issue doesn't block all LLM traffic.
    vi.mocked(db.decisionLog.aggregate).mockRejectedValue(new Error('DB down'))

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(true)
    // No warning emitted (we don't know the spent amount when DB is down).
    expect(emitToTenant).not.toHaveBeenCalled()
  })

  it('fails open when setting lookup rejects too', async () => {
    vi.mocked(db.setting.findFirst).mockRejectedValue(new Error('DB down'))
    vi.mocked(db.decisionLog.aggregate).mockRejectedValue(new Error('DB down'))

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(true)
  })

  it('respects tenant daily budget override via Setting', async () => {
    // Tenant has configured a $50/day override (default is $10).
    // Spent $20 → 40% — under the override.
    //
    // `checkBudgetBeforeCall` queries Setting twice in order:
    //   1. `llm_daily_budget_usd::ten-1` (daily) → return $50 override.
    //   2. `llm_monthly_budget_usd::ten-1` (monthly) → return null (default $200).
    // We pre-queue both responses with `mockResolvedValueOnce` to avoid the
    // Prisma-typed `mockImplementation` signature mismatch.
    vi.mocked(db.setting.findFirst)
      .mockResolvedValueOnce({ value: '50' } as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(db.decisionLog.aggregate).mockResolvedValue({
      _sum: { costUsd: 20 },
    } as any)

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(true)
    // With $50 daily + $20 spent, remaining = $30 (monthly $200 - $20 = $180).
    // Math.min(30, 180) = 30.
    expect(result.remaining).toBe(30)
  })

  it('blocks when tenant override is exceeded', async () => {
    // Tenant has a tight $5/day override; spent $7 → exceeds.
    // Same Setting query order as above: daily override first, then monthly null.
    vi.mocked(db.setting.findFirst)
      .mockResolvedValueOnce({ value: '5' } as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(db.decisionLog.aggregate).mockResolvedValue({
      _sum: { costUsd: 7 },
    } as any)

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(false)
    expect(result.message).toMatch(/excedido/i)
    // Message includes the actual spent ($7) and configured budget ($5).
    expect(result.message).toContain('7')
    expect(result.message).toContain('5')
  })

  it('returns the more restrictive remaining (min of daily/monthly)', async () => {
    // Daily: $10 - $8 = $2 remaining. Monthly: $200 - $5 = $195 remaining.
    // min(2, 195) = 2.
    vi.mocked(db.decisionLog.aggregate)
      .mockResolvedValueOnce({ _sum: { costUsd: 8 } } as any) // daily
      .mockResolvedValueOnce({ _sum: { costUsd: 5 } } as any) // monthly

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('does not emit warning at exactly 100% (blocks instead)', async () => {
    // Daily spent $10 / $10 = 100% → blocked (not warned).
    vi.mocked(db.decisionLog.aggregate).mockResolvedValue({
      _sum: { costUsd: 10 },
    } as any)

    const result = await checkBudgetBeforeCall('ten-1')

    expect(result.allowed).toBe(false)
    // 100% is blocking, not warning — no emit.
    expect(emitToTenant).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('LLM Budget · cache invalidation', () => {
  it('invalidateBudgetCache forces the next check to re-query the DB', async () => {
    // First call: spent $5, cached for 5 min.
    vi.mocked(db.decisionLog.aggregate).mockResolvedValue({
      _sum: { costUsd: 5 },
    } as any)
    await checkBudgetBeforeCall('ten-2')
    const firstCallCount = vi.mocked(db.decisionLog.aggregate).mock.calls.length

    // Second call without invalidation: cache hit, no DB call.
    await checkBudgetBeforeCall('ten-2')
    expect(vi.mocked(db.decisionLog.aggregate).mock.calls.length).toBe(firstCallCount)

    // After invalidation: cache miss, DB called again.
    invalidateBudgetCache('ten-2')
    await checkBudgetBeforeCall('ten-2')
    expect(vi.mocked(db.decisionLog.aggregate).mock.calls.length).toBeGreaterThan(firstCallCount)
  })
})
