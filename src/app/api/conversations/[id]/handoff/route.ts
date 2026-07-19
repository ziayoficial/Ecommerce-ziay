import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, requireTenantAccess } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { emitToTenant } from '@/lib/chat-emit'

const log = getLogger('api:conversations:handoff')

// Zod validation for the request body
const HandoffSchema = z.object({
  action: z.enum(['pause', 'resume']),
  reason: z.enum(['human_takeover', 'customer_request', 'maintenance', 'manual']).default('manual'),
})

// POST /api/conversations/[id]/handoff
//
// GAP-FIX-1: Human takeover — pause or resume the AI bot for a specific
// conversation. When paused (botEnabled=false), inbound messages from the
// customer are NOT processed by the agent pipeline — they go directly to
// the human agent's inbox. When resumed (botEnabled=true), the AI pipeline
// takes over again.
//
// This is the "pause bot / take control" feature that the conversational
// commerce market expects (Kommo, SleekFlow, Tecca all have it).
//
// Auth: requires 'admin' or 'agent' role + tenant access to the conversation.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params

  // Auth: any authenticated user with agent/admin role can toggle handoff
  const { session, error: authError } = await requireRole(['admin', 'agent'])
  if (authError) return authError

  // GAP-FIX-1: extract the userId from the session so we know WHO paused
  // the bot. Previously this was null with a TODO comment.
  const pausedByUserId = session?.user?.id ?? null

  // Parse + validate body
  const body = await req.json().catch(() => null)
  const parsed = HandoffSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { action, reason } = parsed.data

  // Look up the conversation to get tenantId for access check
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true, botEnabled: true, assigneeId: true },
  })

  if (!conversation) {
    return NextResponse.json(
      { error: 'Conversation not found' },
      { status: 404 },
    )
  }

  // Tenant access check
  const { error: tenantError } = await requireTenantAccess(conversation.tenantId)
  if (tenantError) return tenantError

  // Toggle botEnabled
  const botEnabled = action === 'resume'
  const now = new Date()

  const updated = await db.conversation.update({
    where: { id: conversationId },
    data: {
      botEnabled,
      pausedAt: botEnabled ? null : now,
      pausedBy: botEnabled ? null : pausedByUserId,
      pausedReason: botEnabled ? null : reason,
    },
    select: {
      id: true,
      botEnabled: true,
      pausedAt: true,
      pausedReason: true,
      assigneeId: true,
    },
  })

  // Emit socket event so the dashboard UI updates in real-time
  emitToTenant(conversation.tenantId, 'conversation:handoff', {
    conversationId,
    botEnabled,
    reason,
    timestamp: now.toISOString(),
  })

  log.info(
    {
      conversationId,
      tenantId: conversation.tenantId,
      action,
      reason,
      wasBotEnabled: conversation.botEnabled,
      nowBotEnabled: botEnabled,
    },
    `Bot ${action === 'pause' ? 'paused' : 'resumed'} for conversation`,
  )

  return NextResponse.json({
    ok: true,
    conversationId,
    botEnabled: updated.botEnabled,
    pausedAt: updated.pausedAt,
    pausedReason: updated.pausedReason,
    message:
      action === 'pause'
        ? 'Bot pausado — un agente humano ha tomado el control de esta conversación.'
        : 'Bot reactivado — la IA ha retomado el control de esta conversación.',
  })
}
