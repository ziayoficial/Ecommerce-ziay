// Unit tests for src/app/api/trafficker/route.ts — authorization matrix
// TASK: AUDIT-CYCLE-4-H1
//
// AUDIT-CYCLE-4-H1 closed a High finding: POST /api/trafficker dispatch
// only gated `withdraw` with `authorizeTraffickerAccess` — the other five
// actions (register, create_campaign, register_sale, confirm_sale,
// fail_sale) were executable by ANY authenticated user of ANY role.
// `confirm_sale`/`fail_sale` credit the trafficker's wallet, so a
// non-privileged caller could credit wallets at will.
//
// This suite verifies the authorization matrix now enforced per action:
//   - register          : self (own email) or admin/finance
//   - create_campaign   : self (email match) or admin/finance
//   - register_sale     : self (email match) or admin/finance
//   - confirm_sale      : admin/finance ONLY (wallet-crediting)
//   - fail_sale         : admin/finance ONLY (compensation-crediting)
//
// Mock strategy mirrors tests/unit/agents-route.test.ts: auth-helpers
// (configurable session), services (wallet/trafficker), rate-limit bypass,
// logger, Sentry.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock: auth-helpers ───────────────────────────────────────────────────
const { authMock } = vi.hoisted(() => ({
  authMock: {
    requireAuth: vi.fn(),
    requireTenantAccess: vi.fn(),
  },
}))
vi.mock('@/lib/auth-helpers', () => authMock)

// ── Mock: services (wallet + trafficker) ────────────────────────────────
const { walletServiceMock, traffickerServiceMock } = vi.hoisted(() => ({
  walletServiceMock: {
    getWalletAccount: vi.fn(),
    getTwoFactorConfig: vi.fn(),
  },
  traffickerServiceMock: {
    getTraffickerProfile: vi.fn(),
    getSalesStats: vi.fn(),
    getTraffickerByEmail: vi.fn(),
    getTraffickerById: vi.fn(),
    createTrafficker: vi.fn(),
    createCampaign: vi.fn(),
    getCampaignForTrafficker: vi.fn(),
    registerSale: vi.fn(),
    getSaleWithCampaign: vi.fn(),
    confirmSale: vi.fn(),
    failSale: vi.fn(),
    requestWithdrawal: vi.fn(),
  },
}))
vi.mock('@/lib/services', () => ({
  walletService: walletServiceMock,
  traffickerService: traffickerServiceMock,
}))

// ── Mock: rate-limit (bypass in-memory state) ───────────────────────────
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(() => null),
}))

// ── Mock: totp (withdraw path dependency — not exercised here) ──────────
vi.mock('@/lib/totp', () => ({
  verifyTOTP: vi.fn(() => true),
}))

// ── Mock: logger ────────────────────────────────────────────────────────
const { loggerMock } = vi.hoisted(() => {
  const m: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
    child: () => unknown
  } = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => m,
  }
  return { loggerMock: m }
})
vi.mock('@/lib/logger', () => ({
  getLogger: () => loggerMock,
  logger: loggerMock,
  default: loggerMock,
}))

// ── Mock: Sentry (withErrorHandling imports it) ─────────────────────────
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

// ── Import the route handler AFTER all mocks are in place ───────────────
import { POST } from '@/app/api/trafficker/route'

// ── Helpers ──────────────────────────────────────────────────────────────
const TRAFFICKER_EMAIL = 'sebastian@trafficker.co'

function buildReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/trafficker', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** withErrorHandling returns a 2-arg signature `(req, ctx)`; for routes
 * without a dynamic ctx we pass a void 2nd arg — same pattern as
 * compliance-edge-cases.test.ts (`undefined as never`). */
function post(body: Record<string, unknown>) {
  return POST(buildReq(body), undefined as never)
}

function setSession(overrides: { email?: string | null; role: string }) {
  authMock.requireAuth.mockResolvedValue({
    session: {
      user: {
        id: 'user-1',
        email: overrides.email ?? null,
        role: overrides.role,
        tenantId: null,
      },
    },
    error: null,
  })
}

// ── Test setup ───────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()

  // Default: authenticated agent (least privileged tenant-side role).
  setSession({ email: 'some.agent@saramantha.co', role: 'agent' })

  // Default service mocks — a pending sale owned by the seeded trafficker.
  traffickerServiceMock.getTraffickerById.mockResolvedValue({
    id: 'traf-1',
    email: TRAFFICKER_EMAIL,
    name: 'Sebastian',
    walletBalance: 500_000,
  })
  traffickerServiceMock.getSaleWithCampaign.mockResolvedValue({
    id: 'sale-1',
    traffickerId: 'traf-1',
    status: 'pending',
    commission: 20_000,
  })
  traffickerServiceMock.getTraffickerByEmail.mockResolvedValue(null)
  traffickerServiceMock.getCampaignForTrafficker.mockResolvedValue({ id: 'camp-1' })
  traffickerServiceMock.createTrafficker.mockResolvedValue({
    id: 'traf-new',
    email: 'new@trafficker.co',
  })
  traffickerServiceMock.createCampaign.mockResolvedValue({ id: 'camp-new' })
  traffickerServiceMock.registerSale.mockResolvedValue({ id: 'sale-new' })
  traffickerServiceMock.confirmSale.mockResolvedValue({ sale: { id: 'sale-1' } })
  traffickerServiceMock.failSale.mockResolvedValue({ compensationAmount: 10_000 })
})

// ─────────────────────────────────────────────────────────────────────────
// confirm_sale — admin/finance ONLY (wallet-crediting action)
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/trafficker · confirm_sale authorization (AUDIT-CYCLE-4-H1)', () => {
  it('403s when the caller is the trafficker themselves (no self-crediting wallets)', async () => {
    setSession({ email: TRAFFICKER_EMAIL, role: 'trafficker' })
    const res = await post({ action: 'confirm_sale', saleId: 'sale-1' })
    expect(res.status).toBe(403)
    expect(traffickerServiceMock.confirmSale).not.toHaveBeenCalled()
  })

  it('403s when the caller is a tenant agent', async () => {
    const res = await post({ action: 'confirm_sale', saleId: 'sale-1' })
    expect(res.status).toBe(403)
    expect(traffickerServiceMock.confirmSale).not.toHaveBeenCalled()
  })

  it('200s and credits the wallet when the caller is admin', async () => {
    setSession({ email: 'admin@saramantha.co', role: 'admin' })
    const res = await post({ action: 'confirm_sale', saleId: 'sale-1' })
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.confirmSale).toHaveBeenCalledWith('sale-1')
  })

  it('200s when the caller is finance', async () => {
    setSession({ email: 'finance@ziay.co', role: 'finance' })
    const res = await post({ action: 'confirm_sale', saleId: 'sale-1' })
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.confirmSale).toHaveBeenCalledWith('sale-1')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// fail_sale — admin/finance ONLY (compensation credits the wallet)
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/trafficker · fail_sale authorization (AUDIT-CYCLE-4-H1)', () => {
  it('403s when the caller is the trafficker themselves', async () => {
    setSession({ email: TRAFFICKER_EMAIL, role: 'trafficker' })
    const res = await post({ action: 'fail_sale', saleId: 'sale-1', reason: 'seller_no_ship' })
    expect(res.status).toBe(403)
    expect(traffickerServiceMock.failSale).not.toHaveBeenCalled()
  })

  it('200s and credits compensation when the caller is finance', async () => {
    setSession({ email: 'finance@ziay.co', role: 'finance' })
    const res = await post({ action: 'fail_sale', saleId: 'sale-1', reason: 'seller_delayed' })
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.failSale).toHaveBeenCalledWith(
      'sale-1',
      'seller_delayed',
      0.5,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────
// register — self (own email) or admin/finance
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/trafficker · register authorization (AUDIT-CYCLE-4-H1)', () => {
  it('403s when a non-privileged caller registers someone else\'s email (identity squatting)', async () => {
    setSession({ email: 'attacker@evil.co', role: 'agent' })
    const res = await post({
      action: 'register',
      email: TRAFFICKER_EMAIL,
      name: 'Impersonated',
    })
    expect(res.status).toBe(403)
    expect(traffickerServiceMock.createTrafficker).not.toHaveBeenCalled()
  })

  it('200s when the caller self-registers with their own session email', async () => {
    setSession({ email: 'new@trafficker.co', role: 'trafficker' })
    const res = await post({
      action: 'register',
      email: 'new@trafficker.co',
      name: 'New Traffer',
    })
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.createTrafficker).toHaveBeenCalled()
  })

  it('200s when an admin registers a trafficker on their behalf', async () => {
    setSession({ email: 'admin@saramantha.co', role: 'admin' })
    const res = await post({
      action: 'register',
      email: 'onboard@trafficker.co',
      name: 'Onboarded',
    })
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.createTrafficker).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// create_campaign — self (email match) or admin/finance
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/trafficker · create_campaign authorization (AUDIT-CYCLE-4-H1)', () => {
  const campaignBody = {
    action: 'create_campaign',
    traffickerId: 'traf-1',
    tenantId: 'ten-1',
    name: 'Campaña PIJAMAS-Q4',
    platform: 'meta',
    budget: 500_000,
  }

  it('403s when a non-owner non-privileged caller creates a campaign', async () => {
    setSession({ email: 'some.agent@saramantha.co', role: 'agent' })
    const res = await post(campaignBody)
    expect(res.status).toBe(403)
    expect(traffickerServiceMock.createCampaign).not.toHaveBeenCalled()
  })

  it('200s when the trafficker creates their own campaign', async () => {
    setSession({ email: TRAFFICKER_EMAIL, role: 'trafficker' })
    const res = await post(campaignBody)
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.createCampaign).toHaveBeenCalled()
  })

  it('200s when an admin creates a campaign for any trafficker', async () => {
    setSession({ email: 'admin@saramantha.co', role: 'admin' })
    const res = await post(campaignBody)
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.createCampaign).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// register_sale — self (email match) or admin/finance
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/trafficker · register_sale authorization (AUDIT-CYCLE-4-H1)', () => {
  const saleBody = {
    action: 'register_sale',
    traffickerId: 'traf-1',
    tenantId: 'ten-1',
    campaignId: 'camp-1',
    amount: 450_000,
    commission: 22_500,
  }

  it('403s when a non-owner non-privileged caller registers a sale', async () => {
    setSession({ email: 'some.agent@saramantha.co', role: 'agent' })
    const res = await post(saleBody)
    expect(res.status).toBe(403)
    expect(traffickerServiceMock.registerSale).not.toHaveBeenCalled()
  })

  it('200s when the trafficker registers their own sale', async () => {
    setSession({ email: TRAFFICKER_EMAIL, role: 'trafficker' })
    const res = await post(saleBody)
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.registerSale).toHaveBeenCalled()
  })

  it('200s when finance registers a sale on the trafficker\'s behalf', async () => {
    setSession({ email: 'finance@ziay.co', role: 'finance' })
    const res = await post(saleBody)
    expect(res.status).toBe(200)
    expect(traffickerServiceMock.registerSale).toHaveBeenCalled()
  })
})
