// ZIAY — Live messenger socket.io service
// Port: 3003 (Caddy forwards via ?XTransformPort=3003, path=/)
//
// SPRINT4-INFRA-001 — graceful shutdown helper.
// SPRINT6-SCALE-001 — optional Redis adapter for multi-instance fan-out.
//
// The Redis adapter is enabled automatically when `REDIS_URL` is set AND
// the `@socket.io/redis-adapter` + `ioredis` packages are installed. Both
// packages are dynamically imported via NON-literal module specifiers so
// this file runs fine without them (single-instance mode) — install them
// only on production hosts that run multiple chat-service replicas behind
// the Caddy gateway.
//
//   bun add @socket.io/redis-adapter ioredis
//
// In single-instance mode (no Redis or packages missing) the service is
// unchanged — every `io.emit` reaches all connected clients on this host.

import { createServer } from 'http'
import { Server } from 'socket.io'
import { setupGracefulShutdown } from './graceful-shutdown'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ───────────────────────────────────────────────────────────────────────────
// Optional Redis adapter (multi-instance fan-out)
//
// Wire it up before the first client connects. The setup is async but it
// resolves quickly — `io.adapter()` is synchronous once the adapter is
// constructed, and the ioredis clients connect lazily in the background.
// ───────────────────────────────────────────────────────────────────────────
async function enableRedisAdapter(): Promise<void> {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return

  try {
    // Non-literal specifiers → tsc/TS won't try to resolve type decls, so the
    // chat-service type-checks whether or not these packages are installed.
    const adapterModule = '@socket.io/redis-adapter' as string
    const ioredisModule = 'ioredis' as string
    const { createAdapter } = (await import(adapterModule)) as {
      createAdapter: (pubClient: any, subClient: any) => any
    }
    const IoRedis = (await import(ioredisModule)).default as {
      new (url: string, opts?: Record<string, unknown>): any
    }

    const pubClient = new IoRedis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    })
    const subClient = pubClient.duplicate()

    pubClient.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[chat-service] Redis pub client error:', msg)
    })
    subClient.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[chat-service] Redis sub client error:', msg)
    })

    io.adapter(createAdapter(pubClient, subClient))
    console.log('[chat-service] Redis adapter enabled — multi-instance ready')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[chat-service] Redis adapter not available (single-instance mode): ${msg}`,
    )
  }
}

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

  socket.emit('hello', { service: 'ziay-chat', ts: Date.now() })

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

// Boot sequence: enable the Redis adapter first (no-op without REDIS_URL),
// then start listening. The adapter setup is fast and won't block the port
// bind meaningfully — it returns as soon as the ioredis clients are
// constructed, before they finish connecting.
enableRedisAdapter()
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[chat-service] enableRedisAdapter threw — continuing in single-instance mode:', msg)
  })
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`✅ ZIAY chat-service running on port ${PORT}`)
    })
  })

// Graceful shutdown (SPRINT4-INFRA-001) — closes socket.io + HTTP server
// cleanly on SIGTERM / SIGINT so connected clients can reconnect to another
// instance immediately. Replaces the previous inline signal handlers.
setupGracefulShutdown({ httpServer, io })
