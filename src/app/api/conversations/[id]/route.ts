import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'
import { conversationService } from '@/lib/services'

// TD-2: Zod schema for conversation PATCH.
const ConversationPatchSchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
}).passthrough()

// SPRINT7-POSTGRES-SERVICES-001 — migrated from `db.conversation.findUnique`
// → `conversationService.getConversationById` and `db.conversation.update`
// → `conversationService.updateStatus`. Response shapes are unchanged.
//
// FIX-SECURITY-AUTH-001 (#7) — fetch the conversation first, verify the
// caller's tenantId matches (or caller is a platform admin with no
// tenantId) before returning/updating. Mirrors `/api/novedades/[id]`
// `getCaseOrFail()`.

async function getConversationOrFail(id: string) {
  const { session, error } = await requireAuth()
  if (error) return { session: null, error, conv: null }

  // Fetch by id only (no tenant filter) so we can return 403 (rather than
  // 404) when a cross-tenant caller reaches for a row that does exist.
  // `conversationService.getConversationById` clears the unread badge as
  // a side-effect, so we use a direct db.conversation.findUnique here to
  // avoid that side-effect firing before the tenant guard.
  const conv = await db.conversation.findUnique({
    where: { id },
    select: { id: true, tenantId: true },
  })
  if (!conv) {
    return {
      session,
      error: NextResponse.json({ error: 'not found' }, { status: 404 }),
      conv: null,
    }
  }
  const userTenantId = session?.user?.tenantId ?? null
  if (userTenantId && userTenantId !== conv.tenantId) {
    return {
      session,
      error: NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 }),
      conv: null,
    }
  }
  return { session, error: null, conv }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { error, conv } = await getConversationOrFail(id)
  if (error) return error
  if (!conv) return NextResponse.json({ error: 'No conversation' }, { status: 404 })

  try {
    // Now safe to call the service method (which clears unread as side-effect).
    const fullConv = await conversationService.getConversationById(id)
    if (!fullConv) return NextResponse.json({ error: 'not found' }, { status: 404 })

    return NextResponse.json({ conversation: fullConv })
  } catch (err) {
    captureError(err as Error, { path: '/api/conversations/[id]', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { error, conv } = await getConversationOrFail(id)
  if (error) return error
  if (!conv) return NextResponse.json({ error: 'No conversation' }, { status: 404 })

  try {
    const raw = await req.json()
    const parseResult = ConversationPatchSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const body = parseResult.data as {
      status?: string
      priority?: string
      assigneeId?: string | null
    }
    const updated = await conversationService.updateStatus(id, {
      ...(body.status ? { status: body.status } : {}),
      ...(body.priority ? { priority: body.priority } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
    })
    return NextResponse.json({ conversation: updated })
  } catch (err) {
    captureError(err as Error, { path: '/api/conversations/[id]', method: 'PATCH' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
