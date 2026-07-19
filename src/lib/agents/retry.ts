// ZIAY — Retry with exponential backoff (IA-6A · Gap 1)
//
// Wraps async functions with retry + exponential backoff + jitter. Used by
// the LLM call sites (`orchestrator.callAgentDirect`, the 3 API routes'
// `callAgent` / `runToolLoop` invocations) so transient LLM API failures
// (network blips, 5xx, 429 rate limits) don't surface to the customer.
//
// ─── Retry policy ────────────────────────────────────────────────────────
//   - Default: 3 retries. Delays: 500ms → 1s → 2s → 4s (capped at 5s).
//   - Exponential backoff: `delay = min(initial * multiplier^attempt, max)`.
//   - ±20% jitter added to every delay — prevents thundering-herd when
//     many concurrent requests retry at the same instant (e.g. after a
//     provider-wide 503).
//   - Only retries TRANSIENT errors: network (ETIMEDOUT, ENOTFOUND),
//     HTTP 5xx, 429 rate-limit. 4xx client errors and validation errors
//     are NOT retried (the request itself is wrong — retrying wastes a
//     call and risks amplifying a bad request).
//
// ─── How errors are classified ───────────────────────────────────────────
//   - The function inspects the thrown error's `message` and `code`
//     (Node.js network errors set `code` to ETIMEDOUT/ENOTFOUND/etc.).
//   - HTTP-style errors are detected by substring-matching the status
//     code in the message (e.g. "500 Internal Server Error"). This is
//     provider-agnostic — works for ZAI, OpenAI, xAI, Ollama which all
//     surface HTTP errors as `Error` subclasses with the status embedded
//     in the message.
//   - Callers can override the default `retryableErrors` list when the
//     underlying transport surfaces errors with custom codes (e.g. a
//     streaming adapter that emits 'STREAM_RESET').
//
// ─── Logging ────────────────────────────────────────────────────────────
//   - Each retry attempt is logged at WARN level with the attempt number,
//     delay, error message, and the next attempt's max delay. The final
//     success after retries is logged at INFO. A retry-exhausted failure
//     is logged at ERROR (the caller's catch block logs the user-facing
//     fallback separately).
//   - The logger is created with the `agent:retry` namespace so operators
//     can filter retry traffic separately from the agent's own logs.
//
// ─── Use outside LLM calls ──────────────────────────────────────────────
//   - The utility is generic — it can wrap any async function. The
//     built-in defaults are tuned for LLM API calls (500ms initial delay
//     is conservative enough that 429s from rate-limiting get a fair
//     chance to recover without blocking the response too long). For
//     other use cases (DB calls, fetch), pass a custom config.
//
// IA-6A (Gap 1)

import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('agent:retry')

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

/**
 * Retry configuration. All fields optional — `withRetry` merges the
 * caller's partial config with `DEFAULT_RETRY_CONFIG`.
 */
export interface RetryConfig {
  /** Maximum retry attempts (not counting the initial try). Default: 3. */
  maxRetries: number
  /** Initial delay before the first retry, in ms. Default: 500. */
  initialDelayMs: number
  /** Maximum delay between retries, in ms. Default: 5000. */
  maxDelayMs: number
  /** Backoff multiplier — delay = initial * multiplier^attempt. Default: 2. */
  backoffMultiplier: number
  /**
   * Error codes/messages that trigger a retry. Matches against the
   * error's `code` field (Node.js convention) AND substring-matches the
   * error's `message`. Defaults cover the common transient LLM API
   * failures: network errors, HTTP 5xx, 429 rate-limit.
   */
  retryableErrors: string[]
}

/**
 * Default config — tuned for LLM API calls. Conservative enough that a
 * 429 from rate-limiting gets a fair chance to recover, aggressive
 * enough that the worst-case added latency stays under 10s (3 retries
 * with the 5s cap → max ~8.7s of backoff before the final attempt).
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5_000,
  backoffMultiplier: 2,
  retryableErrors: ['ETIMEDOUT', 'ENOTFOUND', '500', '502', '503', '429'],
}

/**
 * Metadata about a retry attempt — surfaced in logs + returned to the
 * caller via the `RetryOutcome` so they can record it on the tracing
 * span / DecisionLog for audit.
 */
export interface RetryAttempt {
  /** 1-based attempt number (1 = the first retry, after the initial try failed). */
  attempt: number
  /** Delay actually waited (after jitter), in ms. */
  delayMs: number
  /** Error message that triggered this retry. */
  error: string
}

/**
 * Outcome of a `withRetry` call — returned alongside the result so the
 * caller can audit "did this call need retries?".
 */
export interface RetryOutcome {
  /** Total number of retries performed (0 = succeeded on first try). */
  retries: number
  /** Per-retry metadata. Empty when the call succeeded on first try. */
  attempts: RetryAttempt[]
  /** Total time spent in backoff delays, in ms. 0 when no retries. */
  totalDelayMs: number
  /** True when the call succeeded only after at least one retry. */
  recovered: boolean
}

// ───────────────────────────────────────────────────────────────────────────
// Error classification
// ───────────────────────────────────────────────────────────────────────────

/**
 * Inspect a thrown error and decide whether it's transient (retryable)
 * or permanent (give up immediately).
 *
 * The check is intentionally fuzzy — it matches the error's `code`
 * field (Node.js network-error convention) AND substring-matches the
 * error's `message` (where HTTP status codes typically appear in the
 * provider adapters' error messages). This keeps the retry layer
 * provider-agnostic: it works for ZAI, OpenAI, xAI, Ollama without
 * needing per-provider error-type imports.
 *
 * 4xx errors (400/401/403/404/422) are NEVER retryable — they signal
 * a malformed request that retrying would only amplify. 429 is the
 * exception (rate-limit, retryable).
 */
export function isRetryableError(err: unknown, retryableErrors: string[]): boolean {
  if (err === null || err === undefined) return false
  // Node.js network errors carry `code` (ETIMEDOUT, ENOTFOUND, ECONNRESET, etc.).
  // We only retry the codes explicitly listed in `retryableErrors`.
  const code = (err as { code?: unknown }).code
  const codeStr = typeof code === 'string' ? code : ''
  // The error message — most HTTP-style errors from the provider adapters
  // embed the status code here (e.g. "Request failed with status 503").
  const message = err instanceof Error ? err.message : String(err)
  for (const retryable of retryableErrors) {
    if (codeStr === retryable) return true
    if (message.includes(retryable)) return true
  }
  return false
}

// ───────────────────────────────────────────────────────────────────────────
// Delay calculation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compute the backoff delay for a given attempt (1-based) with the
 * configured exponential growth + cap + ±20% jitter.
 *
 *   attempt=1 → initial * mult^0 = initial       (capped, jittered)
 *   attempt=2 → initial * mult^1                  (capped, jittered)
 *   attempt=3 → initial * mult^2                  (capped, jittered)
 *
 * The jitter is uniformly distributed in [0.8 * delay, 1.2 * delay] —
 * ±20%. Wide enough to de-synchronise concurrent retries, narrow
 * enough that the worst-case delay stays predictable.
 */
export function computeBackoffDelay(
  attempt: number,
  config: Pick<RetryConfig, 'initialDelayMs' | 'maxDelayMs' | 'backoffMultiplier'>,
): number {
  const raw = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1)
  const capped = Math.min(raw, config.maxDelayMs)
  // ±20% jitter: multiply by a random factor in [0.8, 1.2].
  const jitterFactor = 0.8 + Math.random() * 0.4
  return Math.round(capped * jitterFactor)
}

// ───────────────────────────────────────────────────────────────────────────
// withRetry — the public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Wrap an async function with retry + exponential backoff + jitter.
 *
 * Behavior:
 *   - Calls `fn()` once. If it throws a retryable error, waits
 *     `computeBackoffDelay(attempt, config)` ms and retries.
 *   - Up to `maxRetries` retries. After the last retry fails, rethrows
 *     the last error.
 *   - Non-retryable errors rethrow immediately (no delay, no retry).
 *   - Each retry is logged at WARN. Final success after retries at INFO.
 *     Retry-exhausted failure at ERROR (then rethrown).
 *
 * Returns the result of `fn()` on success. The `RetryOutcome` is
 * attached as a non-enumerable property `_retry` on the returned value
 * when the value is an object — callers that need the outcome metadata
 * should use the `withRetryAndOutcome` variant instead.
 *
 * @example
 * ```ts
 * const result = await withRetry(() => chat(messages, opts), {
 *   maxRetries: 2,
 * })
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const { outcome, result } = await withRetryAndOutcome(fn, config)
  // Attach outcome to the result if it's an object (non-enumerable so it
  // doesn't leak into JSON.stringify / structured clones). For primitive
  // returns the outcome is lost — callers that need it should use
  // `withRetryAndOutcome` directly.
  if (result !== null && typeof result === 'object') {
    try {
      Object.defineProperty(result, '_retry', {
        value: outcome,
        enumerable: false,
        writable: false,
        configurable: false,
      })
    } catch {
      // Some object types (frozen, sealed) reject defineProperty —
      // swallow, the outcome is still available via the log.
    }
  }
  return result
}

/**
 * Same as `withRetry` but also returns the `RetryOutcome` so callers
 * can record "this LLM call needed 2 retries" on the tracing span /
 * DecisionLog for audit. The LLM call sites in the API routes use
 * this variant.
 */
export async function withRetryAndOutcome<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<{ result: T; outcome: RetryOutcome }> {
  const merged: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
  const attempts: RetryAttempt[] = []
  let totalDelayMs = 0
  let lastError: unknown

  for (let attempt = 0; attempt <= merged.maxRetries; attempt++) {
    try {
      const result = await fn()
      const outcome: RetryOutcome = {
        retries: attempts.length,
        attempts,
        totalDelayMs,
        recovered: attempts.length > 0,
      }
      if (outcome.recovered) {
        log.info(
          {
            attempts: attempts.length,
            totalDelayMs,
            lastError: lastError instanceof Error ? lastError.message : String(lastError),
          },
          'retry: recovered after retries',
        )
      }
      return { result, outcome }
    } catch (err) {
      lastError = err
      // Non-retryable → rethrow immediately (don't waste a delay).
      if (!isRetryableError(err, merged.retryableErrors)) {
        throw err
      }
      // Last attempt → log + rethrow (the caller's catch handles the fallback).
      if (attempt === merged.maxRetries) {
        log.error(
          {
            err: err instanceof Error ? err.message : String(err),
            attempts: attempts.length,
            totalDelayMs,
          },
          'retry: exhausted — giving up',
        )
        captureError(err instanceof Error ? err : new Error(String(err)), {
          service: 'agent-retry',
          retries: attempts.length,
          totalDelayMs,
        })
        throw err
      }
      // Retryable + we have attempts left → wait + retry.
      const delayMs = computeBackoffDelay(attempt + 1, merged)
      attempts.push({
        attempt: attempt + 1,
        delayMs,
        error: err instanceof Error ? err.message : String(err),
      })
      totalDelayMs += delayMs
      log.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          attempt: attempt + 1,
          delayMs,
          nextMaxRetries: merged.maxRetries,
        },
        'retry: transient error — retrying after backoff',
      )
      await sleep(delayMs)
    }
  }
  // Unreachable — the for loop either returns or throws on every path.
  // The cast keeps TS happy without a `never` assertion that would
  // confuse readers.
  throw lastError
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/** Promise-based sleep — non-blocking. Unref'd timer so it doesn't keep
 *  the Node.js event loop alive in test environments. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    // `unref` only exists on Node.js timers — guard for edge runtimes.
    if (typeof t === 'object' && t !== null && 'unref' in t && typeof t.unref === 'function') {
      t.unref()
    }
  })
}
