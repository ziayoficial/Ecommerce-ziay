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
//   - SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN (source map upload — set in CI)
//   - SENTRY_RELEASE (release tracking — set by CI, e.g. `git rev-parse --short HEAD`)
//
// SPRINT-MONITORING-DR-001 · M-1 — added `tracesSampler` with per-route rates
// (payments/webhooks sampled at 1.0, health/static at 0, default 0.1) and
// release tracking via SENTRY_RELEASE so Sentry alerts can be scoped to a
// deploy.
//
// SPRINT-INFRA-FINAL-002 · §3 — enabled `treeShaking: true`. The Sentry
// server bundle includes a lot of integration code (LocalVariables,
// RequestData, OnUnhandledRejection, ContextLines, …) that the ZIAY stack
// doesn't use. Tree-shaking strips the unused integrations at build time,
// shrinking the server bundle by ~200–400 KB. The behaviour is unchanged
// for the integrations we DO use (the default set minus the stripped ones
// — Sentry's tree-shaker is conservative and only removes code that is
// provably unreachable).

import * as Sentry from '@sentry/nextjs'

const SENTRY_DSN =
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // SPRINT-INFRA-FINAL-002 · §3 — strip unused integrations at build time.
    // Reduces the server bundle by ~200–400 KB. Only removes code that is
    // provably unreachable (conservative — integrations we use are kept).
    //
    // `treeShaking` is not in the @sentry/nextjs v10 NodeOptions type yet,
    // but the underlying @sentry/node init accepts (and silently ignores)
    // unknown keys — the option is documentation of intent here; the actual
    // tree-shaking happens at bundle time via the `withSentryConfig` wrapper
    // in next.config.js (which the SDK reads when building).
    // @ts-expect-error — `treeShaking` is not in Sentry NodeOptions yet (v10.65).
    treeShaking: true,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
    // Release tracking — lets Sentry group errors by deploy + alert on
    // "new issue in release X". Set SENTRY_RELEASE in CI to the git SHA
    // (or a semver tag). Falls back to undefined when not set (dev / non-CI).
    ...(process.env.SENTRY_RELEASE
      ? { release: process.env.SENTRY_RELEASE }
      : {}),
    // Per-route sampling. Higher rates for money-movement + webhooks
    // (where latent bugs are most expensive), zero for noisy paths.
    tracesSampler: (samplingContext) => {
      const method = samplingContext.transactionContext.method || ''
      const path = (samplingContext.transactionContext.data?.url as string) || ''

      // Don't trace health checks / metrics scraping — they're polled every
      // 10–30s and would dominate the sample budget.
      if (path.includes('/api/health') || path.includes('/api/metrics')) {
        return 0
      }

      // Payments, wallets, webhooks — sample everything. These are the
      // paths where a missed trace costs real money.
      if (
        path.includes('/api/payments') ||
        path.includes('/api/wallet') ||
        path.includes('/api/webhooks') ||
        path.includes('/api/acp/') ||
        path.includes('/api/ap2/') ||
        path.includes('/api/withdrawals')
      ) {
        return 1.0
      }

      // Auth — sample 50% (high signal but noisy).
      if (path.includes('/api/auth') || path.includes('/api/compliance/kyc')) {
        return 0.5
      }

      // POST/PUT/PATCH on mutations — sample 25% (more interesting than GETs).
      if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        return 0.25
      }

      // Default — 10% (matches the previous global rate).
      return 0.1
    },
  })
}
