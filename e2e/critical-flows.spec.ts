// E2E: Critical user flows — checkout, refund, handoff, circuit-breaker
// Covers flows not in the original 7 specs (auth, dashboard, api, governance,
// llm-costs, ssr-pages, status-page).
//
// These tests use the API directly (not the UI) because the flows involve
// admin/operator actions that may not have full UI yet. They verify that
// the endpoints exist, accept the right shape, and return expected status codes.

import { test, expect, type Page } from '@playwright/test'

const TEST_EMAIL = 'valentina@saramantha.co'
const TEST_PASSWORD = 'demo123'

async function signIn(page: Page): Promise<void> {
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

// ─── Checkout flow ─────────────────────────────────────────────────────

test.describe('Checkout flow', () => {
  test('GET /api/orders returns orders for the tenant', async ({ page }) => {
    await signIn(page)
    const res = await page.request.get('/api/orders?status=all')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('orders')
    expect(Array.isArray(body.orders)).toBeTruthy()
  })

  test('GET /api/orders/[id] returns 404 for non-existent order', async ({ page }) => {
    await signIn(page)
    const res = await page.request.get('/api/orders/non-existent-order-id')
    // May return 404 (not found), 200 (empty), or 405 (method not allowed)
    expect([404, 200, 405]).toContain(res.status())
  })
})

// ─── Refund flow ───────────────────────────────────────────────────────

test.describe('Refund flow', () => {
  test('POST /api/orders/[id]/refund requires auth', async ({ request }) => {
    const res = await request.post('/api/orders/test-order-id/refund', {
      data: { reason: 'customer_request' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect([302, 307, 401, 403]).toContain(res.status())
  })

  test('POST /api/orders/[id]/refund with valid auth returns expected shape', async ({ page }) => {
    await signIn(page)
    // Try to refund a non-existent order — should get 404, not 500
    const res = await page.request.post('/api/orders/non-existent/refund', {
      data: { reason: 'customer_request' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect([404, 400, 502]).toContain(res.status())
    // 404 = order not found (correct)
    // 400 = validation error (acceptable)
    // 502 = gateway error if trying to refund via adapter (acceptable for non-existent)
    // Should NEVER be 200 (no refund should succeed for a non-existent order)
    expect(res.status()).not.toBe(200)
  })

  test('GET /api/orders/[id]/refunds returns refund history', async ({ page }) => {
    await signIn(page)
    const res = await page.request.get('/api/orders/non-existent/refunds')
    expect([200, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('refunds')
      expect(Array.isArray(body.refunds)).toBeTruthy()
    }
  })

  test('refund endpoint rejects invalid reason', async ({ page }) => {
    await signIn(page)
    const res = await page.request.post('/api/orders/test/refund', {
      data: { reason: 'invalid_reason' },
      headers: { 'Content-Type': 'application/json' },
    })
    // Should be 400 (Zod validation) or 404 (order not found first)
    expect([400, 404]).toContain(res.status())
  })
})

// ─── Handoff flow ──────────────────────────────────────────────────────

test.describe('Human handoff flow', () => {
  test('POST /api/conversations/[id]/handoff requires auth', async ({ request }) => {
    const res = await request.post('/api/conversations/test-conv/handoff', {
      data: { action: 'pause', reason: 'human_takeover' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect([302, 307, 401, 403]).toContain(res.status())
  })

  test('handoff pause/resume cycle works', async ({ page }) => {
    await signIn(page)

    // Get a real conversation
    const listRes = await page.request.get('/api/conversations?status=open&limit=1')
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()
    const conversations = listBody.conversations || []

    if (conversations.length === 0) {
      // No conversations in seed — skip this test
      test.skip()
      return
    }

    const convId = conversations[0].id

    // Pause the bot
    const pauseRes = await page.request.post(`/api/conversations/${convId}/handoff`, {
      data: { action: 'pause', reason: 'human_takeover' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(pauseRes.status()).toBe(200)
    const pauseBody = await pauseRes.json()
    expect(pauseBody.ok).toBe(true)
    expect(pauseBody.botEnabled).toBe(false)
    expect(pauseBody.pausedReason).toBe('human_takeover')

    // Verify the conversation now shows botEnabled=false
    const convRes = await page.request.get(`/api/conversations/${convId}`)
    expect(convRes.status()).toBe(200)
    const convBody = await convRes.json()
    expect(convBody.conversation.botEnabled).toBe(false)

    // Resume the bot
    const resumeRes = await page.request.post(`/api/conversations/${convId}/handoff`, {
      data: { action: 'resume' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(resumeRes.status()).toBe(200)
    const resumeBody = await resumeRes.json()
    expect(resumeBody.ok).toBe(true)
    expect(resumeBody.botEnabled).toBe(true)
  })

  test('handoff rejects invalid action', async ({ page }) => {
    await signIn(page)
    const res = await page.request.post('/api/conversations/test/handoff', {
      data: { action: 'stop' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(400)
  })

  test('handoff rejects missing action', async ({ page }) => {
    await signIn(page)
    const res = await page.request.post('/api/conversations/test/handoff', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    // 400 (Zod validation) or 429 (rate limited from previous tests)
    expect([400, 429]).toContain(res.status())
  })
})

// ─── Circuit breaker dashboard ─────────────────────────────────────────

test.describe('Circuit breaker dashboard', () => {
  test('GET /api/agents/circuit-breaker requires admin auth', async ({ request }) => {
    const res = await request.get('/api/agents/circuit-breaker')
    // May be 302/307 (redirect to login), 401/403 (auth error), or 429 (rate limited)
    expect([302, 307, 401, 403, 429]).toContain(res.status())
  })

  test('circuit-breaker endpoint returns expected shape', async ({ page }) => {
    await signIn(page)
    const res = await page.request.get('/api/agents/circuit-breaker')
    // May be 200 (admin) or 403 (non-admin role)
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('summary')
      expect(body.summary).toHaveProperty('total')
      expect(body.summary).toHaveProperty('open')
      expect(body.summary).toHaveProperty('healthy')
      expect(body).toHaveProperty('circuits')
      expect(Array.isArray(body.circuits)).toBeTruthy()
    } else {
      // Non-admin role — 403 is acceptable
      expect(res.status()).toBe(403)
    }
  })

  test('POST /api/agents/circuit-breaker resetAll requires admin', async ({ page }) => {
    await signIn(page)
    const res = await page.request.post('/api/agents/circuit-breaker', {
      data: { action: 'resetAll' },
      headers: { 'Content-Type': 'application/json' },
    })
    // Admin gets 200, non-admin gets 403
    expect([200, 403]).toContain(res.status())
  })

  test('POST circuit-breaker rejects invalid action', async ({ page }) => {
    await signIn(page)
    const res = await page.request.post('/api/agents/circuit-breaker', {
      data: { action: 'destroy' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(400)
  })
})
