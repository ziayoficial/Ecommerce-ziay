// ZIAY — Graceful shutdown
//
// SPRINT4-INFRA-001
//
// When the process receives SIGTERM (Kubernetes pod rotation, `docker stop`,
// `kill <pid>`) or SIGINT (Ctrl-C), we want to:
//   1. Stop accepting new connections (close the HTTP server).
//   2. Close the database connection (Prisma `$disconnect`).
//   3. Close Redis if connected (so pending writes flush).
//   4. Exit 0 (clean) — or let the orchestrator's `terminationGracePeriodSeconds`
//      force-kill us if any of the above hangs.
//
// Next.js 16 manages its own HTTP server internally; the standalone server
// (`.next/standalone/server.js`) handles SIGTERM/SIGINT itself. This module
// is intended for the **mini-services** (chat-service, future queue workers)
// which use `http.createServer()` directly and need explicit shutdown wiring.
//
// It is also safe to call from the Next.js app: the `db.$disconnect()` and
// Redis quit will run, but the `server.close()` is a no-op if no server is
// passed. The signal handlers are idempotent (the `isShuttingDown` flag
// guards against re-entry).
//
// `unhandledRejection` is logged but does NOT trigger shutdown — Node's
// default behaviour changed in v15 (terminate) and we don't want a single
// unawaited promise to kill the whole process. `uncaughtException` DOES
// trigger shutdown, because it usually means the process is in an
// inconsistent state.

import { getLogger } from './logger'

const log = getLogger('shutdown')

let isShuttingDown = false

/**
 * Returns `true` once a shutdown signal has been received. Long-running
 * handlers (e.g. queue workers, webhook processors) can poll this and bail
 * out early instead of starting work that won't get to finish.
 */
export function isGracefulShuttingDown(): boolean {
  return isShuttingDown
}

/**
 * Wire up SIGTERM / SIGINT / uncaughtException / unhandledRejection handlers.
 * Pass an HTTP server (from `http.createServer()`) if you want it closed
 * before the DB / Redis.
 *
 * @example
 * ```ts
 * const httpServer = http.createServer()
 * httpServer.listen(3003)
 * setupGracefulShutdown(httpServer)
 * ```
 */
export function setupGracefulShutdown(server?: { close: () => Promise<void> }): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true
    log.info({ signal }, 'Graceful shutdown started')

    // 1. Stop accepting new connections
    if (server) {
      try {
        await server.close()
        log.info('HTTP server closed')
      } catch (err) {
        log.error({ err }, 'Error closing HTTP server')
      }
    }

    // 2. Close database connection (only if the app uses Prisma — the
    // chat-service does not, so this is wrapped in try/catch).
    try {
      const { db } = await import('./db')
      await db.$disconnect()
      log.info('Database disconnected')
    } catch (err) {
      // chat-service doesn't have `./db` — this is expected, not an error.
      log.debug({ err: err instanceof Error ? err.message : String(err) }, 'Database disconnect skipped')
    }

    // 3. Close Redis if connected
    try {
      const { getRedis } = await import('./redis')
      const redis = await getRedis()
      if (redis) {
        await redis.quit()
        log.info('Redis disconnected')
      }
    } catch (err) {
      // Redis not configured or already gone — not fatal.
      log.debug({ err: err instanceof Error ? err.message : String(err) }, 'Redis disconnect skipped')
    }

    log.info('Graceful shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // Handle uncaught errors — these usually mean the process is in an
  // inconsistent state, so we shut down. The orchestrator will restart us.
  process.on('uncaughtException', (err) => {
    log.error({ err }, 'Uncaught exception')
    void shutdown('uncaughtException')
  })

  // Log unhandled rejections but DON'T exit — a single unawaited promise
  // shouldn't take down the whole service.
  process.on('unhandledRejection', (reason) => {
    log.error({ reason: String(reason) }, 'Unhandled rejection')
  })
}
