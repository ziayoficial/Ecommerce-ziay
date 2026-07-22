import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth-helpers'
import { circuitBreaker } from '@/lib/agents/circuit-breaker'

const CircuitBreakerActionSchema = z.object({
  action: z.enum(['reset', 'resetAll']),
  circuitKey: z.string().min(1).max(200).optional(),
})

// GET /api/agents/circuit-breaker — returns the state of all circuit breakers.
// Admin-only: lets the ops team see which agents are tripped (open circuit)
// and manually reset them when needed.
//
// GAP-FIX-2: the circuit breaker was built (ORC-1-FIX) but had no dashboard.
// This endpoint exposes getAllStates() so the ops team can monitor agent
// health at 2am without SSH-ing into the server.
export async function GET() {
  const { error: authError } = await requireRole(['admin'])
  if (authError) return authError

  const states = circuitBreaker.getAllStates()

  const open = states.filter((s) => s.state === 'open')
  const halfOpen = states.filter((s) => s.state === 'half-open')
  const closed = states.filter((s) => s.state === 'closed')

  return NextResponse.json({
    summary: {
      total: states.length,
      open: open.length,
      halfOpen: halfOpen.length,
      closed: closed.length,
      healthy: open.length === 0,
    },
    circuits: states.map((s) => ({
      key: s.key,
      state: s.state,
      failures: s.failures,
      successes: s.successes,
      lastFailureAt: s.lastFailureAt,
      lastSuccessAt: s.lastSuccessAt,
    })),
    openCircuits: open.map((s) => ({
      key: s.key,
      failures: s.failures,
      lastFailureAt: s.lastFailureAt,
    })),
  })
}

// POST /api/agents/circuit-breaker — manually reset a circuit (admin override).
// Body: { "action": "reset", "circuitKey": "tenant-1:quote" }
// or:   { "action": "resetAll" }
export async function POST(req: Request) {
  const { error: authError } = await requireRole(['admin'])
  if (authError) return authError

  const parsed = CircuitBreakerActionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { action, circuitKey } = parsed.data

  if (action === 'resetAll') {
    circuitBreaker.resetAll()
    return NextResponse.json({ ok: true, message: 'All circuits reset' })
  }

  if (action === 'reset' && circuitKey) {
    circuitBreaker.reset(circuitKey)
    return NextResponse.json({ ok: true, message: `Circuit ${circuitKey} reset` })
  }

  return NextResponse.json(
    { error: 'Invalid action. Use "reset" with circuitKey, or "resetAll".' },
    { status: 400 },
  )
}
