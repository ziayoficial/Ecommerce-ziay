import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { conversationService } from '@/lib/services'

// SPRINT7-POSTGRES-SERVICES-001 — migrated from `db.conversation.findUnique`
// → `conversationService.getConversationById` and `db.conversation.update`
// → `conversationService.updateStatus`. Response shapes are unchanged.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const { id } = await params
    const conv = await conversationService.getConversationById(id)
    if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 })

    return NextResponse.json({ conversation: conv })
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
  const { error } = await requireAuth()
  if (error) return error
  try {
    const { id } = await params
    const body = await req.json()
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
