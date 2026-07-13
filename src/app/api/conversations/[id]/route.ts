import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const { id } = await params
    const conv = await db.conversation.findUnique({
      where: { id },
      include: {
        customer: true,
        channel: true,
        assignee: true,
        messages: { orderBy: { createdAt: 'asc' } },
        orders: { include: { items: true }, orderBy: { createdAt: 'desc' }, take: 5 },
      },
    })
    if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 })

    if (conv.unreadCount > 0) {
      await db.conversation.update({ where: { id }, data: { unreadCount: 0 } })
    }

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
    const updated = await db.conversation.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      },
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
