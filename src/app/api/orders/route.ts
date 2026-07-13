import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { orderService } from '@/lib/services'

// GET /api/orders?tenantId=X&status=Y&mode=Z&q=...&cursor=ID&limit=N
//
// Cursor-based pagination (SPRINT6-SCALE-001). The `cursor` is the `id` of
// the last order on the previous page. Default page size is 20, max 100.
//
// Backward compatible: when no `cursor` is given the first page is returned.
// The response still includes the `orders` array — existing callers that
// don't read `nextCursor` / `hasMore` keep working (they just see the first
// page).
//
// SPRINT7-POSTGRES-SERVICES-001 — migrated from `db.order.findMany(...)` to
// `orderService.getOrders(...)`. Response shape is unchanged; only the
// internal DB access seam moved into the service layer.
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const status = req.nextUrl.searchParams.get('status') || undefined
    const mode = req.nextUrl.searchParams.get('mode') || undefined
    const q = req.nextUrl.searchParams.get('q') || undefined
    const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined
    const cursor = req.nextUrl.searchParams.get('cursor') || undefined
    // Default page size 20, hard ceiling 100 to prevent unbounded queries.
    const parsedLimit = parseInt(req.nextUrl.searchParams.get('limit') || '20', 10)
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20

    // The service takes `limit + 1` so we can detect a next page.
    const result = await orderService.getOrders(tenantId, {
      status,
      mode,
      q,
      cursor,
      limit,
    })

    const hasNext = result.length > limit
    const items = hasNext ? result.slice(0, limit) : result
    const nextCursor = hasNext ? items[items.length - 1].id : null

    return NextResponse.json({
      orders: items.map(o => ({
        id: o.id,
        number: o.number,
        status: o.status,
        paymentMode: o.paymentMode,
        paymentStatus: o.paymentStatus,
        subtotal: o.subtotal,
        discount: o.discount,
        codFee: o.codFee,
        total: o.total,
        currency: o.currency,
        country: o.country,
        city: o.city,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        sourceAd: o.sourceAd ? { id: o.sourceAd.id, name: o.sourceAd.name, externalId: o.sourceAd.externalId } : null,
        sourceCampaign: o.sourceCampaign,
        sourcePlatform: o.sourcePlatform,
        customer: { id: o.customer.id, name: o.customer.name, phone: o.customer.phone, country: o.customer.country },
        items: o.items.map(it => ({ name: it.name, quantity: it.quantity, unitPrice: it.unitPrice })),
      })),
      nextCursor,
      hasMore: hasNext,
    })
  } catch (err) {
    captureError(err as Error, { path: '/api/orders', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
