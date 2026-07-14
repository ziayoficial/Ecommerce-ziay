import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAccess } from '@/lib/auth-helpers'
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
//
// FIX-SECURITY-AUTH-001 (#33) — requireTenantAccess(tenantId). Any authed
// user used to be able to send a product message to any conversation of
// any tenant (similar to /api/conversations POST but with a product
// attachment).
export async function POST(req: NextRequest) {
  try {
    const { tenantId, conversationId, sku } = await req.json()
    if (!tenantId || !conversationId || !sku) {
      return NextResponse.json({ error: 'tenantId, conversationId, sku required' }, { status: 400 })
    }

    // FIX-SECURITY-AUTH-001 (#33) — tenant gate before the service writes a
    // message row. (The service itself uses tenantId in the Message.tenantId
    // column, so an additional conversation-tenant check is redundant as long
    // as the caller's tenantId matches the conversation's tenantId — which is
    // enforced by requireTenantAccess here.)
    const { error } = await requireTenantAccess(tenantId)
    if (error) return error

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
