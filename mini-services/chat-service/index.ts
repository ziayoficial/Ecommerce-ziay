// CommerceFlow OS — Live messenger socket.io service
// Port: 3003 (Caddy forwards via ?XTransformPort=3003, path=/)
import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Simulated customer auto-replies (demo only — in production these come from WA/Messenger webhooks)
const CUSTOMER_REPLIES = [
  'Perfecto, gracias!',
  '¿Cuánto cuesta el envío?',
  'Sí, confirmo el pedido',
  'Acepto pago anticipado con el descuento',
  '¿Tienen disponibilidad para entrega mañana?',
  'Mi dirección es Cra 45 # 12-30, apartamento 502',
  'Genial, quedo atenta al pago',
  'Muchas gracias por la atención 🙏',
]

interface LiveMessage {
  conversationId: string
  direction: 'inbound' | 'outbound'
  body: string
  agentName?: string
  timestamp: string
}

io.on('connection', (socket) => {
  console.log(`[chat-service] agent connected: ${socket.id}`)

  socket.emit('hello', { service: 'commerceflow-chat', ts: Date.now() })

  // Agent sent a message -> broadcast to all dashboards + simulate customer reply
  socket.on('message:sent', (data: { conversationId: string; body: string; agentName?: string }) => {
    const outbound: LiveMessage = {
      conversationId: data.conversationId,
      direction: 'outbound',
      body: data.body,
      agentName: data.agentName,
      timestamp: new Date().toISOString(),
    }
    io.emit('message:new', outbound)
    console.log(`[chat-service] outbound -> conv ${data.conversationId}: ${data.body.slice(0, 60)}`)

    // Simulate a customer inbound reply after 3-6s (demo)
    const delay = 3000 + Math.random() * 3000
    setTimeout(() => {
      const reply = CUSTOMER_REPLIES[Math.floor(Math.random() * CUSTOMER_REPLIES.length)]
      const inbound: LiveMessage = {
        conversationId: data.conversationId,
        direction: 'inbound',
        body: reply,
        timestamp: new Date().toISOString(),
      }
      io.emit('message:new', inbound)
      io.emit('conversation:updated', { conversationId: data.conversationId, lastMessageAt: inbound.timestamp, unreadCount: 1 })
      console.log(`[chat-service] inbound  <- conv ${data.conversationId}: ${reply}`)
    }, delay)
  })

  // Typing indicator
  socket.on('agent:typing', (data: { conversationId: string }) => {
    socket.broadcast.emit('agent:typing', data)
  })

  // Status change broadcast (e.g. order paid, ad killed)
  socket.on('status:change', (data: { entity: string; id: string; status: string }) => {
    io.emit('status:change', data)
  })

  socket.on('disconnect', () => {
    console.log(`[chat-service] agent disconnected: ${socket.id}`)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`✅ CommerceFlow chat-service running on port ${PORT}`)
})

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)))
process.on('SIGINT', () => httpServer.close(() => process.exit(0)))
