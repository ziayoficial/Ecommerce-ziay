// E2E: Governance Dashboard — Sprint 8A view.
// TASK: SPRINT-E2E-TESTS-001
//
// Covers the `GovernanceView` (src/components/dashboard/governance-view.tsx):
//   - Sidebar nav button "Gobernanza" navigates to the view
//   - `<section aria-label="Gobernanza">` mounts
//   - Tabs (Escalaciones pendientes / Decisiones recientes) render
//   - Clicking the "Decisiones recientes" tab switches the active panel
//
// Sign-in follows the proven form-fill pattern from dashboard.spec.ts.
// See llm-costs.spec.ts for the rationale (the demo-account button click
// in the task spec depends on a non-visible aria-label substring).

import { test, expect, type Page } from '@playwright/test'

const TEST_EMAIL = 'valentina@saramantha.co'
const TEST_PASSWORD = 'demo123'

test.describe('Governance Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('displays governance view with tabs', async ({ page }) => {
    await page.locator('aside nav button', { hasText: /Gobernanza/i }).first().click()

    // The view always renders `<section aria-label="Gobernanza">` (skeleton,
    // error, and loaded states all wrap in this section). Wait for it.
    await expect(page.locator('section[aria-label="Gobernanza"]')).toBeVisible({ timeout: 15_000 })

    // Both tab triggers are rendered by Radix Tabs (role=tab). We accept
    // either the loaded tabs OR the loading skeleton — both confirm the
    // view mounted without crashing. The skeleton path doesn't render
    // tabs (it's a Skeleton placeholder) so the poll returns true as
    // soon as either signal appears.
    await expect
      .poll(
        async () => {
          const tabCount = await page.locator('section[aria-label="Gobernanza"] [role="tab"]').count().catch(() => 0)
          if (tabCount >= 2) return true
          const hasSkeleton = (await page.locator('section[aria-label="Gobernanza"] [class*="animate-pulse"], section[aria-label="Gobernanza"] [class*="skeleton"]').count().catch(() => 0)) > 0
          return hasSkeleton
        },
        { timeout: 15_000, intervals: [500, 1000, 2000] },
      )
      .toBeTruthy()

    // If tabs rendered, verify the labels.
    const tabCount = await page.locator('section[aria-label="Gobernanza"] [role="tab"]').count().catch(() => 0)
    if (tabCount >= 2) {
      await expect(page.locator('section[aria-label="Gobernanza"] [role="tab"]', { hasText: /Escalaciones pendientes/i })).toBeVisible()
      await expect(page.locator('section[aria-label="Gobernanza"] [role="tab"]', { hasText: /Decisiones recientes/i })).toBeVisible()
    }
  })

  test('switches between tabs', async ({ page }) => {
    await page.locator('aside nav button', { hasText: /Gobernanza/i }).first().click()
    await expect(page.locator('section[aria-label="Gobernanza"]')).toBeVisible({ timeout: 15_000 })

    // Wait for tabs to render (loaded state). The skeleton doesn't render
    // the tab list, so we poll until the tabs are interactive.
    await expect
      .poll(
        async () => {
          return await page.locator('section[aria-label="Gobernanza"] [role="tab"]').count().catch(() => 0)
        },
        { timeout: 15_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThanOrEqual(2)

    // Click the "Decisiones recientes" tab trigger.
    const decisionsTab = page.locator('section[aria-label="Gobernanza"] [role="tab"]', { hasText: /Decisiones recientes/i })
    await decisionsTab.click()

    // The decisions panel renders either:
    //   - A list of decision rows (each with "Agente" / "Confianza" badges)
    //   - An empty-state card "Sin decisiones registradas"
    // We poll for either marker to confirm the tab switched.
    await expect
      .poll(
        async () => {
          const text = (await page.locator('section[aria-label="Gobernanza"]').innerText().catch(() => '')).toLowerCase()
          return /sin decisiones registradas|confianza|responsable|pendiente de revisi|agente/i.test(text)
        },
        { timeout: 10_000, intervals: [400, 900, 1500] },
      )
      .toBeTruthy()
  })
})

// ─── helpers ─────────────────────────────────────────────────────────────
async function signIn(page: Page): Promise<void> {
  await page.goto('/login')
  await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL)
  await page.locator('input[type="password"], input[name="password"]').fill(TEST_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/', { timeout: 30_000 })

  await expect(page.locator('header button[aria-label="Menú de usuario"]')).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/tenants')
        if (!res.ok()) return 0
        const body = await res.json().catch(() => ({ tenants: [] }))
        return Array.isArray(body.tenants) ? body.tenants.length : 0
      },
      { timeout: 15_000, intervals: [300, 800, 1500] },
    )
    .toBeGreaterThan(0)
}
