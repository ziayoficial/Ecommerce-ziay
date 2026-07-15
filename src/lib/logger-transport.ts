/**
 * Pino transport for log shipping — sends logs to external service.
 * Document §M-11: log aggregation (Loki, Datadog, CloudWatch)
 *
 * In production, set LOG_SHIPPING_URL to enable. Logs are batched
 * and sent every 5 seconds via fetch.
 *
 * SPRINT-MONITORING-002.
 *
 * Why a custom stream and not a pino worker-thread transport?
 * pino transports (the `{ target: '...', options: {...} }` form) run
 * in a worker thread spawned by pino. That works but adds a worker
 * process and complicates shutdown. For our needs (batched POST to a
 * log ingest endpoint) a synchronous `write()`-as-DestinationStream
 * is enough — pino calls `write(msg)` once per log line, we buffer,
 * and a setInterval flushes every 5s. See `logger.ts` for the wiring
 * (passed as the second arg to `pino(...)` via `pino.multistream`).
 *
 * Failure handling:
 *   - On flush failure the batch is re-queued (capped at 200 entries)
 *     so a transient network blip doesn't drop logs.
 *   - On JSON parse failure (shouldn't happen — pino always emits
 *     valid JSON) the entry is silently dropped.
 *   - The fetch uses `keepalive: true` so a flush finishing after
 *     process exit still lands.
 */

interface LogEntry {
  level: string
  time: number
  msg: string
  [key: string]: unknown
}

const BATCH_SIZE = 50
const FLUSH_INTERVAL = 5000 // 5 seconds

let batch: LogEntry[] = []
let flushTimer: NodeJS.Timeout | null = null

/**
 * Internal flush — drains the current batch and POSTs it to the
 * shipping URL. Failures re-queue the batch (capped at 200 entries).
 */
async function flush(shippingUrl: string) {
  if (batch.length === 0) return
  const toSend = [...batch]
  batch = []

  try {
    await fetch(shippingUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: toSend }),
      signal: AbortSignal.timeout(5000),
      keepalive: true,
    })
  } catch {
    // Re-add to batch if send fails (up to 200 max)
    batch = [...toSend.slice(-150), ...batch].slice(0, 200)
  }
}

/**
 * Creates a log-shipping destination stream. Returns `null` when no
 * `shippingUrl` is provided (the common case — log shipping is opt-in
 * via `LOG_SHIPPING_URL`).
 *
 * The returned object is a valid pino `DestinationStream` (has a
 * `write(msg: string): void` method) so it can be passed directly to
 * `pino(opts, stream)` or included in a `pino.multistream([...])`
 * entry list.
 *
 * Side effects: starts a `setInterval` that flushes the batch every
 * `FLUSH_INTERVAL` ms. The interval is module-scoped — calling
 * `createLogTransport` again clears the previous interval (only one
 * shipper is expected per process).
 */
export function createLogTransport(shippingUrl?: string) {
  if (!shippingUrl) return null

  if (flushTimer) clearInterval(flushTimer)
  flushTimer = setInterval(() => {
    void flush(shippingUrl)
  }, FLUSH_INTERVAL)

  // Don't keep the event loop alive solely for the flush timer —
  // otherwise graceful shutdown hangs for up to 5s waiting for the
  // interval to fire. The `keepalive: true` on the fetch still lets
  // a final flush land after exit.
  flushTimer.unref?.()

  return {
    write(logEntry: string) {
      try {
        const parsed: LogEntry = JSON.parse(logEntry)
        batch.push(parsed)
        if (batch.length >= BATCH_SIZE) {
          void flush(shippingUrl)
        }
      } catch {
        // Ignore parse errors
      }
    },
    async flush() {
      await flush(shippingUrl)
    },
  }
}
