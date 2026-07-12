// CommerceFlow OS — Sentry server config (Node.js runtime)
//
// Saramantha §13 — captura errores y performance en el runtime de Node.js
// (API routes, server components, server actions, webhooks). Solo se inicializa
// si SENTRY_DSN está configurado.
//
// Cargado dinámicamente por instrumentation.ts cuando
// process.env.NEXT_RUNTIME === 'nodejs'.
//
// Env vars:
//   - SENTRY_DSN

import * as Sentry from '@sentry/nextjs'

const SENTRY_DSN =
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
  })
}
