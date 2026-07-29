// ZIAY chat-service — Graceful shutdown
//
// SPRINT4-INFRA-001
//
// Self-contained graceful-shutdown helper for the chat-service mini-service.
// Kept inline (rather than importing from `../../src/lib/graceful-shutdown.ts`)
// because the chat-service is a separate bun project:
//   - it doesn't share the root `node_modules` (pino, prisma, ioredis, …)
//   - in the docker-compose deployment its source is mounted at `/app`, so
//     relative imports back to `../../src/...` would not resolve at runtime.
//
// Behaviour mirrors the main app's `src/lib/graceful-shutdown.ts`:
//   1. Stop accepting new connections (close the HTTP server).
//   2. Close socket.io (disconnects every connected client cleanly).
//   3. Log + exit 0.

let isShuttingDown = false

export function isGracefulShuttingDown(): boolean {
  return isShuttingDown
}

interface ShutdownTargets {
  httpServer: { close: (cb?: () => void) => unknown }
  io: { close: (fn?: () => void) => unknown }
}

export function setupGracefulShutdown({ httpServer, io }: ShutdownTargets): void {
  const shutdown = (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true
    console.warn(`[chat-service] Graceful shutdown started (signal=${signal})`)

    // 1. Close socket.io first — disconnects every connected client cleanly
    //    so they can reconnect to another instance immediately.
    try {
      io.close(() => {
        console.warn('[chat-service] socket.io closed')
      })
    } catch (err) {
      console.error('[chat-service] Error closing socket.io:', err)
    }

    // 2. Close the HTTP server. Stop accepting new connections; in-flight
    //    requests are allowed to finish (none in this service — it only
    //    speaks WebSocket).
    try {
      httpServer.close(() => {
        console.warn('[chat-service] HTTP server closed')
        console.warn('[chat-service] Graceful shutdown complete')
        process.exit(0)
      })
    } catch (err) {
      console.error('[chat-service] Error closing HTTP server:', err)
      process.exit(1)
    }

    // Hard-stop safety net: if close() hangs, the orchestrator's
    // `terminationGracePeriodSeconds` will SIGKILL us. Belt-and-braces,
    // we also force-exit after 5s so local `bun --hot` reload doesn't hang.
    setTimeout(() => {
      console.error('[chat-service] Shutdown timed out — forcing exit')
      process.exit(1)
    }, 5000).unref?.()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('uncaughtException', (err) => {
    console.error('[chat-service] Uncaught exception:', err)
    shutdown('uncaughtException')
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[chat-service] Unhandled rejection:', String(reason))
    // Don't exit — just log.
  })
}
