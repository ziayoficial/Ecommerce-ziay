// ZIAY — Prompt Versioning + A/B Testing (IA-6B · Gap 5)
//
// Closes the audit gap "prompts are hardcoded in `.ts` files with no
// versioning — can't A/B test prompt variations or roll back bad prompts".
//
// This module layers a `PromptVersion` table on top of the existing
// `prompts/{agentName}.ts` builder files. The builders remain the source
// of truth for prompt TEXT; this module wraps them so:
//
//   1. Each `.ts` prompt file is implicitly version "1.0.0" with
//      `status='active'`. No code change required in the builders.
//   2. Operators can register an `experiment` version (different system +
//      user prompt text) with a `trafficPct` (0-100). The manager picks
//      the experiment for a given tenant if `hash(tenantId + agentName)
//      % 100 < trafficPct`, otherwise falls back to active.
//   3. `promote(agentName, version)` atomically flips the previous active
//      to 'archived' and the new one to 'active' (100% rollout).
//   4. `rollback(agentName)` restores the most-recently-archived version
//      to active + archives the current one — instant revert on
//      regression detection.
//   5. `getMetrics(agentName)` returns the per-version success-rate +
//      latency + sample-size so the promotion gate can refuse to promote
//      an experiment whose success rate is below threshold.
//
// Wiring:
//   - The 3 LLM-call API routes (`/api/orchestrate`, `/api/ai-reply`,
//     `/api/agents/[agentName]`) call `promptVersionManager.getPrompt()`
//     right before the LLM call. The returned `version` is recorded on
//     the DecisionLog so auditors can see "this output came from
//     experiment v1.2.0".
//   - The QA Reviewer feedback loop (Gap 8) writes a `QAFeedback` row
//     with the `promptVersion` that produced the flawed output, so the
//     metrics roll-up can attribute failures to a specific version.
//
// Default-version convention:
//   The hard-coded prompt builders in `prompts/*.ts` are version "1.0.0".
//   When `getPrompt()` doesn't find a `PromptVersion` row for an agent,
//   it returns `{ system: '', user: '', version: '1.0.0' }` (empty
//   strings — the caller falls back to `buildAgentPrompt()`). This keeps
//   the manager zero-impact on agents that haven't been registered yet.
// ───────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type PromptVersionStatus = 'active' | 'experiment' | 'archived'

export interface PromptVersionMetrics {
  /** Fraction of cases the version passed (0-1). */
  successRate: number
  /** Average latency in ms. */
  avgLatencyMs: number
  /** Number of cases the metrics were computed from. */
  sampleSize: number
}

export interface PromptVersion {
  agentName: string
  /** semver: "1.0.0", "1.1.0-experiment", etc. */
  version: string
  status: PromptVersionStatus
  /** A/B traffic percentage (0-100). Only meaningful for status='experiment'. */
  trafficPct?: number
  /** Full system prompt text (overrides the .ts builder). */
  systemPrompt: string
  /** User prompt template — `{message}` is the customer input. */
  userPromptTemplate: string
  createdAt: Date
  metrics?: PromptVersionMetrics
}

export interface ResolvedPrompt {
  system: string
  user: string
  version: string
  /** Whether this is an experiment variant (vs. active / default). */
  isExperiment: boolean
}

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

/** The default version for every `.ts` prompt builder that hasn't been
 * explicitly registered. The convention is documented in the file header. */
export const DEFAULT_PROMPT_VERSION = '1.0.0'

/**
 * Promotion gate: an experiment can only be promoted to active if its
 * metrics meet this threshold. Prevents rolling out a regression to 100%
 * of traffic. The values are conservative — the audit recommended
 * `successRate >= 0.85 && sampleSize >= 50`.
 */
export const PROMOTION_GATE = {
  minSuccessRate: 0.85,
  minSampleSize: 50,
} as const

/** In-memory cache of (agentName → versions) — 1-min TTL. The DB is the
 * source of truth; the cache just avoids a round-trip on every LLM call
 * (which would otherwise add ~5ms per call to the orchestrator pipeline). */
const CACHE_TTL_MS = 60 * 1000

interface CacheEntry {
  versions: PromptVersion[]
  expiresAt: number
}
const versionCache = new Map<string, CacheEntry>()

// ───────────────────────────────────────────────────────────────────────────
// Hash helper — deterministic per (tenantId + agentName)
// ───────────────────────────────────────────────────────────────────────────

/**
 * FNV-1a hash — fast, well-distributed, no native deps. Returns a
 * non-negative integer. Used for A/B bucketing: `hash(tenantId + agentName)
 * % 100 < trafficPct` → use the experiment version.
 *
 * Determinism is critical: the same tenant MUST always see the same
 * variant for a given agent (otherwise a customer would get inconsistent
 * experiences turn-to-turn, which is worse than no A/B test at all).
 */
function fnv1aHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // FNV prime (32-bit).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

// ───────────────────────────────────────────────────────────────────────────
// Row → PromptVersion mapper
// ───────────────────────────────────────────────────────────────────────────

interface PromptVersionRow {
  id: string
  agentName: string
  version: string
  status: string
  trafficPct: number | null
  systemPrompt: string
  userPromptTemplate: string
  metrics: string | null
  createdAt: Date
  updatedAt: Date
}

function rowToPromptVersion(row: PromptVersionRow): PromptVersion {
  let metrics: PromptVersionMetrics | undefined
  if (row.metrics) {
    try {
      const parsed = JSON.parse(row.metrics) as Partial<PromptVersionMetrics>
      metrics = {
        successRate: typeof parsed.successRate === 'number' ? parsed.successRate : 0,
        avgLatencyMs: typeof parsed.avgLatencyMs === 'number' ? parsed.avgLatencyMs : 0,
        sampleSize: typeof parsed.sampleSize === 'number' ? parsed.sampleSize : 0,
      }
    } catch {
      metrics = undefined
    }
  }
  return {
    agentName: row.agentName,
    version: row.version,
    status: row.status as PromptVersionStatus,
    trafficPct: row.trafficPct ?? undefined,
    systemPrompt: row.systemPrompt,
    userPromptTemplate: row.userPromptTemplate,
    createdAt: row.createdAt,
    metrics,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PromptVersionManager
// ───────────────────────────────────────────────────────────────────────────

export class PromptVersionManager {
  /**
   * Resolve the prompt for an agent + tenant. Selection logic:
   *
   *   1. If there's an `experiment` version with `trafficPct > 0` AND
   *      `hash(tenantId + agentName) % 100 < trafficPct`, return it.
   *   2. Else if there's an `active` version, return it.
   *   3. Else return the default `{ system: '', user: '', version: '1.0.0' }`
   *      — the caller falls back to the `.ts` builder.
   *
   * `tenantId` is optional — when omitted (e.g. for background jobs that
   * don't have a tenant context), only the `active` path is used (no
   * experiment bucketing — we don't know which bucket to put them in).
   *
   * NEVER throws — a DB error returns the default. The caller's prompt
   * builder must always work.
   */
  async getPrompt(agentName: string, tenantId?: string): Promise<ResolvedPrompt> {
    try {
      const versions = await this.getVersions(agentName)
      if (versions.length === 0) {
        return { system: '', user: '', version: DEFAULT_PROMPT_VERSION, isExperiment: false }
      }

      // 1. A/B bucketing — only when we have a tenantId to bucket on.
      if (tenantId) {
        const experiments = versions.filter(
          (v) => v.status === 'experiment' && (v.trafficPct ?? 0) > 0,
        )
        for (const exp of experiments) {
          const bucket = fnv1aHash(`${tenantId}::${agentName}`) % 100
          if (bucket < (exp.trafficPct ?? 0)) {
            return {
              system: exp.systemPrompt,
              user: exp.userPromptTemplate,
              version: exp.version,
              isExperiment: true,
            }
          }
        }
      }

      // 2. Active version.
      const active = versions.find((v) => v.status === 'active')
      if (active) {
        return {
          system: active.systemPrompt,
          user: active.userPromptTemplate,
          version: active.version,
          isExperiment: false,
        }
      }

      // 3. No active row — caller falls back to the .ts builder.
      return { system: '', user: '', version: DEFAULT_PROMPT_VERSION, isExperiment: false }
    } catch (err) {
      captureError(err, {
        service: 'agents',
        method: 'prompt-versioning.getPrompt',
        agentName,
        tenantId,
      })
      return { system: '', user: '', version: DEFAULT_PROMPT_VERSION, isExperiment: false }
    }
  }

  /**
   * Register a new prompt version. The first version registered for an
   * agent MUST be 'active' (no prior active to supersede). Subsequent
   * registrations default to 'experiment' unless `status='active'` is
   * explicitly passed (which would archive the previous active).
   *
   * Idempotent: re-registering the same (agentName, version) tuple
   * updates the row in place.
   */
  async registerVersion(version: PromptVersion): Promise<void> {
    try {
      // If the new version is 'active', archive any existing 'active' for
      // this agent (one-active-per-agent invariant).
      if (version.status === 'active') {
        await db.promptVersion.updateMany({
          where: { agentName: version.agentName, status: 'active' },
          data: { status: 'archived' },
        })
      }

      await db.promptVersion.upsert({
        where: {
          agentName_version: {
            agentName: version.agentName,
            version: version.version,
          },
        },
        update: {
          status: version.status,
          trafficPct: version.trafficPct ?? null,
          systemPrompt: version.systemPrompt,
          userPromptTemplate: version.userPromptTemplate,
          metrics: version.metrics ? JSON.stringify(version.metrics) : null,
        },
        create: {
          agentName: version.agentName,
          version: version.version,
          status: version.status,
          trafficPct: version.trafficPct ?? null,
          systemPrompt: version.systemPrompt,
          userPromptTemplate: version.userPromptTemplate,
          metrics: version.metrics ? JSON.stringify(version.metrics) : null,
        },
      })

      // Invalidate the cache so the next `getPrompt()` sees the new row.
      versionCache.delete(version.agentName)
      logger.info(
        { agentName: version.agentName, version: version.version, status: version.status },
        'prompt-version.registered',
      )
    } catch (err) {
      captureError(err, {
        service: 'agents',
        method: 'prompt-versioning.registerVersion',
        agentName: version.agentName,
      })
      throw err
    }
  }

  /**
   * Promote an experiment to active — 100% rollout. Atomically:
   *   1. Enforces the promotion gate (`successRate >= 0.85 && sampleSize >= 50`)
   *      unless `force: true` is passed (operator override).
   *   2. Archives the current active version.
   *   3. Flips the experiment to active.
   *
   * Throws if the version doesn't exist, isn't an experiment, or fails
   * the promotion gate.
   */
  async promote(
    agentName: string,
    version: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    try {
      const target = await db.promptVersion.findUnique({
        where: { agentName_version: { agentName, version } },
      })
      if (!target) {
        throw new Error(`PromptVersion not found: ${agentName}@${version}`)
      }
      if (target.status !== 'experiment') {
        throw new Error(
          `Cannot promote ${agentName}@${version}: status is '${target.status}', must be 'experiment'`,
        )
      }

      // Promotion gate (unless overridden).
      if (!options.force) {
        let metrics: PromptVersionMetrics | undefined
        if (target.metrics) {
          try {
            metrics = JSON.parse(target.metrics) as PromptVersionMetrics
          } catch {
            // Treat unparseable metrics as "no metrics" — fail the gate.
          }
        }
        if (
          !metrics ||
          metrics.successRate < PROMOTION_GATE.minSuccessRate ||
          metrics.sampleSize < PROMOTION_GATE.minSampleSize
        ) {
          throw new Error(
            `Promotion gate failed for ${agentName}@${version}: requires successRate >= ${PROMOTION_GATE.minSuccessRate} and sampleSize >= ${PROMOTION_GATE.minSampleSize}. ` +
              `Got: ${metrics ? `successRate=${metrics.successRate}, sampleSize=${metrics.sampleSize}` : 'no metrics'}. ` +
              `Pass { force: true } to override.`,
          )
        }
      }

      // Archive the current active, then flip the experiment to active.
      await db.$transaction([
        db.promptVersion.updateMany({
          where: { agentName, status: 'active' },
          data: { status: 'archived' },
        }),
        db.promptVersion.update({
          where: { agentName_version: { agentName, version } },
          data: { status: 'active', trafficPct: null },
        }),
      ])

      versionCache.delete(agentName)
      logger.info({ agentName, version }, 'prompt-version.promoted')
    } catch (err) {
      captureError(err, {
        service: 'agents',
        method: 'prompt-versioning.promote',
        agentName,
        version,
      })
      throw err
    }
  }

  /**
   * Roll back to the most-recently-archived version. Atomically:
   *   1. Archives the current active.
   *   2. Restores the most-recently-archived version (by `updatedAt` desc).
   *
   * If no archived version exists, throws — there's nothing to roll back
   * to (the current active was the first registered version).
   */
  async rollback(agentName: string): Promise<{ fromVersion: string; toVersion: string }> {
    try {
      const versions = await db.promptVersion.findMany({
        where: { agentName },
        orderBy: { updatedAt: 'desc' },
      })
      const active = versions.find((v) => v.status === 'active')
      const archived = versions.find((v) => v.status === 'archived')
      if (!active) {
        throw new Error(`Cannot rollback ${agentName}: no active version to roll back from`)
      }
      if (!archived) {
        throw new Error(
          `Cannot rollback ${agentName}: no archived version to roll back to (the active version was the first registered)`,
        )
      }

      await db.$transaction([
        db.promptVersion.update({
          where: { id: active.id },
          data: { status: 'archived' },
        }),
        db.promptVersion.update({
          where: { id: archived.id },
          data: { status: 'active' },
        }),
      ])

      versionCache.delete(agentName)
      logger.info(
        { agentName, fromVersion: active.version, toVersion: archived.version },
        'prompt-version.rollback',
      )
      return { fromVersion: active.version, toVersion: archived.version }
    } catch (err) {
      captureError(err, {
        service: 'agents',
        method: 'prompt-versioning.rollback',
        agentName,
      })
      throw err
    }
  }

  /**
   * Get all versions for an agent (with their metrics). Used by the
   * admin dashboard + the promotion-gate check inside `promote()`.
   */
  async getMetrics(agentName: string): Promise<PromptVersion[]> {
    return this.getVersions(agentName)
  }

  /**
   * Update the metrics for a specific version. Called periodically by
   * the QA Reviewer feedback loop (e.g. every N QA runs) to keep the
   * promotion-gate signal fresh.
   */
  async updateMetrics(
    agentName: string,
    version: string,
    metrics: PromptVersionMetrics,
  ): Promise<void> {
    try {
      await db.promptVersion.update({
        where: { agentName_version: { agentName, version } },
        data: { metrics: JSON.stringify(metrics) },
      })
      versionCache.delete(agentName)
    } catch (err) {
      captureError(err, {
        service: 'agents',
        method: 'prompt-versioning.updateMetrics',
        agentName,
        version,
      })
      throw err
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────

  /**
   * Load all versions for an agent, with a 1-min in-memory cache. The
   * cache is invalidated by `registerVersion` / `promote` / `rollback`
   * / `updateMetrics` so stale reads are impossible for any writer
   * going through this manager.
   */
  private async getVersions(agentName: string): Promise<PromptVersion[]> {
    const cached = versionCache.get(agentName)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.versions
    }

    const rows = await db.promptVersion.findMany({
      where: { agentName },
      orderBy: { createdAt: 'desc' },
    })
    const versions = rows.map(rowToPromptVersion)
    versionCache.set(agentName, {
      versions,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
    return versions
  }

  /**
   * Test-only: clear the in-memory cache. Exported so tests can
   * isolate runs without waiting for the TTL.
   */
  clearCacheForTesting(): void {
    versionCache.clear()
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Singleton
// ───────────────────────────────────────────────────────────────────────────

export const promptVersionManager = new PromptVersionManager()
