// ─────────────────────────────────────────────────────────────────────────────
// Internal fire-and-forget emitter for the chat-service `/emit` endpoint.
//
// The WhatsApp webhook (and any other server-side producer of live
// messenger events) needs to fan out a `message:new` / `message:received`
// event to every dashboard of the tenant. The socket.io server lives in
// a separate mini-service (`mini-services/chat-service`) on port 3003,
// so the Next.js process can't `io.to(...)` directly. Instead it makes
// a fire-and-forget POST to `http://localhost:3003/emit` with
// `{ tenantId, event, payload }` and the chat-service broadcasts to the
// tenant room.
//
// Failures are swallowed + logged — the webhook must NEVER block on the
// realtime fan-out. If the chat-service is down the message is still
// persisted in the DB and the dashboard will see it on next refresh.
//
// SPRINT-WHATSAPP-FUNCTIONAL-001
// ─────────────────────────────────────────────────────────────────────────────

import { getLogger } from '@/lib/logger'

const log = getLogger('chat-emit')

const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_INTERNAL_URL ?? 'http://localhost:3003'

const EMIT_TIMEOUT_MS = 3_000

/**
 * Fire-and-forget broadcast to all dashboards of a tenant. Resolves
 * immediately (does NOT await the chat-service response) so the webhook
 * can ACK Meta quickly. The actual fetch happens in the background and
 * any error is logged but never propagated.
 */
export function emitToTenant(
  tenantId: string,
  event: string,
  payload: unknown,
): void {
  // `void` keyword makes the floating promise explicit — we deliberately
  // don't await it. The catch handler logs and swallows.
  void fetch(`${CHAT_SERVICE_URL}/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, event, payload }),
    signal: AbortSignal.timeout(EMIT_TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) {
        log.warn(
          { tenantId, event, status: res.status },
          'chat-service /emit returned non-2xx (non-blocking)',
        )
      }
    })
    .catch((err) => {
      log.warn(
        { tenantId, event, err: err instanceof Error ? err.message : String(err) },
        'chat-service /emit failed (non-blocking) — dashboard will refresh on next poll',
      )
    })
}
