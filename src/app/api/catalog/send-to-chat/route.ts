import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/catalog/send-to-chat
// Sends a product (with image) to a conversation as an outbound message.
// Bridges the catalog visual experience with the chat.
export async function POST(req: NextRequest) {
  const { tenantId, conversationId, sku } = await req.json()
  if (!tenantId || !conversationId || !sku) {
    return NextResponse.json({ error: 'tenantId, conversationId, sku required' }, { status: 400 })
  }
  const product = await db.product.findUnique({ where: { tenantId_sku: { tenantId, sku } } })
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 })

  const messageBody = `📦 *${product.name}*
SKU: ${product.sku}
Precio: $${product.price.toLocaleString('es-CO')} COP
${product.diseno && product.diseno !== 'liso' ? `Diseno: ${product.diseno}\n` : ''}${product.description || ''}

${product.imageUrl || ''}`

  const msg = await db.message.create({
    data: { tenantId, conversationId, direction: 'outbound', body: messageBody, type: 'order_card', mediaUrl: product.imageUrl, status: 'sent' },
  })
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), unreadCount: 0 } })
  return NextResponse.json({ message: msg, product: { sku: product.sku, name: product.name, imageUrl: product.imageUrl, price: product.price } })
}
