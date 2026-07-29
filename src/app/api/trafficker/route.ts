import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { verifyTOTP } from '@/lib/totp'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getLogger } from '@/lib/logger'
import { walletService, traffickerService } from '@/lib/services'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import type { Session } from 'next-auth'

const log = getLogger('api/trafficker')

/**
 * Verify that the caller may operate on this trafficker's data.
 * Allowed: the trafficker themselves (email match) OR a platform
 * admin/finance operator. Returns a NextResponse error to `return` when
 * forbidden, or `null` when access is granted.
 */
function authorizeTraffickerAccess(
  session: Session | null,
  traffickerEmail: string,
): NextResponse | null {
  const callerEmail = session?.user?.email
  const callerRole = session?.user?.role
  const isSelf =
    !!callerEmail &&
    traffickerEmail.toLowerCase() === callerEmail.toLowerCase()
  const isPrivileged = callerRole === 'admin' || callerRole === 'finance'
  if (!isSelf && !isPrivileged) {
    return NextResponse.json(
      { error: 'Forbidden: not your profile' },
      { status: 403 },
    )
  }
  return null
}

// ───────────────────────────────────────────────────────────────────────────
// Body schemas (per-action discriminated union)
// ───────────────────────────────────────────────────────────────────────────

const RegisterTraffickerSchema = z.object({
  action: z.literal('register'),
  email: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
})

const CreateCampaignSchema = z.object({
  action: z.literal('create_campaign'),
  traffickerId: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  platform: z.enum(['meta', 'google', 'tiktok']),
  budget: z.union([z.number(), z.string()]),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
})

const RegisterSaleSchema = z.object({
  action: z.literal('register_sale'),
  traffickerId: z.string().min(1),
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  orderId: z.string().nullable().optional(),
  amount: z.union([z.number(), z.string()]),
  commission: z.union([z.number(), z.string()]),
})

const ConfirmSaleSchema = z.object({
  action: z.literal('confirm_sale'),
  saleId: z.string().min(1),
})

const FailSaleSchema = z.object({
  action: z.literal('fail_sale'),
  saleId: z.string().min(1),
  reason: z.string().optional(),
})

const WithdrawSchema = z.object({
  action: z.literal('withdraw'),
  traffickerId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  walletAccountId: z.string().min(1),
  totpCode: z.string().optional(),
})

const TraffickerBodySchema = z.discriminatedUnion('action', [
  RegisterTraffickerSchema,
  CreateCampaignSchema,
  RegisterSaleSchema,
  ConfirmSaleSchema,
  FailSaleSchema,
  WithdrawSchema,
])

// GET /api/trafficker?traffickerId=X
// Devuelve el perfil del trafficker + wallet balance + campaigns + sales +
// transactions recientes.
//
// SPRINT8-SERVICES-REST-001 — migrated the trafficker profile lookup
// (include campaigns/transactions/compensations) + the sales stats
// aggregation to `walletService`. Response shape unchanged.
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapped with `withErrorHandling` so any
// unhandled exception is funneled through Sentry + the structured pino
// logger. The previous manual `try/catch` boilerplate (captureError +
// NextResponse.json 500) is now the wrapper's responsibility.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const { session, error } = await requireAuth()
  if (error) return error

  const traffickerId = req.nextUrl.searchParams.get('traffickerId')
  if (!traffickerId) {
    return NextResponse.json(
      { error: 'traffickerId is required' },
      { status: 400 },
    )
  }

  const trafficker = await traffickerService.getTraffickerProfile(traffickerId)

  if (!trafficker) {
    return NextResponse.json(
      { error: 'Trafficker not found' },
      { status: 404 },
    )
  }

  // FIX-SECURITY-AUTH-001 (#13) — ownership check. Any authed user used to
  // be able to read any trafficker's wallet balance / campaigns / sales.
  // Now restricted to self (email match) or admin/finance.
  const forbidden = authorizeTraffickerAccess(session, trafficker.email)
  if (forbidden) return forbidden

  // Aggregate sales stats
  const { sales, stats: salesStats } = await traffickerService.getSalesStats(traffickerId)

  return NextResponse.json({
    trafficker: {
      id: trafficker.id,
      email: trafficker.email,
      name: trafficker.name,
      phone: trafficker.phone,
      walletBalance: trafficker.walletBalance,
      status: trafficker.status,
      createdAt: trafficker.createdAt,
      updatedAt: trafficker.updatedAt,
    },
    campaigns: trafficker.campaigns,
    transactions: trafficker.transactions,
    compensations: trafficker.compensations,
    sales,
    salesStats,
  })
})

// POST /api/trafficker
// Acciones (body.action):
//   - register            : { action, email, name, phone? }
//   - create_campaign     : { action, traffickerId, tenantId, name, platform, budget, startDate?, endDate? }
//   - register_sale       : { action, traffickerId, tenantId, campaignId, orderId?, amount, commission }
//   - confirm_sale        : { action, saleId }
//   - fail_sale           : { action, saleId, reason? }
//   - withdraw            : { action, traffickerId, amount, walletAccountId, totpCode? }
//
// SPRINT8-SERVICES-REST-001 — migrated every Trafficker / TraffickerCampaign /
// TraffickerSale / TraffickerCompensation / TraffickerTransaction /
// WalletTransaction / WithdrawalRequest read+write to `walletService`.
// Response shapes unchanged.
// SPRINT-ADOPT-ERRORHANDLER-001 — wrapped with `withErrorHandling`. The
// inner try/catch around `req.json()` is preserved (returns 400 for invalid
// JSON — a custom business-rule response). The outer try/catch around the
// action switch was pure boilerplate (captureError + 500) — now replaced by
// the wrapper.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const limited = rateLimit(req, {
    max: 60,
    windowMs: 60_000,
    namespace: 'api:trafficker:post',
  })
  if (limited) return limited

  const { session, error } = await requireAuth()
  if (error) return error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = TraffickerBodySchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const action = body.action

  switch (action) {
    case 'register':
      return await registerTrafficker(body)
    case 'create_campaign':
      return await createCampaign(body)
    case 'register_sale':
      return await registerSale(body)
    case 'confirm_sale':
      return await confirmSale(body)
    case 'fail_sale':
      return await failSale(body)
    case 'withdraw':
      return await withdraw(body, session)
    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      )
  }
})

// ───────────────────────────────────────────────────────────────────────────
// Action handlers
// ───────────────────────────────────────────────────────────────────────────

// Compensation rates when seller fails (Saramantha §17.8)
const COMPENSATION_RATES: Record<string, number> = {
  seller_no_ship: 1.0,      // 100% of commission
  seller_delayed: 0.5,      // 50% of commission
  seller_cancelled: 1.0,    // 100% of commission
  delivery_failed: 0.5,     // 50% of commission
  product_damaged: 0.25,    // 25% of commission
}

async function registerTrafficker(body: z.infer<typeof RegisterTraffickerSchema>) {
  const { email, name, phone } = body
  // Pre-check for duplicate email — service create would throw, but a
  // friendly 409 with the existing row is more useful.
  const existing = await traffickerService.getTraffickerByEmail(email)
  if (existing) {
    return NextResponse.json(
      { error: 'A trafficker with that email already exists', trafficker: existing },
      { status: 409 },
    )
  }
  const trafficker = await traffickerService.createTrafficker({
    email,
    name,
    phone: phone ?? null,
  })
  return NextResponse.json({ trafficker })
}

async function createCampaign(body: z.infer<typeof CreateCampaignSchema>) {
  const { traffickerId, tenantId, name, platform, budget, startDate, endDate } = body
  // Verify trafficker exists and is active
  const trafficker = await traffickerService.getTraffickerById(traffickerId)
  if (!trafficker) {
    return NextResponse.json(
      { error: 'Trafficker not found' },
      { status: 404 },
    )
  }
  const campaign = await traffickerService.createCampaign({
    traffickerId,
    tenantId,
    name,
    platform,
    budget: Number(budget),
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
  })
  return NextResponse.json({ campaign })
}

async function registerSale(body: z.infer<typeof RegisterSaleSchema>) {
  const { traffickerId, tenantId, campaignId, orderId, amount, commission } = body
  // Verify campaign belongs to this trafficker
  const campaign = await traffickerService.getCampaignForTrafficker(campaignId, traffickerId, tenantId)
  if (!campaign) {
    return NextResponse.json(
      { error: 'Campaign not found for this trafficker+tenant' },
      { status: 404 },
    )
  }
  const sale = await traffickerService.registerSale({
    traffickerId,
    tenantId,
    campaignId,
    orderId: orderId ?? null,
    amount: Number(amount),
    commission: Number(commission),
  })
  return NextResponse.json({ sale })
}

async function confirmSale(body: z.infer<typeof ConfirmSaleSchema>) {
  const { saleId } = body
  const sale = await traffickerService.getSaleWithCampaign(saleId)
  if (!sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  }
  if (sale.status !== 'pending') {
    return NextResponse.json(
      { error: `Sale is already in status '${sale.status}'` },
      { status: 409 },
    )
  }

  const result = await traffickerService.confirmSale(saleId)
  log.info(
    { saleId, traffickerId: sale.traffickerId, commission: sale.commission },
    'sale confirmed — wallet credited',
  )
  return NextResponse.json(result)
}

async function failSale(body: z.infer<typeof FailSaleSchema>) {
  const { saleId, reason } = body

  const validReasons = Object.keys(COMPENSATION_RATES)
  const failReason = reason && validReasons.includes(reason) ? reason : 'seller_no_ship'
  const compPct = COMPENSATION_RATES[failReason]

  const sale = await traffickerService.getSaleWithCampaign(saleId)
  if (!sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  }
  if (sale.status === 'confirmed' || sale.status === 'compensated') {
    return NextResponse.json(
      { error: `Cannot fail a sale already in status '${sale.status}'` },
      { status: 409 },
    )
  }

  const result = await traffickerService.failSale(saleId, failReason, compPct)
  log.info(
    { saleId, traffickerId: sale.traffickerId, reason: failReason, compensation: result.compensationAmount },
    'sale failed + compensation credited',
  )
  return NextResponse.json(result)
}

async function withdraw(body: z.infer<typeof WithdrawSchema>, session: Session | null) {
  const { traffickerId, amount, walletAccountId, totpCode } = body
  const trafficker = await traffickerService.getTraffickerById(traffickerId)
  if (!trafficker) {
    return NextResponse.json(
      { error: 'Trafficker not found' },
      { status: 404 },
    )
  }

  // FIX-SECURITY-AUTH-001 (#13) — ownership check. The withdraw action is
  // financial: any authed user used to be able to withdraw on any trafficker's
  // behalf by passing an arbitrary non-empty `totpCode`. Now restricted to
  // self (email match) or admin/finance.
  const forbidden = authorizeTraffickerAccess(session, trafficker.email)
  if (forbidden) return forbidden

  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json(
      { error: 'amount must be a positive number' },
      { status: 400 },
    )
  }
  if (trafficker.walletBalance < amt) {
    return NextResponse.json(
      {
        error: 'Insufficient balance',
        balance: trafficker.walletBalance,
        requested: amt,
      },
      { status: 400 },
    )
  }
  const walletAccount = await walletService.getWalletAccount(walletAccountId)
  if (!walletAccount || walletAccount.traffickerId !== traffickerId) {
    return NextResponse.json(
      { error: 'Wallet account not found for this trafficker' },
      { status: 404 },
    )
  }

  // FIX-SECURITY-AUTH-001 (#5, P0 financial theft) — REAL TOTP verification.
  // Previously `totpVerified = !!totpCode` accepted any non-empty string as
  // a valid 2FA code, allowing an attacker to withdraw funds without the
  // authenticator. Now we look up the trafficker's TwoFactorConfig and call
  // `verifyTOTP(totpCode, cfg.secret)` — only a code that decrypts + matches
  // the TOTP window flips `totpVerified=true`.
  //
  // If 2FA is not enabled, the withdrawal stays in `pending_2fa` state so
  // an admin/finance operator must explicitly process it via
  // `/api/wallet action=process_withdrawal` (which now requires admin/finance
  // role — see /api/wallet/route.ts).
  const cfg = await walletService.getTwoFactorConfig(traffickerId)
  const totpRequired = cfg?.enabled ?? false
  let totpVerified = false
  if (totpRequired) {
    if (!totpCode) {
      return NextResponse.json(
        { error: 'Código 2FA requerido' },
        { status: 400 },
      )
    }
    if (!verifyTOTP(String(totpCode), cfg!.secret)) {
      return NextResponse.json(
        { error: 'Código 2FA inválido' },
        { status: 400 },
      )
    }
    totpVerified = true
  }

  const fee = 0 // platform covers withdrawal fees for now
  const netAmount = amt - fee

  const result = await traffickerService.requestWithdrawal({
    traffickerId,
    walletAccountId,
    amount: amt,
    fee,
    netAmount,
    totpVerified,
    balanceBefore: trafficker.walletBalance,
    accountType: walletAccount.accountType,
    accountNumber: walletAccount.accountNumber,
  })

  log.info(
    {
      traffickerId,
      amount: amt,
      walletAccountId,
      withdrawalId: result.withdrawal.id,
      totpVerified,
    },
    'withdrawal requested',
  )
  return NextResponse.json(result)
}
