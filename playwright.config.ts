import { defineConfig, devices } from '@playwright/test'

/**
 * CommerceFlow OS — Playwright E2E test config.
 *
 * TASK: TESTS-CICD-001
 *
 * - baseURL: http://localhost:3000 (Next.js dev/prod server).
 * - In CI: starts a fresh standalone server, 2 retries, 1 worker, HTML reporter.
 * - Locally: reuses the already-running dev server (or any server on :3000),
 *   no retries, default workers.
 *
 * Run:    bunx playwright test
 * UI:     bunx playwright test --ui
 * Debug:  bunx playwright test --debug
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // CI: 1 retry (balance between flaky test resilience and CI time).
  // Local: no retries.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Production standalone server built by `next build` (output: 'standalone').
    command: 'node .next/standalone/server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // When Playwright boots the standalone server, inherit the local env so
      // DATABASE_URL / NEXTAUTH_SECRET resolve (in CI they come from the
      // workflow env).
    },
  },
})
