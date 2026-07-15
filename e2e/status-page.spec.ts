// E2E: Public Status Page (/status) — Sprint Monitoring-002.
// TASK: SPRINT-E2E-TESTS-001
//
// Covers src/app/status/page.tsx:
//   - Page loads WITHOUT authentication (PUBLIC_PATTERNS in middleware).
//   - `<h1>Estado del Sistema</h1>` renders.
//   - Overall status indicator shows one of: Operacional | Degradado | Caído.
//   - Individual checks render — at minimum "Base de datos".
//   - "Última verificación:" timestamp is present.
//
// The page is `force-dynamic` with a 30s ISR revalidate, so each test gets
// a fresh render (DB ping + chat-service fetch run server-side). The page
// degrades gracefully — a missing `StatusIncident` table or a down DB is
// swallowed by try/catch and the page still renders (DB check shows "down"
// in that case). Tests assert on the structural markers, not on the live
// status value, so they stay green across environments.

import { test, expect } from '@playwright/test'

test.describe('Public Status Page', () => {
  test('loads without authentication', async ({ page }) => {
    const res = await page.goto('/status')
    // `/status` is in PUBLIC_PATTERNS — middleware passes through.
    expect(res?.status()).toBeLessThan(400)

    // H1 title is always present (server-rendered, no client-side gating).
    await expect(page.locator('h1', { hasText: 'Estado del Sistema' })).toBeVisible({ timeout: 10_000 })
  })

  test('shows overall status indicator', async ({ page }) => {
    await page.goto('/status')

    // The overall-status card renders one of the three configured labels
    // (statusConfig map in src/app/status/page.tsx). We accept any of them
    // — the value depends on the live DB + chat-service health, which can
    // vary across dev/CI/prod environments.
    await expect
      .poll(
        async () => {
          const bodyText = (await page.locator('main').innerText().catch(() => ''))
          return /Operacional|Degradado|Caído/.test(bodyText)
        },
        { timeout: 10_000, intervals: [400, 900, 1500] },
      )
      .toBeTruthy()
  })

  test('shows individual checks', async ({ page }) => {
    await page.goto('/status')

    // The page always renders 2 checks — "Base de datos" (db.$queryRaw
    // SELECT 1) and "Servicio de mensajería" (fetch to chat-service :3003).
    // The DB check is the more reliable one — it's a local SQLite/Postgres
    // ping. The chat-service check depends on the chat-service running
    // (port 3003) so it can degrade, but the row still renders.
    await expect
      .poll(
        async () => {
          const bodyText = (await page.locator('main').innerText().catch(() => ''))
          return /Base de datos/.test(bodyText)
        },
        { timeout: 10_000, intervals: [400, 900, 1500] },
      )
      .toBeTruthy()
  })

  test('shows last check timestamp', async ({ page }) => {
    await page.goto('/status')

    // The overall-status card renders "Última verificación: <timestamp>"
    // (es-CO locale). The timestamp is computed from `new Date().toISOString()`
    // at request time, so it's always present.
    await expect
      .poll(
        async () => {
          const bodyText = (await page.locator('main').innerText().catch(() => ''))
          return /Última verificación/.test(bodyText)
        },
        { timeout: 10_000, intervals: [400, 900, 1500] },
      )
      .toBeTruthy()
  })
})
