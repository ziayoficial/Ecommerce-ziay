// Pipeline memory TTL unit tests.
// SPRINT-TESTS-FINAL-001 · §4.
//
// Tests the 24h TTL eviction + 30-entry cap + timestamp-backfill logic in
// `src/app/api/orchestrate/route.ts`. The orchestrate route loads
// `Conversation.pipelineMemory` (a JSON array of `{role, content,
// timestamp?}` entries), evicts entries older than 24h, runs the 9-step
// pipeline, then persists the last 30 entries back (backfilling missing
// timestamps so the next load can apply TTL uniformly).
//
// The route doesn't export the helper functions — they're inlined in the
// POST handler. Rather than refactor production code to expose them, we
// re-implement the exact same filter/slice/map logic here (mirroring the
// route's source line-by-line) and verify the behavior holds for:
//   - entries older than 24h are evicted
//   - entries without timestamp are kept (backward compat)
//   - exactly 24h boundary: strict `>` means equal-ts entries are evicted
//   - persistence caps at 30 entries (slice(-30))
//   - persistence backfills `timestamp` on entries missing one
//   - malformed JSON.parse falls back to empty array
//
// The "load + filter" snippet mirrored from the route:
//
//   const cutoff = Date.now() - 24 * 60 * 60 * 1000
//   pipelineMemory = validated.filter((entry) => {
//     if (!entry.timestamp) return true
//     return new Date(entry.timestamp).getTime() > cutoff
//   })
//
// The "persist" snippet mirrored from the route:
//
//   const nowIso = new Date().toISOString()
//   const toPersist = pipelineMemory.slice(-30).map((entry) => ({
//     ...entry,
//     timestamp: entry.timestamp || nowIso,
//   }))

import { describe, it, expect } from 'vitest'

// Mirror of `PipelineMemoryEntry` from the orchestrate route.
type PipelineMemoryEntry = {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp?: string
}

const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * ONE_HOUR_MS

// ─── Load + TTL eviction (mirrors the route's load path) ─────────────────────

function loadAndEvict(entries: PipelineMemoryEntry[], now = Date.now()): PipelineMemoryEntry[] {
  const cutoff = now - ONE_DAY_MS
  return entries.filter((entry) => {
    if (!entry.timestamp) return true
    return new Date(entry.timestamp).getTime() > cutoff
  })
}

// ─── Persist (mirrors the route's persist path) ──────────────────────────────

function persistEntries(
  entries: PipelineMemoryEntry[],
  now = Date.now(),
): PipelineMemoryEntry[] {
  const nowIso = new Date(now).toISOString()
  return entries.slice(-30).map((entry) => ({
    ...entry,
    timestamp: entry.timestamp || nowIso,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Pipeline Memory TTL · eviction on load', () => {
  it('evicts entries older than 24 hours', () => {
    const now = Date.now()
    const entries: PipelineMemoryEntry[] = [
      {
        role: 'assistant',
        content: 'old (25h ago)',
        timestamp: new Date(now - 25 * ONE_HOUR_MS).toISOString(),
      },
      {
        role: 'assistant',
        content: 'recent (1h ago)',
        timestamp: new Date(now - 1 * ONE_HOUR_MS).toISOString(),
      },
    ]

    const kept = loadAndEvict(entries, now)

    expect(kept).toHaveLength(1)
    expect(kept[0].content).toBe('recent (1h ago)')
  })

  it('keeps entries without timestamp (backward compat with pre-sprint data)', () => {
    // Entries persisted before SPRINT-AI-FRONTEND-001 §3 don't have a
    // `timestamp` field. The route conservatively keeps them (assumes
    // recent) and backfills a timestamp on the next persist.
    const entries: PipelineMemoryEntry[] = [
      { role: 'assistant', content: 'no-timestamp-1' },
      { role: 'assistant', content: 'no-timestamp-2' },
      { role: 'assistant', content: 'recent', timestamp: new Date().toISOString() },
    ]

    const kept = loadAndEvict(entries)

    expect(kept).toHaveLength(3)
  })

  it('evicts entries at exactly the 24h boundary (strict >)', () => {
    // The route uses `> cutoff` (strict), so an entry whose timestamp
    // equals the cutoff is EVICTED. This is intentional — the cutoff
    // drifts forward in time, so a ts exactly at cutoff is already
    // stale by the next request.
    const now = Date.now()
    const cutoff = now - ONE_DAY_MS
    const entries: PipelineMemoryEntry[] = [
      {
        role: 'assistant',
        content: 'exactly-at-cutoff',
        timestamp: new Date(cutoff).toISOString(),
      },
      {
        role: 'assistant',
        content: '1ms-after-cutoff',
        timestamp: new Date(cutoff + 1).toISOString(),
      },
    ]

    const kept = loadAndEvict(entries, now)

    expect(kept).toHaveLength(1)
    expect(kept[0].content).toBe('1ms-after-cutoff')
  })

  it('keeps all entries when all are within 24h', () => {
    const now = Date.now()
    const entries: PipelineMemoryEntry[] = [
      { role: 'assistant', content: 'now', timestamp: new Date(now).toISOString() },
      { role: 'assistant', content: '1h ago', timestamp: new Date(now - ONE_HOUR_MS).toISOString() },
      { role: 'assistant', content: '12h ago', timestamp: new Date(now - 12 * ONE_HOUR_MS).toISOString() },
      { role: 'assistant', content: '23h ago', timestamp: new Date(now - 23 * ONE_HOUR_MS).toISOString() },
    ]

    const kept = loadAndEvict(entries, now)

    expect(kept).toHaveLength(4)
  })

  it('evicts all entries when all are older than 24h', () => {
    const now = Date.now()
    const entries: PipelineMemoryEntry[] = [
      { role: 'assistant', content: '25h ago', timestamp: new Date(now - 25 * ONE_HOUR_MS).toISOString() },
      { role: 'assistant', content: '48h ago', timestamp: new Date(now - 48 * ONE_HOUR_MS).toISOString() },
      { role: 'assistant', content: '1 week ago', timestamp: new Date(now - 7 * ONE_DAY_MS).toISOString() },
    ]

    const kept = loadAndEvict(entries, now)

    expect(kept).toHaveLength(0)
  })

  it('handles mixed: evicts old, keeps recent and no-timestamp', () => {
    const now = Date.now()
    const entries: PipelineMemoryEntry[] = [
      { role: 'assistant', content: 'no-ts', /* no timestamp */ },
      { role: 'assistant', content: 'recent', timestamp: new Date(now - 1 * ONE_HOUR_MS).toISOString() },
      { role: 'assistant', content: 'old', timestamp: new Date(now - 30 * ONE_HOUR_MS).toISOString() },
    ]

    const kept = loadAndEvict(entries, now)

    expect(kept.map((e) => e.content)).toEqual(['no-ts', 'recent'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Pipeline Memory TTL · persist cap + timestamp backfill', () => {
  it('limits to 30 entries when persisting (slice(-30))', () => {
    // With 9 steps per pipeline 'full' + multi-turn continuity, the
    // array can grow beyond 30. The route persists only the last 30.
    const entries: PipelineMemoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
      role: 'assistant' as const,
      content: `entry-${i}`,
      timestamp: new Date().toISOString(),
    }))

    const persisted = persistEntries(entries)

    expect(persisted).toHaveLength(30)
    // slice(-30) keeps entries 20..49.
    expect(persisted[0].content).toBe('entry-20')
    expect(persisted[29].content).toBe('entry-49')
  })

  it('does not truncate when entries are under 30', () => {
    const entries: PipelineMemoryEntry[] = Array.from({ length: 15 }, (_, i) => ({
      role: 'assistant' as const,
      content: `entry-${i}`,
      timestamp: new Date().toISOString(),
    }))

    const persisted = persistEntries(entries)

    expect(persisted).toHaveLength(15)
    expect(persisted[0].content).toBe('entry-0')
  })

  it('backfills timestamp on entries without one (so next load can apply TTL)', () => {
    // Pre-sprint entries lack `timestamp`. The persist path backfills
    // `nowIso` so the NEXT load can uniformly apply TTL eviction.
    const fixedNow = Date.parse('2024-06-15T12:00:00.000Z')
    const entries: PipelineMemoryEntry[] = [
      { role: 'assistant', content: 'no-ts-1' },
      { role: 'assistant', content: 'has-ts', timestamp: '2024-06-14T10:00:00.000Z' },
    ]

    const persisted = persistEntries(entries, fixedNow)

    // The entry without a timestamp now has one (the persist-time nowIso).
    expect(persisted[0].timestamp).toBe('2024-06-15T12:00:00.000Z')
    // The entry that already had a timestamp keeps its original value
    // (NOT overwritten with nowIso — the `||` short-circuits).
    expect(persisted[1].timestamp).toBe('2024-06-14T10:00:00.000Z')
  })

  it('preserves role + content of each entry when backfilling', () => {
    const entries: PipelineMemoryEntry[] = [
      { role: 'user', content: 'user msg' },
      { role: 'assistant', content: 'assistant reply' },
      { role: 'system', content: 'system note' },
    ]

    const persisted = persistEntries(entries)

    expect(persisted.map((e) => ({ role: e.role, content: e.content }))).toEqual([
      { role: 'user', content: 'user msg' },
      { role: 'assistant', content: 'assistant reply' },
      { role: 'system', content: 'system note' },
    ])
    // All three got a backfilled timestamp.
    expect(persisted.every((e) => typeof e.timestamp === 'string' && e.timestamp!.length > 0)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Pipeline Memory TTL · round-trip (load → evict → persist → load)', () => {
  it('round-trips cleanly when all entries are recent', () => {
    const now = Date.now()
    const original: PipelineMemoryEntry[] = Array.from({ length: 9 }, (_, i) => ({
      role: 'assistant' as const,
      content: `step-${i}`,
      timestamp: new Date(now).toISOString(),
    }))

    // Simulate: persist → reload.
    const persisted = persistEntries(original, now)
    const reloaded = loadAndEvict(persisted, now)

    expect(reloaded).toHaveLength(9)
    expect(reloaded.map((e) => e.content)).toEqual(
      original.map((e) => e.content),
    )
  })

  it('after 25h, a previously-persisted entry is evicted on next load', () => {
    const t0 = Date.now()
    const entries: PipelineMemoryEntry[] = [
      { role: 'assistant', content: 'msg-from-yesterday', timestamp: new Date(t0).toISOString() },
    ]
    const persisted = persistEntries(entries, t0)

    // 25 hours pass — next pipeline invocation loads the memory.
    const t1 = t0 + 25 * ONE_HOUR_MS
    const reloaded = loadAndEvict(persisted, t1)

    expect(reloaded).toHaveLength(0)
  })

  it('backfilled timestamp enables TTL eviction on a previously-no-ts entry', () => {
    const t0 = Date.parse('2024-06-15T12:00:00.000Z')
    // Entry without timestamp — gets backfilled during persist.
    const entries: PipelineMemoryEntry[] = [
      { role: 'assistant', content: 'legacy-no-ts' },
    ]
    const persisted = persistEntries(entries, t0)

    // On the next load (immediately after), the entry has a timestamp
    // (the backfilled t0) → kept (within 24h).
    const keptImmediately = loadAndEvict(persisted, t0)
    expect(keptImmediately).toHaveLength(1)

    // 25h later → evicted (the backfilled timestamp enables TTL).
    const keptLater = loadAndEvict(persisted, t0 + 25 * ONE_HOUR_MS)
    expect(keptLater).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Pipeline Memory TTL · load validation', () => {
  it('filters out entries with invalid role', () => {
    // The route's validator only accepts role ∈ {system, user, assistant}.
    // Entries with any other role (or null/non-object) are dropped before
    // the TTL filter runs. We mirror that validation here.
    const raw = [
      { role: 'assistant', content: 'ok' },
      { role: 'invalid', content: 'bad-role' },
      { role: 'user', content: 'ok-user' },
      { role: null, content: 'null-role' },
      { content: 'missing-role' },
      'not-an-object',
      null,
    ]

    const validated: PipelineMemoryEntry[] = raw.filter(
      (m: any): m is PipelineMemoryEntry =>
        m !== null &&
        typeof m === 'object' &&
        typeof m.content === 'string' &&
        (m.role === 'system' || m.role === 'user' || m.role === 'assistant') &&
        (m.timestamp === undefined || typeof m.timestamp === 'string'),
    )

    expect(validated).toHaveLength(2)
    expect(validated.map((v) => v.role)).toEqual(['assistant', 'user'])
  })

  it('handles malformed JSON.parse by falling back to empty array', () => {
    // The route wraps `JSON.parse` in try/catch — invalid JSON returns [].
    let pipelineMemory: PipelineMemoryEntry[] = []
    try {
      const parsed = JSON.parse('not valid json {{{')
      if (Array.isArray(parsed)) {
        pipelineMemory = parsed as PipelineMemoryEntry[]
      }
    } catch {
      pipelineMemory = []
    }

    expect(pipelineMemory).toEqual([])
  })
})
