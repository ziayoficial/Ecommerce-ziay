import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/conversational-cart?tenantId=...&conversationId=...
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const conversationId = req.nextUrl.searchParams.get('conversationId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const cart = conversationId
    ? await db.conversationalCart.findFirst({ where: { tenantId, conversationId, status: 'building' }, include: { items: true } })
    : await db.conversationalCart.findFirst({ where: { tenantId, status: 'building' }, include: { items: true }, orderBy: { updatedAt: 'desc' } })

  return NextResponse.json({ cart })
}

// POST /api/conversational-cart — add items to cart
export async function POST(req: NextRequest) {
  const { tenantId, conversationId, phone, customerId, action, items } = await req.json()
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  if (action === 'add_items') {
    // Find or create cart
    let cart = conversationId
      ? await db.conversationalCart.findFirst({ where: { tenantId, conversationId, status: 'building' }, include: { items: true } })
      : null

    if (!cart) {
      cart = await db.conversationalCart.create({ data: { tenantId, conversationId, phone: phone || '', customerId, status: 'building' }, include: { items: true } })
    }

    // Add items
    for (const item of items || []) {
      await db.cartItem.create({ data: { cartId: cart.id, productId: item.productId, sku: item.sku, name: item.name, price: item.price, quantity: item.quantity || 1, imageUrl: item.imageUrl, diseno: item.diseno, identificationMethod: item.identificationMethod || 'agent_suggestion', visionConfidence: item.visionConfidence, confirmed: item.confirmed || false } })
    }

    // Update totals
    const allItems = await db.cartItem.findMany({ where: { cartId: cart.id } })
    await db.conversationalCart.update({ where: { id: cart.id }, data: { totalItems: allItems.length, totalValue: allItems.reduce((s, i) => s + i.price * i.quantity, 0) } })

    return NextResponse.json({ cart: { ...cart, items: allItems, totalItems: allItems.length, totalValue: allItems.reduce((s, i) => s + i.price * i.quantity, 0) } })
  }

  if (action === 'confirm_all') {
    const cart = conversationId ? await db.conversationalCart.findFirst({ where: { tenantId, conversationId, status: 'building' } }) : null
    if (!cart) return NextResponse.json({ error: 'no active cart' }, { status: 404 })
    await db.cartItem.updateMany({ where: { cartId: cart.id }, data: { confirmed: true } })
    await db.conversationalCart.update({ where: { id: cart.id }, data: { status: 'confirmed' } })
    return NextResponse.json({ ok: true, cartId: cart.id })
  }

  if (action === 'convert_to_order') {
    const cart = await db.conversationalCart.findUnique({ where: { id: items?.cartId }, include: { items: true } })
    if (!cart) return NextResponse.json({ error: 'cart not found' }, { status: 404 })
    await db.conversationalCart.update({ where: { id: cart.id }, data: { status: 'converted_to_order' } })
    // The actual order creation is handled by the checkout agent (6.10)
    return NextResponse.json({ ok: true, cart, message: 'Cart ready for checkout agent' })
  }

  return NextResponse.json({ error: 'action must be add_items, confirm_all, or convert_to_order' }, { status: 400 })
}
