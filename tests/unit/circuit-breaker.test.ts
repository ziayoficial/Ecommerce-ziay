// Tests for the circuit breaker module.
// ORC-1-FIX: verifies closed → open → half-open → closed transitions.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CircuitBreakerManager, buildCircuitKey, type CircuitBreakerConfig } from '@/lib/agents/circuit-breaker'

describe('CircuitBreaker', () => {
  let cb: CircuitBreakerManager

  beforeEach(() => {
    cb = new CircuitBreakerManager({
      failureThreshold: 3,
      resetTimeoutMs: 100, // 100ms for fast tests
      halfOpenMaxCalls: 1,
    })
  })

  describe('buildCircuitKey', () => {
    it('builds a key from tenantId + agentName', () => {
      expect(buildCircuitKey('tenant-1', 'quote')).toBe('tenant-1:quote')
      expect(buildCircuitKey('tenant-2', 'profile')).toBe('tenant-2:profile')
    })
  })

  describe('closed state (normal operation)', () => {
    it('allows calls when no failures have occurred', () => {
      expect(cb.canCall('tenant-1:quote')).toBe(true)
    })

    it('records successes without state change', () => {
      cb.recordSuccess('tenant-1:quote')
      cb.recordSuccess('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('closed')
      expect(cb.canCall('tenant-1:quote')).toBe(true)
    })

    it('does not open after failures below threshold', () => {
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('closed')
      expect(cb.canCall('tenant-1:quote')).toBe(true)
    })
  })

  describe('open state (circuit tripped)', () => {
    it('opens after reaching failure threshold', () => {
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('open')
    })

    it('blocks calls when open', () => {
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      expect(cb.canCall('tenant-1:quote')).toBe(false)
    })

    it('is per-tenant per-agent (not global)', () => {
      // Trip the circuit for tenant-1:quote
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('open')

      // tenant-2:quote should still be closed
      expect(cb.getState('tenant-2:quote')).toBe('closed')
      expect(cb.canCall('tenant-2:quote')).toBe(true)

      // tenant-1:profile should still be closed
      expect(cb.getState('tenant-1:profile')).toBe('closed')
      expect(cb.canCall('tenant-1:profile')).toBe(true)
    })
  })

  describe('half-open state (recovery)', () => {
    it('transitions to half-open after reset timeout', async () => {
      // Trip the circuit
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('open')

      // Wait for reset timeout (100ms)
      await new Promise((r) => setTimeout(r, 120))

      // Should transition to half-open and allow one test call
      expect(cb.canCall('tenant-1:quote')).toBe(true)
      expect(cb.getState('tenant-1:quote')).toBe('half-open')
    })

    it('closes on successful half-open call', async () => {
      // Trip the circuit
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')

      await new Promise((r) => setTimeout(r, 120))

      // Allow the test call
      cb.canCall('tenant-1:quote')

      // Record success → should close
      cb.recordSuccess('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('closed')
    })

    it('reopens on failed half-open call', async () => {
      // Trip the circuit
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')

      await new Promise((r) => setTimeout(r, 120))

      // Allow the test call
      cb.canCall('tenant-1:quote')

      // Record failure → should reopen
      cb.recordFailure('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('open')
    })
  })

  describe('reset (admin override)', () => {
    it('reset() clears a specific circuit', () => {
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('open')

      cb.reset('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('closed')
    })

    it('resetAll() clears all circuits', () => {
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-2:profile')
      cb.recordFailure('tenant-2:profile')
      cb.recordFailure('tenant-2:profile')

      cb.resetAll()

      expect(cb.getState('tenant-1:quote')).toBe('closed')
      expect(cb.getState('tenant-2:profile')).toBe('closed')
    })
  })

  describe('getAllStates (dashboard)', () => {
    it('returns all circuits with their states', () => {
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordSuccess('tenant-1:profile')

      const states = cb.getAllStates()
      expect(states).toHaveLength(2)

      const quoteState = states.find((s: { key: string; state: string; failures: number; successes: number }) => s.key === 'tenant-1:quote')
      expect(quoteState?.state).toBe('open')
      expect(quoteState?.failures).toBe(3)

      const profileState = states.find((s: { key: string; state: string; failures: number; successes: number }) => s.key === 'tenant-1:profile')
      expect(profileState?.state).toBe('closed')
      expect(profileState?.successes).toBe(1)
    })
  })

  describe('failure count resets on success', () => {
    it('resets failure count when circuit closes from half-open', async () => {
      // Trip the circuit
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')
      cb.recordFailure('tenant-1:quote')

      await new Promise((r) => setTimeout(r, 120))
      cb.canCall('tenant-1:quote')
      cb.recordSuccess('tenant-1:quote')

      // Should need 3 failures again to trip
      cb.recordFailure('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('closed')
      cb.recordFailure('tenant-1:quote')
      expect(cb.getState('tenant-1:quote')).toBe('closed')
    })
  })
})
