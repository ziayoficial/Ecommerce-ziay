// E2E helpers - shared sign-in + constants. Task ID: E2E-RATELIMIT-FIX-001
import { expect, type Page } from '@playwright/test'
export const TEST_EMAIL = 'valentina@saramantha.co'
export const TEST_PASSWORD = 'demo123'
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login')
  await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL)
  await page.locator('input[type="password"], input[name="password"]').fill(TEST_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/', { timeout: 30_000 })
  await expect(page.locator('header button[aria-label="Menú de usuario"]')).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/tenants')
        if (!res.ok()) return 0
        const body = await res.json().catch(() => ({ tenants: [] }))
        return Array.isArray(body.tenants) ? body.tenants.length : 0
      },
      { timeout: 30_000, intervals: [500, 1000, 2000, 3000] },
    )
    .toBeGreaterThan(0)
}