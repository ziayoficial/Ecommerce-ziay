import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { AGENT_NAMES, AGENT_LABELS } from '@/lib/agents/prompts'

// GET /api/agents — list all available agents
export async function GET() {
  const { error } = await requireAuth()
  if (error) return error
  return NextResponse.json({
    agents: AGENT_NAMES.map(name => ({ name, label: AGENT_LABELS[name] })),
    count: AGENT_NAMES.length,
  })
}
