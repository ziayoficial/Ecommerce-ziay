import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { withCache } from '@/lib/cache'
import { AGENT_NAMES, AGENT_LABELS } from '@/lib/agents/prompts'

// GET /api/agents — list all available agents.
// Cached for 1 hour — the agent registry is a static compile-time constant
// (AGENT_NAMES / AGENT_LABELS) so the only thing that ever invalidates this
// cache is a server restart.
export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  const payload = await withCache(
    'agents:list',
    60 * 60_000,
    () => Promise.resolve({
      agents: AGENT_NAMES.map(name => ({ name, label: AGENT_LABELS[name] })),
      count: AGENT_NAMES.length,
    }),
  )
  return NextResponse.json(payload)
}
