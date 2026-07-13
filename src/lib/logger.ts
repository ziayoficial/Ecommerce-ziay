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

import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  redact: ['*.password', '*.passwordHash', '*.secret', '*.token', '*.apiKey'],
  base: { service: 'ziay', env: process.env.NODE_ENV || 'development' },
  timestamp: pino.stdTimeFunctions.isoTime,
})

/**
 * Devuelve un child logger con el componente adjunto (ej. "api/orders",
 * "agent:orchestrator"). Úsalo para que cada log tenga contexto de origen.
 */
export function getLogger(component: string) {
  return logger.child({ component })
}

export default logger
