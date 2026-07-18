// Fix BUG 1: Re-crea conversaciones y mensajes de Saramantha que fueron borrados
// por load-real-orders.ts. Genera embeddings para cada mensaje.
// Run: bun run scripts/fix-saramantha-messages.ts

import { db } from '../src/lib/db'
import { embed } from '../src/lib/embeddings/service'

const TENANT_ID = 'ten-saramantha'

async function main() {
  console.log('Fix BUG 1: Re-creando conversaciones y mensajes de Saramantha...')

  // Get WA channel
  const channel = await db.channel.findFirst({ where: { tenantId: TENANT_ID, type: 'whatsapp' } })
  if (!channel) { console.error('No WhatsApp channel found'); return }

  // Get 4 customers to create conversations
  const customers = await db.customer.findMany({ where: { tenantId: TENANT_ID }, take: 4 })
  if (customers.length === 0) { console.error('No customers found'); return }

  // Get an ad for attribution
  const ad = await db.ad.findFirst({ where: { campaign: { tenantId: TENANT_ID } }, include: { campaign: true } })

  const conversations = [
    {
      customer: customers[0],
      status: 'open', priority: 'high', perfil: 'mayorista',
      msgs: [
        { dir: 'inbound', body: 'Hola! Vi el anuncio de pijama familia. Para surtir mi tienda.', t: 12 },
        { dir: 'outbound', body: '¡Hola! Sara de Saramantha. Para surtir tienda tienes precio mayorista desde 6 und. ¿Qué tema buscas?', t: 11 },
        { dir: 'inbound', body: 'Stitch, lo tienes?', t: 10 },
        { dir: 'outbound', body: 'Sí, Short, Pantalón y Batola en Stitch. ¿Cuántas de cada uno?', t: 9 },
        { dir: 'inbound', body: '6 short + 6 pantalón', t: 8 },
        { dir: 'outbound', body: '6 Short + 6 Pantalón: pagas $198.000 → vendes $468.000 → margen $270.000. ¿Confirmas ciudad y dirección?', t: 7 },
      ]
    },
    {
      customer: customers[1],
      status: 'pending', priority: 'normal', perfil: 'emprendedor',
      msgs: [
        { dir: 'inbound', body: 'Buenas, quieren contra entrega en Bogotá?', t: 8 },
        { dir: 'outbound', body: 'Hola! Sí, contra entrega en Bogotá. ¿Qué tema te gusta? Tenemos Stitch y Hello Kitty.', t: 7 },
      ]
    },
    {
      customer: customers[2],
      status: 'open', priority: 'urgent', perfil: 'mayorista',
      msgs: [
        { dir: 'inbound', body: 'Mi pedido no llegó, ya pasaron 3 días', t: 5 },
      ]
    },
    {
      customer: customers[3],
      status: 'open', priority: 'normal', perfil: 'detal',
      msgs: [
        { dir: 'inbound', body: 'Quiero 2 short de Stitch para regalo', t: 4 },
      ]
    },
  ]

  let convCount = 0
  let msgCount = 0

  for (let i = 0; i < conversations.length; i++) {
    const c = conversations[i]
    const convId = `conv-sara-fix-${i + 1}`
    const lastMsg = c.msgs[c.msgs.length - 1]
    const lastMsgAt = new Date(Date.now() - lastMsg.t * 3600000)

    await db.conversation.create({
      data: {
        id: convId,
        tenantId: TENANT_ID,
        customerId: c.customer.id,
        channelId: channel.id,
        status: c.status,
        priority: c.priority,
        perfilConversacion: c.perfil,
        sourceAdId: ad?.id,
        sourceCampaign: ad?.campaign.name,
        lastMessageAt: lastMsgAt,
        unreadCount: c.status === 'open' ? 1 : 0,
      }
    })
    convCount++

    for (const m of c.msgs) {
      const createdAt = new Date(Date.now() - m.t * 3600000)
      const embeddingVec = embed(m.body)
      // Match the encoding used by `embedAndStoreMessage` in
      // src/lib/embeddings/service.ts: Float32 LE Buffer. Prisma 6's Bytes
      // column accepts `Uint8Array<ArrayBuffer>` / `Buffer<ArrayBuffer>`.
      await db.message.create({
        data: {
          tenantId: TENANT_ID,
          conversationId: convId,
          direction: m.dir,
          body: m.body,
          type: 'text',
          status: m.dir === 'inbound' ? 'delivered' : 'read',
          ...(embeddingVec ? { embedding: Buffer.from(new Float32Array(embeddingVec).buffer) } : {}),
          createdAt,
        }
      })
      msgCount++
    }
  }

  console.log(`✅ ${convCount} conversaciones + ${msgCount} mensajes creados (con embeddings)`)

  // Verify
  const total = await db.message.count({ where: { tenantId: TENANT_ID } })
  const withEmb = await db.message.count({ where: { tenantId: TENANT_ID, embedding: { not: null } } })
  console.log(`   Verificación: ${total} mensajes, ${withEmb} con embedding`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(async () => { await db.$disconnect() })
