// ZIAY — Next.js instrumentation hook
//
// Saramantha §13 — punto de entrada para inicializar Sentry en cada runtime
// antes de que arranque el servidor. Carga condicionalmente el config de
// Sentry adecuado al runtime actual (nodejs | edge). El config de cliente se
// carga automáticamente por Next.js en el browser.
//
// P0.3 FIX: also initializes the cron scheduler (DIAN retry, retention
// cleanup, escrow auto-release, refund retry) when running in Node.js.
//
// @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    // P0.3 FIX: initialize cron jobs for compliance (DIAN retry, retention,
    // refund retry). These run as setInterval-based schedulers that enqueue
    // BullMQ jobs (or run inline in dev). Safe to call — idempotent.
    const { initCronJobs } = await import('./src/lib/cron-scheduler')
    initCronJobs()
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}
