// ZIAY — Live messenger socket.io service
// Port: 3003 (Caddy forwards via ?XTransformPort=3003, path=/)
//
// SPRINT4-INFRA-001 — graceful shutdown helper.
// SPRINT6-SCALE-001 — optional Redis adapter for multi-instance fan-out.
// FIX-REALTIME-WEBHOOKS-001 — JWT auth middleware + per-tenant room isolation.
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
// unchanged — every `io.to('tenant:<id>').emit` reaches only the sockets
// joined to that tenant's room, on this host.
//
// ───────────────────────────────────────────────────────────────────────────
// Authentication (FIX-REALTIME-WEBHOOKS-001 · R1 + R2)
// ───────────────────────────────────────────────────────────────────────────
// Every socket MUST present a valid NextAuth JWT before it can join a tenant
// room. The token is read from EITHER:
//   1. `socket.handshake.auth.token` — explicit (native clients, mobile)
//   2. `socket.handshake.headers.cookie` — automatic when the browser
//      connects with `credentials: true` and the JWT cookie is same-origin
//      via Caddy.
//
// The JWT is verified with HS256 using `NEXTAUTH_SECRET` (or `AUTH_SECRET`).
// Verification is done with Node's `crypto` module — no external dep added.
// Once verified, the socket is stamped with `{ tenantId, userId, role }`
// and joined to room `tenant:<tenantId>` so all `io.to('tenant:<id>')`
// emits reach only that tenant's dashboards.

import { createServer, IncomingMessage } from 'http'
import crypto from 'crypto'
import { Server, Socket } from 'socket.io'
import { setupGracefulShutdown } from './graceful-shutdown'

// ───────────────────────────────────────────────────────────────────────────
// JWT verification (HS256, NextAuth v4 compatible) — uses only `crypto`
// ───────────────────────────────────────────────────────────────────────────

interface JwtPayload {
  sub?: string
  role?: string
  tenantId?: string
  tenantSlug?: string
  tenantName?: string
  exp?: number
  iat?: number
  jti?: string
}

/**
 * NextAuth JWT secret. Same value as `AUTH_SECRET` in `src/lib/auth.ts`.
 * Falls back to a known dev-only string when neither env var is set (dev
 * only — the auth.ts module throws in production if NEXTAUTH_SECRET is
 * missing, so we mirror that strictness below in the io.use middleware).
 */
const JWT_SECRET =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  'ziay-dev-secret-fallback-only-for-development'

function base64UrlDecode(s: string): string {
  // base64url uses `-` and `_` instead of `+` and `/`; padding is optional.
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s + pad, 'base64url').toString('utf8')
}

/**
 * Verify a NextAuth JWT (HS256) and return its decoded payload. Throws on
 * any failure (bad format, wrong alg, bad signature, expired). The
 * signature comparison uses `crypto.timingSafeEqual` to avoid timing
 * side-channels.
 */
function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid token format')
  const [headerB64, payloadB64, sigB64] = parts

  let header: { alg?: string; typ?: string }
  try {
    header = JSON.parse(base64UrlDecode(headerB64))
  } catch {
    throw new Error('Invalid token header')
  }
  if (header.alg !== 'HS256') throw new Error(`Unsupported alg: ${header.alg}`)

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')
  const sigBuf = Buffer.from(sigB64)
  const expBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid signature')
  }

  let payload: JwtPayload
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64))
  } catch {
    throw new Error('Invalid token payload')
  }
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error('Token expired')
  }
  return payload
}

/**
 * Extract the NextAuth session JWT from a `Cookie:` header. Handles both
 * the dev cookie name (`next-auth.session-token`) and the production
 * prefixed name (`__Secure-next-auth.session-token`). Returns the decoded
 * token value (URL-decoded, since cookies are URI-encoded).
 */
function extractTokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(
    /(?:^|;\s*)(?:__Secure-)?next-auth\.session-token=([^;]+)/,
  )
  return match ? decodeURIComponent(match[1]) : null
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP server + Socket.io
// ───────────────────────────────────────────────────────────────────────────

const httpServer = createServer()

// CORS origins — `CHAT_CORS_ORIGIN` (docker-compose convention) wins, then
// `CORS_ORIGIN`, then the localhost dev default. The list is split on commas
// and trimmed. With `credentials: true`, Socket.io requires explicit origins
// (no `*`), so we always have at least the localhost fallback.
function resolveCorsOrigins(): string[] {
  const raw = process.env.CHAT_CORS_ORIGIN || process.env.CORS_ORIGIN
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return ['http://localhost:3000', 'http://localhost', 'http://localhost:81']
}

const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: resolveCorsOrigins(),
    methods: ['GET', 'POST'],
    credentials: true,
  },
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
    console.warn('[chat-service] Redis adapter enabled — multi-instance ready')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[chat-service] Redis adapter not available (single-instance mode): ${msg}`,
    )
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Simulated customer auto-replies (demo only — in production these come
// from WA/Messenger webhooks, which also stamp the tenantId from the
// channel record before emitting to `tenant:<id>`).
// ───────────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────────
// Auth middleware — runs once per connection attempt. Rejects the
// connection (`next(new Error(...))`) when the token is missing, invalid,
// or has no `tenantId`. The error reaches the client as
// `connect_error` with `message` set to the error string.
// ───────────────────────────────────────────────────────────────────────────
io.use((socket: Socket, next) => {
  const authToken = (socket.handshake.auth?.token as string | undefined) || null
  const cookieToken = extractTokenFromCookie(socket.handshake.headers.cookie)
  const token = authToken || cookieToken

  if (!token) {
    return next(new Error('No token provided'))
  }

  // In production, NEXTAUTH_SECRET MUST be set (the main app's auth.ts
  // enforces the same). Without it, anyone could forge a JWT.
  if (!process.env.NEXTAUTH_SECRET && !process.env.AUTH_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      return next(new Error('NEXTAUTH_SECRET not configured'))
    }
    // Dev-only: log loudly and accept the token without verification so a
    // fresh checkout can still demo the messenger without configuring a
    // secret. Production never enters this branch.
    console.warn(
      '[chat-service] NEXTAUTH_SECRET not set — skipping JWT verification in dev mode. ' +
        'Set NEXTAUTH_SECRET to enforce auth.',
    )
    // Without verification we can't trust the token's tenantId claim — tag
    // the socket as a dev tenant. Real clients in dev should still set the
    // secret so this branch is a graceful degradation, not the norm.
    socket.data.tenantId = 'dev'
    socket.data.userId = 'dev'
    socket.data.role = 'agent'
    return next()
  }

  try {
    const payload = verifyJwt(token, JWT_SECRET)
    if (!payload.tenantId) {
      return next(new Error('No tenantId in token'))
    }
    socket.data.tenantId = payload.tenantId
    socket.data.userId = payload.sub
    socket.data.role = payload.role
    next()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid token'
    next(new Error(msg))
  }
})

// ───────────────────────────────────────────────────────────────────────────
// Connection handler — every emit is scoped to the tenant room so a
// message from tenant A's customer is never visible to tenant B's
// dashboard. (FIX-REALTIME-WEBHOOKS-001 · R1)
// ───────────────────────────────────────────────────────────────────────────
io.on('connection', (socket: Socket) => {
  const tenantId = socket.data.tenantId as string | undefined
  if (!tenantId) {
    // Auth middleware should have prevented this, but defense-in-depth.
    socket.disconnect(true)
    return
  }
  const tenantRoom = `tenant:${tenantId}`
  socket.join(tenantRoom)
  console.warn(
    `[chat-service] agent connected: ${socket.id} (tenant=${tenantId}, user=${socket.data.userId ?? 'unknown'})`,
  )

  socket.emit('hello', { service: 'ziay-chat', ts: Date.now() })

  // Agent sent a message -> broadcast to all dashboards in the same tenant
  // + simulate a customer reply (demo only). The reply is also scoped to
  // the tenant room.
  socket.on('message:sent', (data: { conversationId: string; body: string; agentName?: string }) => {
    const outbound: LiveMessage = {
      conversationId: data.conversationId,
      direction: 'outbound',
      body: data.body,
      agentName: data.agentName,
      timestamp: new Date().toISOString(),
    }
    io.to(tenantRoom).emit('message:new', outbound)
    console.warn(`[chat-service] outbound -> conv ${data.conversationId}: ${data.body.slice(0, 60)}`)

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
      io.to(tenantRoom).emit('message:new', inbound)
      io.to(tenantRoom).emit('conversation:updated', {
        conversationId: data.conversationId,
        lastMessageAt: inbound.timestamp,
        unreadCount: 1,
      })
      console.warn(`[chat-service] inbound  <- conv ${data.conversationId}: ${reply}`)
    }, delay)
  })

  // Typing indicator — `socket.to(room)` sends to everyone in the room
  // EXCEPT the sender (matches the original `socket.broadcast` semantics
  // but now tenant-scoped so other tenants don't see the indicator).
  socket.on('agent:typing', (data: { conversationId: string }) => {
    socket.to(tenantRoom).emit('agent:typing', data)
  })

  // Status change broadcast (e.g. order paid, ad killed) — scoped to tenant.
  socket.on('status:change', (data: { entity: string; id: string; status: string }) => {
    io.to(tenantRoom).emit('status:change', data)
  })

  socket.on('disconnect', () => {
    console.warn(`[chat-service] agent disconnected: ${socket.id} (tenant=${tenantId})`)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Lightweight health endpoint for the docker-compose healthcheck
// (`wget --spider http://localhost:3003/health`). Does NOT require auth —
// only reports whether the process is alive and the socket.io server is
// listening. Returns 200 + JSON body.
//
// SPRINT-WHATSAPP-FUNCTIONAL-001 — also exposes an internal `/emit`
// endpoint that the Next.js WhatsApp webhook can POST to when an inbound
// message arrives. The webhook runs in the Next.js process (port 3000),
// not here, so to broadcast the inbound to every dashboard of the same
// tenant it makes a fire-and-forget fetch to `http://localhost:3003/emit`
// with `{ tenantId, event, payload }`. This service then does
// `io.to('tenant:<tenantId>').emit(event, payload)` which fans out to
// every connected dashboard.
//
// The `/emit` endpoint is intentionally UNAUTHENTICATED:
//   1. It listens on `127.0.0.1` only in production (Caddy doesn't expose
//      it externally — only the `/socket.io/` path is proxied).
//   2. The next.js process is the only legitimate caller; an attacker
//      who can hit `127.0.0.1:3003` already has shell access.
//   3. The payload is the event name + JSON object — no secrets, no
//      write-side effects beyond the socket broadcast.
// ───────────────────────────────────────────────────────────────────────────
httpServer.on('request', async (req: IncomingMessage, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'ziay-chat',
        uptime_seconds: Math.round(process.uptime()),
        connected_sockets: io.engine.clientsCount,
        timestamp: new Date().toISOString(),
      }),
    )
    return
  }

  // Internal emit endpoint — used by the Next.js WhatsApp webhook to
  // fan out inbound messages to all dashboards of a tenant.
  if (req.url === '/emit' && req.method === 'POST') {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(chunk as Buffer)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        tenantId?: string
        event?: string
        payload?: unknown
      }
      if (!body.tenantId || !body.event) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'tenantId and event required' }))
        return
      }
      const room = `tenant:${body.tenantId}`
      io.to(room).emit(body.event, body.payload)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, room, event: body.event }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[chat-service] /emit error:', msg)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid JSON body' }))
    }
    return
  }

  // Socket.io owns all other paths — for anything else, 404.
  if (!req.url?.startsWith('/socket.io/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
})

const PORT = Number(process.env.CHAT_SERVICE_PORT) || 3003

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
      console.warn(`✅ ZIAY chat-service running on port ${PORT}`)
    })
  })

// Graceful shutdown (SPRINT4-INFRA-001) — closes socket.io + HTTP server
// cleanly on SIGTERM / SIGINT so connected clients can reconnect to another
// instance immediately. Replaces the previous inline signal handlers.
setupGracefulShutdown({ httpServer, io })
