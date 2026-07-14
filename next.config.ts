import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
// SPRINT-POLISH-001 — bundle analyzer. Conditional wrapper: only active when
// ANALYZE=true so it never affects normal `next build`/`next dev`. The wrapper
// is applied BEFORE Sentry (Sentry stays outermost) so Sentry sees the final
// config object.
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  reactStrictMode: true,
  // Disable the Next.js 16 dev overlay (the issues/build-activity badge that
  // floats at the bottom of the viewport). In dev it was blocking clicks on
  // the sidebar nav (agent-browser reported "Element is covered by
  // <nextjs-portal> at its click point"). It's a dev-only UI element and does
  // not appear in production builds.
  devIndicators: false,

  // FIX-PERFORMANCE-001 — build config improvements:
  //   - compress: gzip at the app layer (Caddy could also brotli, but this
  //     guarantees compression even when running standalone behind a bare
  //     reverse proxy).
  //   - poweredByHeader: false removes the `X-Powered-By: Next.js` header
  //     so the framework + version isn't leaked to passive scanners.
  //   - experimental.optimizePackageImports: tree-shakes per-icon imports
  //     from lucide-react + @radix-ui/react-icons so only the icons
  //     actually referenced ship in the client bundle (lucide-react has
  //     ~1.5k icons — barrel imports without this flag pull the whole set
  //     into the dev graph and slow first build).
  compress: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons', 'recharts'],
  },
};

// ───────────────────────────────────────────────────────────────────────────
// SPRINT-MONITORING-DR-001 · M-2 — Sentry source map upload.
//
// Wraps the Next.js config with `withSentryConfig` so the build uploads source
// maps to Sentry. Without this, every production error in Sentry shows a
// minified stack trace (e.g. `at a8f2.c1.min.js:1:4523`) and is impossible to
// triage. With source maps, the same error shows the original TS file + line.
//
// Behaviour:
//   - `silent: true` — don't spam the build log with upload progress.
//   - `org` / `project` — read from env so the same config works across
//     projects (set SENTRY_ORG + SENTRY_PROJECT in CI).
//   - `authToken` — only attached when SENTRY_AUTH_TOKEN is set, so local
//     `next dev` / `next build` doesn't fail trying to upload without creds.
//   - Source maps are deleted from the build output after upload by default
//     (Sentry SDK v10: `sourcemaps.deleteSourcemapsAfterUpload` defaults to
//     `true`), so they are never served publicly. The old `hideSourceMaps`
//     option was removed in SDK v10 — keeping it here causes a TS2353 build
//     error (`'hideSourceMaps' does not exist in type 'SentryBuildOptions'`).
//   - `sourcemaps.disable: true` in development — no point uploading source
//     maps from a local dev build. The old `disableServerWebpackPlugin` /
//     `disableClientWebpackPlugin` options were also removed in SDK v10;
//     `sourcemaps.disable` is the official replacement.
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// SPRINT-POLISH-001 · Bundle analyzer.
//
// Wraps the Next.js config with `@next/bundle-analyzer` when `ANALYZE=true`.
// When enabled, the build emits two interactive treemap HTML reports
// (`.next/analyze/client.html` + `.next/analyze/server.html`) so we can see
// exactly which modules are shipping in each bundle — useful for catching
// accidental barrel imports (e.g. `import * from 'lucide-react'` pulling
// 1.5k icons) and for sizing the impact of new dependencies before merge.
//
// Wrapper order: `withBundleAnalyzer` is applied FIRST, then `withSentryConfig`
// is applied to the result. Sentry stays outermost (matches the existing
// contract from SPRINT-MONITORING-DR-001 · M-2) so it sees the final config
// object including any analyzer-injected webpack rules.
//
// Run with: `bun run analyze` (script in package.json) or
// `ANALYZE=true bun run build`.
// ───────────────────────────────────────────────────────────────────────────

const config = withBundleAnalyzer(nextConfig);

export default withSentryConfig(config, {
  // Upload source maps in production
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Only upload in CI (when SENTRY_AUTH_TOKEN is set)
  ...(process.env.SENTRY_AUTH_TOKEN
    ? {
        authToken: process.env.SENTRY_AUTH_TOKEN,
      }
    : {}),
  // Disable source-map upload in development. In production with
  // SENTRY_AUTH_TOKEN set, source maps are uploaded AND then deleted from
  // the build output (default SDK v10 behaviour) so they're never served
  // publicly — equivalent to the old `hideSourceMaps: true` flag.
  sourcemaps: {
    disable: process.env.NODE_ENV === 'development',
  },
});
