import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { catalogService } from '@/lib/services'

// POST /api/catalog/send-to-chat
// Sends a product (with image) to a conversation as an outbound message.
// Bridges the catalog visual experience with the chat.
//
// SPRINT8-SERVICES-REST-001 — migrated the product lookup + message create
// + conversation update (3 db calls) to `catalogService.sendToChat`. The
// service returns `{ message, product }` or null when the SKU isn't found;
// the route maps that to a 404. Response shape unchanged.
export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const { tenantId, conversationId, sku } = await req.json()
    if (!tenantId || !conversationId || !sku) {
      return NextResponse.json({ error: 'tenantId, conversationId, sku required' }, { status: 400 })
    }
    const result = await catalogService.sendToChat(tenantId, conversationId, sku)
    if (!result) return NextResponse.json({ error: 'product not found' }, { status: 404 })

    const { message, product } = result
    return NextResponse.json({
      message,
      product: { sku: product.sku, name: product.name, imageUrl: product.imageUrl, price: product.price },
    })
  } catch (err) {
    captureError(err as Error, { path: '/api/catalog/send-to-chat', method: 'POST' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
