import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { walletService } from '@/lib/services'

const log = getLogger('api/trafficker')

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
    const trafficker = await walletService.getTraffickerProfile(traffickerId)

    if (!trafficker) {
      return NextResponse.json(
        { error: 'Trafficker not found' },
        { status: 404 },
      )
    }

    // Aggregate sales stats
    const { sales, stats: salesStats } = await walletService.getSalesStats(traffickerId)

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

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action } = body ?? {}
  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }

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

async function registerTrafficker(body: any) {
  const { email, name, phone } = body
  if (!email || !name) {
    return NextResponse.json(
      { error: 'email and name are required' },
      { status: 400 },
    )
  }
  // Pre-check for duplicate email — service create would throw, but a
  // friendly 409 with the existing row is more useful.
  const existing = await walletService.getTraffickerByEmail(String(email))
  if (existing) {
    return NextResponse.json(
      { error: 'A trafficker with that email already exists', trafficker: existing },
      { status: 409 },
    )
  }
  const trafficker = await walletService.createTrafficker({
    email: String(email),
    name: String(name),
    phone: phone ?? null,
  })
  return NextResponse.json({ trafficker })
}

async function createCampaign(body: any) {
  const { traffickerId, tenantId, name, platform, budget, startDate, endDate } =
    body
  if (!traffickerId || !tenantId || !name || !platform || budget == null) {
    return NextResponse.json(
      {
        error:
          'traffickerId, tenantId, name, platform, budget are required',
      },
      { status: 400 },
    )
  }
  const validPlatforms = ['meta', 'google', 'tiktok']
  if (!validPlatforms.includes(platform)) {
    return NextResponse.json(
      { error: `platform must be one of: ${validPlatforms.join(', ')}` },
      { status: 400 },
    )
  }
  // Verify trafficker exists and is active
  const trafficker = await walletService.getTraffickerById(traffickerId)
  if (!trafficker) {
    return NextResponse.json(
      { error: 'Trafficker not found' },
      { status: 404 },
    )
  }
  const campaign = await walletService.createCampaign({
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

async function registerSale(body: any) {
  const { traffickerId, tenantId, campaignId, orderId, amount, commission } =
    body
  if (
    !traffickerId ||
    !tenantId ||
    !campaignId ||
    amount == null ||
    commission == null
  ) {
    return NextResponse.json(
      {
        error:
          'traffickerId, tenantId, campaignId, amount, commission are required',
      },
      { status: 400 },
    )
  }
  // Verify campaign belongs to this trafficker
  const campaign = await walletService.getCampaignForTrafficker(campaignId, traffickerId, tenantId)
  if (!campaign) {
    return NextResponse.json(
      { error: 'Campaign not found for this trafficker+tenant' },
      { status: 404 },
    )
  }
  const sale = await walletService.registerSale({
    traffickerId,
    tenantId,
    campaignId,
    orderId: orderId ?? null,
    amount: Number(amount),
    commission: Number(commission),
  })
  return NextResponse.json({ sale })
}

async function confirmSale(body: any) {
  const { saleId } = body
  if (!saleId) {
    return NextResponse.json(
      { error: 'saleId is required' },
      { status: 400 },
    )
  }
  const sale = await walletService.getSaleWithCampaign(saleId)
  if (!sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  }
  if (sale.status !== 'pending') {
    return NextResponse.json(
      { error: `Sale is already in status '${sale.status}'` },
      { status: 409 },
    )
  }

  const result = await walletService.confirmSale(saleId)
  log.info(
    { saleId, traffickerId: sale.traffickerId, commission: sale.commission },
    'sale confirmed — wallet credited',
  )
  return NextResponse.json(result)
}

async function failSale(body: any) {
  const { saleId, reason } = body
  if (!saleId) {
    return NextResponse.json(
      { error: 'saleId is required' },
      { status: 400 },
    )
  }

  const validReasons = Object.keys(COMPENSATION_RATES)
  const failReason = reason && validReasons.includes(reason) ? reason : 'seller_no_ship'
  const compPct = COMPENSATION_RATES[failReason]

  const sale = await walletService.getSaleWithCampaign(saleId)
  if (!sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  }
  if (sale.status === 'confirmed' || sale.status === 'compensated') {
    return NextResponse.json(
      { error: `Cannot fail a sale already in status '${sale.status}'` },
      { status: 409 },
    )
  }

  const result = await walletService.failSale(saleId, failReason, compPct)
  log.info(
    { saleId, traffickerId: sale.traffickerId, reason: failReason, compensation: result.compensationAmount },
    'sale failed + compensation credited',
  )
  return NextResponse.json(result)
}

async function withdraw(body: any) {
  const { traffickerId, amount, walletAccountId, totpCode } = body
  if (!traffickerId || amount == null || !walletAccountId) {
    return NextResponse.json(
      {
        error: 'traffickerId, amount, walletAccountId are required',
      },
      { status: 400 },
    )
  }
  const trafficker = await walletService.getTraffickerById(traffickerId)
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

  const result = await walletService.requestWithdrawal({
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
