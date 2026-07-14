import { NextRequest, NextResponse } from 'next/server'
import { captureError } from '@/lib/capture-error'
import { db } from '@/lib/db'
import { verifyAcpBearer } from '@/lib/acp/bearer'

// GET /api/acp/v1/orders/[id]
// Devuelve el estado del pedido en formato ACP (ChatGPT / Copilot).
// Documento §9.1: capability `order_status`.
//
// Auth: Bearer = `{mandateId}.{ed25519(mandateId)}` firmado por el tenant.
// V4 (AUDIT-FINAL-SEC-001): el bearer ya NO es el mandate ID en crudo —
// verifyAcpBearer valida la firma ed25519 + estado active + vigencia.
// El mandate vincula el tenant; solo se permiten órdenes del mismo tenant.

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  return m ? m[1].trim() : null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params

  const token = extractBearerToken(req)
  if (!token) {
    return NextResponse.json(
      { error: 'Authorization Bearer requerido', code: 'missing_auth_token' },
      { status: 401 },
    )
  }

  try {
    // Validar el bearer firmado + cargar el mandate.
    const bearer = await verifyAcpBearer(token)
    if (!bearer) {
      return NextResponse.json(
        {
          error: 'Token de autorización inválido o expirado',
          code: 'invalid_auth_token',
        },
        { status: 401 },
      )
    }
    const mandate = await db.aP2Mandate.findUnique({
      where: { id: bearer.mandateId },
    })
    if (!mandate || mandate.status !== 'active') {
      return NextResponse.json(
        {
          error: 'Token de autorización inválido o expirado',
          code: 'invalid_auth_token',
        },
        { status: 401 },
      )
    }
    if (mandate.expiresAt && mandate.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'El mandato de intención ha expirado', code: 'mandate_expired' },
        { status: 401 },
      )
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        shipments: true,
      },
    })
    if (!order) {
      return NextResponse.json(
        { error: 'Pedido no encontrado', code: 'order_not_found' },
        { status: 404 },
      )
    }
    if (order.tenantId !== mandate.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch', code: 'tenant_mismatch' },
        { status: 403 },
      )
    }

    // ACP status mapping (simplificado al subconjunto ACP).
    const acpStatus = mapToAcpStatus(order.status, order.paymentStatus)

    const totals = {
      subtotal: order.subtotal,
      discount: order.discount,
      shipping: order.shipping,
      cod_fee: order.codFee,
      total: order.total,
      currency: order.currency,
    }

    // tracking_url: primera shipment con URL de seguimiento (si existe).
    const trackingUrl =
      order.shipments.find(s => s.urlSeguimiento)?.urlSeguimiento ?? null

    return NextResponse.json({
      id: order.id,
      number: order.number,
      status: acpStatus,
      raw_status: order.status,
      payment_status: order.paymentStatus,
      payment_mode: order.paymentMode,
      totals,
      items: order.items.map(it => ({
        sku: it.productId,
        name: it.name,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        line_total: it.unitPrice * it.quantity,
      })),
      shipping: {
        country: order.country,
        city: order.city,
        address: order.address,
      },
      tracking_url: trackingUrl,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
      paid_at: order.paidAt,
    })
  } catch (err) {
    captureError(err as Error, {
      path: '/api/acp/v1/orders/[id]',
      method: 'GET',
    })
    return NextResponse.json(
      { error: 'No se pudo obtener el pedido' },
      { status: 500 },
    )
  }
}

function mapToAcpStatus(orderStatus: string, paymentStatus: string): string {
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
