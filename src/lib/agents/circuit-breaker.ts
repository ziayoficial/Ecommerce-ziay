// ZIAY — Circuit Breaker for agent LLM calls.
//
// ORC-1 fix (honest evaluation weakness #3): there was retry + fallback per
// request, but no circuit breaker. If an agent fails N times consecutively,
// the orchestrator kept trying forever (wasting resources).
//
// This circuit breaker tracks failures per (tenantId + agentName) circuit:
//   - CLOSED:   normal operation, calls pass through
//   - OPEN:     after `failureThreshold` consecutive failures, calls are
//               rejected immediately (fallback is used instead)
//   - HALF-OPEN: after `resetTimeoutMs`, one test call is allowed; if it
//               succeeds → CLOSED, if it fails → OPEN again
//
// The circuit key is `${tenantId}:${agentName}` so a broken agent for one
// tenant doesn't block other tenants.

import { getLogger } from '@/lib/logger'

const log = getLogger('agents:circuit-breaker')

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerConfig {
  /** Open after N consecutive failures (default 5) */
  failureThreshold: number
  /** Try again after this many ms (default 60_000 = 1 min) */
  resetTimeoutMs: number
  /** In half-open, allow N test calls (default 1) */
  halfOpenMaxCalls: number
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxCalls: 1,
}

interface CircuitEntry {
  state: CircuitState
  failures: number
  successes: number
  openedAt: number // Date.now() when transitioned to open
  halfOpenCalls: number
  lastFailureAt?: number
  lastSuccessAt?: number
}

export class CircuitBreakerManager {
  private circuits = new Map<string, CircuitEntry>()
  private config: CircuitBreakerConfig

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config }
  }

  private getOrCreate(key: string): CircuitEntry {
    let entry = this.circuits.get(key)
    if (!entry) {
      entry = {
        state: 'closed',
        failures: 0,
        successes: 0,
        openedAt: 0,
        halfOpenCalls: 0,
      }
      this.circuits.set(key, entry)
    }
    return entry
  }

  /**
   * Check if a call is allowed for the given circuit key.
   * Returns true if the call should proceed, false if the circuit is open.
   */
  canCall(circuitKey: string): boolean {
    const entry = this.getOrCreate(circuitKey)

    if (entry.state === 'closed') {
      return true
    }

    if (entry.state === 'open') {
      // Check if enough time has passed to transition to half-open
      const elapsed = Date.now() - entry.openedAt
      if (elapsed >= this.config.resetTimeoutMs) {
        entry.state = 'half-open'
        entry.halfOpenCalls = 0
        log.info(
          { circuitKey, elapsedMs: elapsed },
          'Circuit breaker transitioning OPEN → HALF-OPEN (reset timeout elapsed)',
        )
        // Allow the test call
        return entry.halfOpenCalls < this.config.halfOpenMaxCalls
      }
      // Still open — reject
      return false
    }

    // half-open: allow limited test calls
    if (entry.halfOpenCalls < this.config.halfOpenMaxCalls) {
      return true
    }
    return false
  }

  /**
   * Record a successful call. Closes the circuit if it was half-open.
   */
  recordSuccess(circuitKey: string): void {
    const entry = this.getOrCreate(circuitKey)
    entry.successes++
    entry.lastSuccessAt = Date.now()

    if (entry.state === 'half-open') {
      entry.state = 'closed'
      entry.failures = 0
      log.info(
        { circuitKey, successes: entry.successes },
        'Circuit breaker HALF-OPEN → CLOSED (test call succeeded)',
      )
    }
  }

  /**
   * Record a failed call. Opens the circuit if failures exceed threshold.
   */
  recordFailure(circuitKey: string): void {
    const entry = this.getOrCreate(circuitKey)
    entry.failures++
    entry.lastFailureAt = Date.now()

    if (entry.state === 'half-open') {
      // Test call failed — reopen
      entry.state = 'open'
      entry.openedAt = Date.now()
      entry.halfOpenCalls = 0
      log.warn(
        { circuitKey, failures: entry.failures },
        'Circuit breaker HALF-OPEN → OPEN (test call failed)',
      )
      return
    }

    if (entry.state === 'closed' && entry.failures >= this.config.failureThreshold) {
      entry.state = 'open'
      entry.openedAt = Date.now()
      log.error(
        { circuitKey, failures: entry.failures, threshold: this.config.failureThreshold },
        'Circuit breaker CLOSED → OPEN (failure threshold exceeded)',
      )
    }
  }

  /**
   * Get the current state of a circuit (for monitoring/dashboard).
   */
  getState(circuitKey: string): CircuitState {
    return this.getOrCreate(circuitKey).state
  }

  /**
   * Get all circuit states (for the dashboard / /api/agents/traces endpoint).
   */
  getAllStates(): Array<{
    key: string
    state: CircuitState
    failures: number
    successes: number
    lastFailureAt?: number
    lastSuccessAt?: number
  }> {
    return Array.from(this.circuits.entries()).map(([key, entry]) => ({
      key,
      state: entry.state,
      failures: entry.failures,
      successes: entry.successes,
      lastFailureAt: entry.lastFailureAt,
      lastSuccessAt: entry.lastSuccessAt,
    }))
  }

  /**
   * Reset a specific circuit (admin manual override).
   */
  reset(circuitKey: string): void {
    this.circuits.delete(circuitKey)
    log.info({ circuitKey }, 'Circuit breaker manually reset')
  }

  /**
   * Reset all circuits (admin manual override — use with caution).
   */
  resetAll(): void {
    const count = this.circuits.size
    this.circuits.clear()
    log.info({ count }, 'All circuit breakers manually reset')
  }
}

// Singleton instance — shared across all agent calls in the process
export const circuitBreaker = new CircuitBreakerManager()

/**
 * Build a circuit key from tenant + agent.
 * The key is per-tenant per-agent so a broken agent for one tenant doesn't
 * block other tenants.
 */
export function buildCircuitKey(tenantId: string, agentName: string): string {
  return `${tenantId}:${agentName}`
}
