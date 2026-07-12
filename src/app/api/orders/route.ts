import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'

export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const status = req.nextUrl.searchParams.get('status') || undefined
  const mode = req.nextUrl.searchParams.get('mode') || undefined
  const q = req.nextUrl.searchParams.get('q') || undefined
  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined

  const orders = await db.order.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      ...(status && status !== 'all' ? { status } : {}),
      ...(mode && mode !== 'all' ? { paymentMode: mode } : {}),
      ...(q ? { number: { contains: q } } : {}),
    },
    include: { customer: true, items: true, sourceAd: { include: { campaign: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    orders: orders.map(o => ({
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
  })
}
