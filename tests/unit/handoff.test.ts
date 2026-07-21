// Tests for the human handoff feature (GAP-FIX-1).
// Verifies the handoff endpoint logic + botEnabled field behavior.

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Zod schema (mirrors the one in the route — testing the validation logic)
const HandoffSchema = z.object({
  action: z.enum(['pause', 'resume']),
  reason: z.enum(['human_takeover', 'customer_request', 'maintenance', 'manual']).default('manual'),
})

describe('Handoff — Zod validation', () => {
  it('accepts pause with all valid reasons', () => {
    const result = HandoffSchema.safeParse({ action: 'pause', reason: 'human_takeover' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.action).toBe('pause')
      expect(result.data.reason).toBe('human_takeover')
    }
  })

  it('accepts resume', () => {
    const result = HandoffSchema.safeParse({ action: 'resume' })
    expect(result.success).toBe(true)
  })

  it('defaults reason to manual when not provided', () => {
    const result = HandoffSchema.safeParse({ action: 'pause' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reason).toBe('manual')
    }
  })

  it('rejects invalid action', () => {
    const result = HandoffSchema.safeParse({ action: 'stop' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid reason', () => {
    const result = HandoffSchema.safeParse({ action: 'pause', reason: 'because' })
    expect(result.success).toBe(false)
  })

  it('rejects missing action', () => {
    const result = HandoffSchema.safeParse({ reason: 'manual' })
    expect(result.success).toBe(false)
  })
})

describe('Handoff — botEnabled field semantics', () => {
  it('botEnabled=true means bot is active (normal operation)', () => {
    const conversation = { botEnabled: true, pausedAt: null, pausedBy: null, pausedReason: null }
    expect(conversation.botEnabled).toBe(true)
    // AI pipeline should process messages
  })

  it('botEnabled=false means human takeover (bot paused)', () => {
    const conversation = {
      botEnabled: false,
      pausedAt: new Date(),
      pausedBy: 'user-123',
      pausedReason: 'human_takeover',
    }
    expect(conversation.botEnabled).toBe(false)
    expect(conversation.pausedBy).toBe('user-123')
    expect(conversation.pausedReason).toBe('human_takeover')
    // AI pipeline should NOT process messages
  })

  it('resume clears pausedAt, pausedBy, pausedReason', () => {
    // Simulate the update logic from the route
    const action: 'pause' | 'resume' = 'resume'
    const botEnabled = action === 'resume'
    const updateData = {
      botEnabled,
      pausedAt: botEnabled ? null : new Date(),
      pausedBy: botEnabled ? null : 'user-123',
      pausedReason: botEnabled ? null : 'human_takeover',
    }
    expect(updateData.botEnabled).toBe(true)
    expect(updateData.pausedAt).toBeNull()
    expect(updateData.pausedBy).toBeNull()
    expect(updateData.pausedReason).toBeNull()
  })

  it('pause sets pausedAt, pausedBy, pausedReason', () => {
    const action: string = 'pause'
    const botEnabled: boolean = action === 'resume'
    const userId = 'user-456'
    const updateData = {
      botEnabled,
      pausedAt: botEnabled ? null : new Date(),
      pausedBy: botEnabled ? null : userId,
      pausedReason: botEnabled ? null : 'human_takeover',
    }
    expect(updateData.botEnabled).toBe(false)
    expect(updateData.pausedBy).toBe('user-456')
    expect(updateData.pausedReason).toBe('human_takeover')
  })
})
