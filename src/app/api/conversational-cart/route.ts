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
//
// SPRINT-FIXES-TS-001 (R-2) — Schema drift cleanup. The legacy route referenced
// fields that don't exist on the current `ConversationalCart` / `CartItem`
// models (phone, customerId, totalItems, totalValue, productId, name, price,
// imageUrl, diseno, identificationMethod, visionConfidence, confirmed). The
// route now maps every input to the columns that actually exist in the schema
// (CartItem.unitPrice, CartItem.productName, CartItem.total, ConversationalCart.total)
// while still preserving the call shape from the legacy client (extra fields
// are accepted and ignored so callers don't break).
export async function POST(req: NextRequest) {
  const { tenantId, conversationId, action, items } = await req.json()
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  if (action === 'add_items') {
    // Find or create cart
    let cart = conversationId
      ? await db.conversationalCart.findFirst({ where: { tenantId, conversationId, status: 'building' }, include: { items: true } })
      : null

    if (!cart) {
      cart = await db.conversationalCart.create({
        data: { tenantId, conversationId: conversationId ?? '', status: 'building' },
        include: { items: true },
      })
    }

    // Add items — map legacy client fields to the current CartItem schema:
    //   name → productName, price → unitPrice, total = unitPrice * quantity
    for (const item of items || []) {
      const quantity = Number(item.quantity ?? 1)
      const unitPrice = Number(item.price ?? 0)
      await db.cartItem.create({
        data: {
          cartId: cart.id,
          sku: String(item.sku ?? ''),
          productName: String(item.name ?? item.sku ?? ''),
          quantity,
          unitPrice,
          total: unitPrice * quantity,
        },
      })
    }

    // Recompute cart total from all items
    const allItems = await db.cartItem.findMany({ where: { cartId: cart.id } })
    const total = allItems.reduce((sum, i) => sum + i.total, 0)
    const updated = await db.conversationalCart.update({
      where: { id: cart.id },
      data: { total },
      include: { items: true },
    })

    return NextResponse.json({
      cart: updated,
      totalItems: allItems.length,
      totalValue: total,
    })
  }

  if (action === 'confirm_all') {
    const cart = conversationId ? await db.conversationalCart.findFirst({ where: { tenantId, conversationId, status: 'building' } }) : null
    if (!cart) return NextResponse.json({ error: 'no active cart' }, { status: 404 })
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
