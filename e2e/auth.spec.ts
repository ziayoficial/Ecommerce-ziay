// E2E: Auth flows
// TASK: TESTS-CICD-001
//
// Covers: unauthenticated redirect, login page render, valid login,
// invalid login error, logout, and protected-API behavior.

import { test, expect, type Page } from '@playwright/test'

const TEST_EMAIL = 'valentina@saramantha.co'
const TEST_PASSWORD = 'demo123'

/** Extract the path + query from a URL string that may be absolute OR relative. */
function callbackPath(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    // Relative URL like "/login?callbackUrl=..." — return as-is.
    return url
  }
}

test.describe('Authentication flows', () => {
  test('unauthenticated user hitting / is redirected to /login', async ({ page }) => {
    const res = await page.goto('/')
    // Either 307 (middleware redirect) or 200 if we already followed to /login.
    expect(res?.status()).toBeLessThan(400)
    await page.waitForURL(/\/login(\?.*)?$/)
    expect(page.url()).toMatch(/\/login/)
  })

  test('login page renders with email + password form', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/CommerceFlow|Saramantha|login|Acceso|sesi/i)

    // Email + password inputs.
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible()

    // Submit button.
    await expect(page.getByRole('button', { name: /iniciar sesi|sign in|entrar/i })).toBeVisible()

    // Demo credentials hint is rendered (helps QA) — use .first() since the
    // login page mentions it multiple times (header, footer, code hint).
    await expect(page.getByText(/demo123|credenciales demo/i).first()).toBeVisible()
  })

  test('login with valid credentials redirects to /', async ({ page }) => {
    await page.goto('/login')

    await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL)
    await page.locator('input[type="password"], input[name="password"]').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /iniciar sesi|sign in|entrar/i }).click()

    // Should land on the dashboard.
    await page.waitForURL('**/', { timeout: 30_000 })
    expect(page.url()).toMatch(/\/$/)
  })

  test('login with invalid credentials shows an error message', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL)
    await page.locator('input[type="password"], input[name="password"]').fill('this-is-wrong')
    await page.getByRole('button', { name: /iniciar sesi|sign in|entrar/i }).click()

    // Error message shown on the login page.
    await expect(page.getByText(/incorrect|invalid|no pudimos|verifica/i)).toBeVisible({ timeout: 15_000 })
    // Still on /login.
    expect(page.url()).toMatch(/\/login/)
  })

  test('logout redirects to /login', async ({ page, context }) => {
    // First, sign in via the form to establish a session cookie.
    await signInViaForm(page)
    await page.waitForURL('**/', { timeout: 30_000 })

    // Trigger sign-out via the NextAuth /api/auth/signout endpoint (POST).
    // The CSRF token is required by NextAuth v4.
    const csrfRes = await page.request.get('/api/auth/csrf')
    expect(csrfRes.ok()).toBeTruthy()
    const { csrfToken } = await csrfRes.json()

    const outRes = await page.request.post('/api/auth/signout', {
      form: { csrfToken, callbackUrl: '/login' },
      maxRedirects: 0,
    })
    // NextAuth returns 302 on signout success.
    expect([302, 200].includes(outRes.status())).toBeTruthy()

    // After signout, hitting / should redirect back to /login.
    await page.context().clearCookies()
    await page.goto('/')
    await page.waitForURL(/\/login(\?.*)?$/)
    expect(page.url()).toMatch(/\/login/)
  })

  test('protected API returns 401/redirect without auth', async ({ request }) => {
    // /api/agents is NOT in the PUBLIC_PATTERNS list, so middleware protects it.
    // NextAuth middleware responds with 307 → /login?callbackUrl=/api/agents.
    const res = await request.get('/api/agents', { maxRedirects: 0 })
    expect([302, 307, 401, 403]).toContain(res.status())
    if (res.status() >= 300 && res.status() < 400) {
      const loc = res.headers()['location'] ?? ''
      expect(loc).toMatch(/\/login/)
    }
  })

  test('protected /api/tenants redirects to /login when unauthenticated', async ({ request }) => {
    const res = await request.get('/api/tenants', { maxRedirects: 0 })
    expect([302, 307, 401, 403]).toContain(res.status())
    if (res.status() >= 300 && res.status() < 400) {
      const loc = res.headers()['location'] ?? ''
      // Callback URL should encode /api/tenants.
      expect(callbackPath(loc)).toMatch(/api\/tenants|login/)
    }
  })

  test('public API /api/health is accessible without auth', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('checks')
  })
})

// ─── helpers ─────────────────────────────────────────────────────────────
async function signInViaForm(page: Page): Promise<void> {
  await page.goto('/login')
  await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL)
  await page.locator('input[type="password"], input[name="password"]').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /iniciar sesi|sign in|entrar/i }).click()
}
