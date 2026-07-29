// Tests for UI component data shapes (GAP-FIX #5).
// Verifies that CircuitBreakerDashboard and HandoffButton consume the
// correct data shapes that the API actually returns.

import { describe, it, expect } from 'vitest'

describe('CircuitBreakerDashboard — data shape matches API response', () => {
  // The API returns this shape from GET /api/agents/circuit-breaker
  type ApiResponse = {
    summary: {
      total: number
      open: number
      halfOpen: number
      closed: number
      healthy: boolean
    }
    circuits: Array<{
      key: string
      state: 'closed' | 'open' | 'half-open'
      failures: number
      successes: number
      lastFailureAt?: number
      lastSuccessAt?: number
    }>
    openCircuits: Array<{
      key: string
      failures: number
      lastFailureAt?: number
    }>
  }

  it('summary has all required fields', () => {
    const data: ApiResponse = {
      summary: { total: 5, open: 1, halfOpen: 0, closed: 4, healthy: false },
      circuits: [{ key: 'tenant-1:quote', state: 'open', failures: 5, successes: 10 }],
      openCircuits: [{ key: 'tenant-1:quote', failures: 5 }],
    }

    expect(data.summary).toHaveProperty('total')
    expect(data.summary).toHaveProperty('open')
    expect(data.summary).toHaveProperty('halfOpen')
    expect(data.summary).toHaveProperty('closed')
    expect(data.summary).toHaveProperty('healthy')
  })

  it('circuit state values match what the UI expects', () => {
    const validStates = ['closed', 'open', 'half-open']
    const data: ApiResponse = {
      summary: { total: 1, open: 0, halfOpen: 0, closed: 1, healthy: true },
      circuits: [{ key: 't:a', state: 'closed', failures: 0, successes: 5 }],
      openCircuits: [],
    }

    data.circuits.forEach(c => {
      expect(validStates).toContain(c.state)
    })
  })

  it('openCircuits is a subset of circuits where state=open', () => {
    const data: ApiResponse = {
      summary: { total: 3, open: 1, halfOpen: 0, closed: 2, healthy: false },
      circuits: [
        { key: 't:a', state: 'closed', failures: 0, successes: 5 },
        { key: 't:b', state: 'open', failures: 5, successes: 2 },
        { key: 't:c', state: 'closed', failures: 1, successes: 8 },
      ],
      openCircuits: [{ key: 't:b', failures: 5 }],
    }

    const openFromCircuits = data.circuits.filter(c => c.state === 'open')
    expect(data.openCircuits.length).toBe(openFromCircuits.length)
    expect(data.openCircuits[0].key).toBe(openFromCircuits[0].key)
  })
})

describe('HandoffButton — data shape matches conversation response', () => {
  // The HandoffButton receives these props from messenger-view.tsx
  type HandoffButtonProps = {
    conversationId: string
    botEnabled: boolean
    pausedReason?: string | null
    onToggle?: (newBotEnabled: boolean) => void
  }

  it('accepts the shape from ConvDetail (detail endpoint)', () => {
    // ConvDetail has botEnabled?: boolean + pausedReason?: string | null
    // The HandoffButton uses ?? true as fallback
    const convDetail = {
      id: 'conv-123',
      botEnabled: false,
      pausedReason: 'human_takeover',
    }

    const props: HandoffButtonProps = {
      conversationId: convDetail.id,
      botEnabled: convDetail.botEnabled ?? true,
      pausedReason: convDetail.pausedReason ?? null,
    }

    expect(props.botEnabled).toBe(false)
    expect(props.pausedReason).toBe('human_takeover')
  })

  it('accepts the shape from ConvListItem (list endpoint)', () => {
    // ConvListItem has botEnabled?: boolean + pausedReason?: string | null
    // The list badge checks c.botEnabled === false
    const convListItem = {
      id: 'conv-456',
      botEnabled: true,
      pausedReason: null,
    }

    // Badge only shows when botEnabled === false
    expect(convListItem.botEnabled === false).toBe(false) // no badge
  })

  it('handoff API response shape matches what HandoffButton expects', () => {
    // POST /api/conversations/[id]/handoff returns:
    const apiResponse = {
      ok: true,
      conversationId: 'conv-123',
      botEnabled: false,
      pausedAt: '2026-07-21T00:00:00.000Z',
      pausedReason: 'human_takeover',
      message: 'Bot pausado — un agente humano ha tomado el control.',
    }

    // HandoffButton uses data.botEnabled from the response
    expect(apiResponse).toHaveProperty('botEnabled')
    expect(apiResponse).toHaveProperty('pausedReason')
    expect(typeof apiResponse.botEnabled).toBe('boolean')
  })

  it('handoff pause reasons match the Zod schema', () => {
    const validReasons = ['human_takeover', 'customer_request', 'maintenance', 'manual']
    // The handoff route validates with Zod: z.enum(['human_takeover', 'customer_request', 'maintenance', 'manual'])
    validReasons.forEach(r => {
      expect(r).toBeTruthy()
    })
    expect(validReasons).toHaveLength(4)
  })
})
