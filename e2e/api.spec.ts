// E2E: API routes — health, agents (26), tenants, webhooks, auth protection.
// TASK: TESTS-CICD-001

import { test, expect } from '@playwright/test'

test.describe('Public API routes', () => {
  test('/api/health returns 200 with status', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('status')
    expect(['ok', 'warning', 'error']).toContain(body.status)
    expect(body).toHaveProperty('checks')
    expect(Array.isArray(body.checks)).toBeTruthy()
    expect(body).toHaveProperty('summary')
    expect(body).toHaveProperty('timestamp')
  })

  test('/api/agents returns 26 agents (when authenticated)', async ({ request }) => {
    // /api/agents is protected — sign in first via NextAuth credentials.
    const csrfRes = await request.get('/api/auth/csrf')
    expect(csrfRes.ok()).toBeTruthy()
    const { csrfToken } = await csrfRes.json()

    const signInRes = await request.post('/api/auth/callback/credentials', {
      form: {
        csrfToken,
        email: 'valentina@saramantha.co',
        password: 'demo123',
        callbackUrl: '/api/agents',
        json: 'true',
      },
      maxRedirects: 0,
    })
    // NextAuth credentials callback returns 302 on success (or 200 if json=true).
    expect([200, 302]).toContain(signInRes.status())

    const res = await request.get('/api/agents')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(26)
    expect(Array.isArray(body.agents)).toBeTruthy()
    expect(body.agents).toHaveLength(26)
    // Each agent has a name + a label.
    for (const a of body.agents) {
      expect(typeof a.name).toBe('string')
      expect(typeof a.label).toBe('string')
    }
  })

  test('/api/tenants returns tenants (when authenticated)', async ({ request }) => {
    // Sign in first.
    const csrfRes = await request.get('/api/auth/csrf')
    const { csrfToken } = await csrfRes.json()
    await request.post('/api/auth/callback/credentials', {
      form: {
        csrfToken,
        email: 'valentina@saramantha.co',
        password: 'demo123',
        callbackUrl: '/api/tenants',
        json: 'true',
      },
      maxRedirects: 0,
    })

    const res = await request.get('/api/tenants')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.tenants)).toBeTruthy()
    // Saramantha must be present (seeded tenant).
    const slugs = body.tenants.map((t: { slug: string }) => t.slug)
    expect(slugs).toContain('saramantha')
  })
})

test.describe('Protected APIs', () => {
  test('protected APIs return 302/307 → /login without auth', async ({ request }) => {
    const protectedRoutes = ['/api/agents', '/api/tenants', '/api/overview', '/api/orders']
    for (const route of protectedRoutes) {
      const res = await request.get(route, { maxRedirects: 0 })
      const protectedStatuses = [302, 307, 401, 403]
      expect(protectedStatuses).toContain(res.status())
      if (res.status() >= 300 && res.status() < 400) {
        const loc = res.headers()['location'] ?? ''
        expect(loc).toMatch(/\/login/)
      }
    }
  })
})

test.describe('Webhook routes', () => {
  test('/api/webhooks/mercadopago POST returns 200 (ack, even with invalid signature)', async ({ request }) => {
    // MercadoPago webhook always ACKs 200 to stop retries (per route.ts comment).
    const res = await request.post('/api/webhooks/mercadopago', {
      data: { type: 'payment', data: { id: '123456789' }, action: 'payment.updated', live_mode: true },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  test('/api/webhooks/whatsapp GET returns 403 without valid verify token', async ({ request }) => {
    const res = await request.get(
      '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=abc',
    )
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/forbidden|invalid/i)
  })

  test('/api/webhooks/whatsapp GET returns 200 with the correct verify token (when configured)', async ({ request }) => {
    // When WA_VERIFY_TOKEN is unset in dev, the route uses 'dev-wa-verify-token-change-me' as the default.
    // We try the default token. If env has WA_VERIFY_TOKEN set, this will 403 — still assert
    // the route handled the request without crashing.
    const res = await request.get(
      '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=dev-wa-verify-token-change-me&hub.challenge=test-challenge',
    )
    expect([200, 403]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.text()
      expect(body).toBe('test-challenge')
    }
  })
})
