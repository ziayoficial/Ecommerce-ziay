// ZIAY — Structured logger (pino)
//
// Saramantha §13 — logger estructurado para toda la plataforma. Reemplaza los
// `console.log` / `console.error` dispersos por un logger con:
//   - levels (debug/info/warn/error)
//   - redacción automática de campos sensibles (password, token, apiKey, …)
//   - base context (service, env)
//   - timestamps ISO
//   - pretty-print en desarrollo, JSON en producción
//
// Uso:
//   import { getLogger } from '@/lib/logger'
//   const log = getLogger('api/orders')
//   log.info({ orderId }, 'order created')
//   log.error({ err }, 'failed to persist')
//
// Env vars:
//   - LOG_LEVEL  (debug | info | warn | error — default: info en prod, debug en dev)
//   - LOG_SHIPPING_URL  (optional — production log shipping endpoint. SPRINT-MONITORING-002.)

import pino from 'pino'
import { createLogTransport } from './logger-transport'

const isDev = process.env.NODE_ENV !== 'production'
const shippingUrl = process.env.LOG_SHIPPING_URL

const baseOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  redact: ['*.password', '*.passwordHash', '*.secret', '*.token', '*.apiKey'],
  base: { service: 'ziay', env: process.env.NODE_ENV || 'development' },
  timestamp: pino.stdTimeFunctions.isoTime,
}

// ───────────────────────────────────────────────────────────────────────────
// Destination wiring.
//
// Three modes:
//   1. Dev (any)         → pino-pretty worker-thread transport (colored stdout).
//   2. Prod + LOG_SHIPPING_URL → multistream(stdout + remote shipper). Pino's
//      worker-thread `transport` option is incompatible with `multistream`,
//      so we use the multistream API instead. Logs still hit stdout AND the
//      external ingest endpoint (Loki / Datadog / CloudWatch).
//   3. Prod, no shipping → default stdout.
//
// The shipper (src/lib/logger-transport.ts) batches entries and POSTs every
// 5s — see that file for failure-handling details.
// ───────────────────────────────────────────────────────────────────────────

function buildLogger(): pino.Logger {
  if (isDev) {
    return pino({
      ...baseOptions,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    })
  }

  if (shippingUrl) {
    const shipper = createLogTransport(shippingUrl)
    const streams: pino.StreamEntry[] = [{ stream: process.stdout }]
    if (shipper) {
      // shipper satisfies pino.DestinationStream (has `write(msg: string): void`).
      streams.push({ stream: shipper })
    }
    return pino(baseOptions, pino.multistream(streams))
  }

  return pino(baseOptions)
}

export const logger = buildLogger()

/**
 * Devuelve un child logger con el componente adjunto (ej. "api/orders",
 * "agent:orchestrator"). Úsalo para que cada log tenga contexto de origen.
 */
export function getLogger(component: string) {
  return logger.child({ component })
}

export default logger
