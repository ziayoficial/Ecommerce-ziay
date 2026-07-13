// CommerceFlow OS — Next.js instrumentation hook
//
// Saramantha §13 — punto de entrada para inicializar Sentry en cada runtime
// antes de que arranque el servidor. Carga condicionalmente el config de
// Sentry adecuado al runtime actual (nodejs | edge). El config de cliente se
// carga automáticamente por Next.js en el browser.
//
// @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}
