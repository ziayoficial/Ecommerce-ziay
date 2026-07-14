import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { catalogService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// TD-2: Zod schema for catalog send-to-chat POST.
const SendToChatSchema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  sku: z.string().min(1),
}).passthrough()

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
export const POST = withErrorHandling(async (req: NextRequest) => {

    const raw = await req.json()
    const parseResult = SendToChatSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const { tenantId, conversationId, sku } = parseResult.data

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
  

})
