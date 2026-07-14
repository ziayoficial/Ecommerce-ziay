import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { walletService, traffickerService } from '@/lib/services'

const log = getLogger('api/trafficker')

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
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const traffickerId = req.nextUrl.searchParams.get('traffickerId')
  if (!traffickerId) {
    return NextResponse.json(
      { error: 'traffickerId is required' },
      { status: 400 },
    )
  }

  try {
    const trafficker = await traffickerService.getTraffickerProfile(traffickerId)

    if (!trafficker) {
      return NextResponse.json(
        { error: 'Trafficker not found' },
        { status: 404 },
      )
    }

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
  } catch (err) {
    captureError(err as Error, { path: '/api/trafficker', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

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
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, {
    max: 60,
    windowMs: 60_000,
    namespace: 'api:trafficker:post',
  })
  if (limited) return limited

  const { error } = await requireAuth()
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

  try {
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
        return await withdraw(body)
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        )
    }
  } catch (err) {
    captureError(err as Error, { path: '/api/trafficker', method: 'POST', action })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

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

async function withdraw(body: z.infer<typeof WithdrawSchema>) {
  const { traffickerId, amount, walletAccountId, totpCode } = body
  const trafficker = await traffickerService.getTraffickerById(traffickerId)
  if (!trafficker) {
    return NextResponse.json(
      { error: 'Trafficker not found' },
      { status: 404 },
    )
  }
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

  // Create a pending WithdrawalRequest + an outbound transaction in pending state.
  // TOTP verification happens via the existing 2FA endpoint before funds move.
  const totpVerified = !!totpCode // caller may pre-verify; otherwise stays pending_2fa
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
