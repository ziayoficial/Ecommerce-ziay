import { NextRequest, NextResponse } from 'next/server'
import { resolveTenantId } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
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
//
// FIX-SECURITY-AUTH-001 (#9) — tenantId is resolved + verified against the
// caller's session. Tenant users are pinned to their own tenantId
// (cross-tenant attempts return 403); platform admins can pass any
// tenantId or omit it for the legacy "all tenants" view.
//
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapped with `withErrorHandling` so any
// unhandled exception is funneled through Sentry + the structured pino
// logger. The previous manual `try/catch` boilerplate (captureError +
// NextResponse.json 500) is now the wrapper's responsibility.
/**
 * GET /api/orders
 *
 * List orders with cursor-based pagination. Filter by status/mode/search.
 *
 * @security Requires authentication + tenant access (resolveTenantId)
 * @returns Paginated orders + nextCursor + hasMore
 */
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantIdParam = req.nextUrl.searchParams.get('tenantId') || undefined
  const { error, tenantId } = await resolveTenantId(tenantIdParam)
  if (error) return error

  const status = req.nextUrl.searchParams.get('status') || undefined
  const mode = req.nextUrl.searchParams.get('mode') || undefined
  const q = req.nextUrl.searchParams.get('q') || undefined
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
})
