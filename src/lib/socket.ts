'use client'
import { io, Socket } from 'socket.io-client'

// FIX-REALTIME-WEBHOOKS-001 — Socket.io client SDK with auth + tenant isolation.
//
// The chat-service now requires a valid NextAuth JWT on every connection.
// The token is delivered via the browser's automatic cookie send
// (`credentials: true`) — the NextAuth session cookie is httpOnly so JS
// can't read it, but socket.io will include it on the WebSocket upgrade
// handshake as long as the connection is same-origin (which it is — Caddy
// proxies `/socket.io/?XTransformPort=3003` to the chat-service on the
// same host:port the browser sees).
//
// For non-browser clients (native mobile, server-to-server) the caller
// can pass an explicit `token` via the second argument; it's forwarded
// as `auth.token` which the chat-service reads BEFORE the cookie.
//
// The connection will fail with `connect_error` if the token is missing,
// expired, or has no `tenantId` claim. Callers should listen for that
// event to surface a re-login prompt.

let socket: Socket | null = null

export interface GetSocketOptions {
  /** Optional explicit JWT. When omitted, the chat-service relies on the
   *  httpOnly session cookie sent automatically via `credentials: true`. */
  token?: string
}

export function getSocket(opts: GetSocketOptions = {}): Socket {
  if (socket && socket.connected) return socket
  // Tear down any half-open socket from a previous failed attempt so the
  // next `getSocket()` starts fresh with the latest token.
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }

  socket = io('/?XTransformPort=3003', {
    transports: ['websocket', 'polling'],
    withCredentials: true, // send httpOnly session cookie — required for auth
    auth: opts.token ? { token: opts.token } : undefined,
    forceNew: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1500,
    timeout: 10000,
  })

  // Surface auth errors so the UI can prompt re-login. Without this the
  // socket silently retries forever and the user sees a "connecting…"
  // spinner with no explanation.
  socket.on('connect_error', (err: Error) => {
    const msg = err.message || ''
    if (msg.includes('token') || msg.includes('No tenantId') || msg.includes('NEXTAUTH_SECRET')) {
      console.warn('[socket] auth failed:', msg, '— redirect to login may be required')
    }
  })

  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}
