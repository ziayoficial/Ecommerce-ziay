import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// GET /api/ucp/v1/order/[orderId]
// Devuelve el estado del pedido en formato UCP (para que el agente consulte
// fulfillment). Documento §10.1: "Order" capability.
export const GET = withErrorHandling(async (_req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },) => {

  const { orderId } = await params
  const { error } = await requireAuth()
  if (error) return error

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        events: { orderBy: { createdAt: 'desc' }, take: 20 },
        shipments: true,
      },
    })
    if (!order) {
      return NextResponse.json(
        { error: 'Pedido no encontrado' },
        { status: 404 },
      )
    }

    // Tenant guard.
    const { session, error: tErr } = await requireAuth()
    if (tErr) return tErr
    const userTenantId = session?.user?.tenantId ?? null
    if (userTenantId && userTenantId !== order.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    // Mapa operacional → estados UCP (simplificado):
    //   new | pending_payment | preparing | shipped | delivered | returned | cancelled
    const ucpStatus = mapToUcpStatus(order.status, order.paymentStatus)

    return NextResponse.json({
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMode: order.paymentMode,
        ucpFulfillmentStatus: ucpStatus,
        total: order.total,
        currency: order.currency,
        country: order.country,
        city: order.city,
        address: order.address,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        paidAt: order.paidAt,
        items: order.items.map(it => ({
          sku: it.productId, // productId is the local FK; SKU lives on Product
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        })),
        events: order.events.map(e => ({
          type: e.type,
          note: e.note,
          createdAt: e.createdAt,
        })),
        shipments: order.shipments.map(s => ({
          id: s.id,
          proveedor: s.proveedor,
          trackingNumber: s.numeroGuia,
          trackingUrl: s.urlSeguimiento,
          carrier: s.transportadoraCanonica,
          status: s.estado,
        })),
      },
    })
  

})

function mapToUcpStatus(orderStatus: string, paymentStatus: string): string {
  if (orderStatus === 'cancelled') return 'cancelled'
  if (orderStatus === 'returned') return 'returned'
  if (orderStatus === 'delivered') return 'delivered'
  if (orderStatus === 'shipped') return 'shipped'
  if (orderStatus === 'preparing') return 'preparing'
  if (paymentStatus === 'unpaid' || orderStatus === 'pending_payment') {
    return 'pending_payment'
  }
  return 'created'
}
