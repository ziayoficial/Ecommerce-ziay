// CommerceFlow OS — Sentry client config (browser)
//
// Saramantha §13 — captura errores y performance en el browser. Solo se
// inicializa si SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN está configurado, para no
// romper el desarrollo local.
//
// Importado automáticamente por Next.js vía instrumentation.ts (runtime=nodejs
// → sentry.server.config.ts, runtime=edge → sentry.edge.config.ts). El cliente
// se inicializa aquí cuando el bundler del browser lo carga.
//
// Env vars:
//   - SENTRY_DSN
//   - NEXT_PUBLIC_SENTRY_DSN

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
