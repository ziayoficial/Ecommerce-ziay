import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { getLogger } from '@/lib/logger'

const log = getLogger('api/trafficker')

// GET /api/trafficker?traffickerId=X
// Devuelve el perfil del trafficker + wallet balance + campaigns + sales +
// transactions recientes.
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

  const trafficker = await db.trafficker.findUnique({
    where: { id: traffickerId },
    include: {
      campaigns: {
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      compensations: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  })

  if (!trafficker) {
    return NextResponse.json(
      { error: 'Trafficker not found' },
      { status: 404 },
    )
  }

  // Aggregate sales stats
  const sales = await db.traffickerSale.findMany({
    where: { traffickerId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const salesStats = {
    total: sales.length,
    pending: sales.filter((s) => s.status === 'pending').length,
    confirmed: sales.filter((s) => s.status === 'confirmed').length,
    failed: sales.filter((s) => s.status === 'failed').length,
    compensated: sales.filter((s) => s.status === 'compensated').length,
    totalAmount: sales.reduce((sum, s) => sum + s.amount, 0),
    totalCommission: sales.reduce((sum, s) => sum + s.commission, 0),
  }

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
}

// POST /api/trafficker
// Acciones (body.action):
//   - register            : { action, email, name, phone? }
//   - create_campaign     : { action, traffickerId, tenantId, name, platform, budget, startDate?, endDate? }
//   - register_sale       : { action, traffickerId, tenantId, campaignId, orderId?, amount, commission }
//   - confirm_sale        : { action, saleId }
//   - fail_sale           : { action, saleId, reason? }
//   - withdraw            : { action, traffickerId, amount, walletAccountId, totpCode? }
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
}

// ────────────────────────────────────────────────────────────
// Action handlers
// ────────────────────────────────────────────────────────────

async function registerTrafficker(body: any) {
  const { email, name, phone } = body
  if (!email || !name) {
    return NextResponse.json(
      { error: 'email and name are required' },
      { status: 400 },
    )
  }
  const existing = await db.trafficker.findUnique({
    where: { email: String(email) },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'A trafficker with that email already exists', trafficker: existing },
      { status: 409 },
    )
  }
  const trafficker = await db.trafficker.create({
    data: {
      email: String(email),
      name: String(name),
      phone: phone ?? null,
      walletBalance: 0,
      status: 'active',
    },
  })
  log.info({ traffickerId: trafficker.id, email }, 'trafficker registered')
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
  const trafficker = await db.trafficker.findUnique({
    where: { id: traffickerId },
  })
  if (!trafficker) {
    return NextResponse.json(
      { error: 'Trafficker not found' },
      { status: 404 },
    )
  }
  const campaign = await db.traffickerCampaign.create({
    data: {
      traffickerId,
      tenantId,
      name,
      platform,
      budget: Number(budget),
      spend: 0,
      status: 'active',
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    },
  })
  log.info(
    { traffickerId, tenantId, campaignId: campaign.id, platform },
    'campaign created',
  )
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
  const campaign = await db.traffickerCampaign.findFirst({
    where: { id: campaignId, traffickerId, tenantId },
  })
  if (!campaign) {
    return NextResponse.json(
      { error: 'Campaign not found for this trafficker+tenant' },
      { status: 404 },
    )
  }
  const sale = await db.traffickerSale.create({
    data: {
      traffickerId,
      tenantId,
      campaignId,
      orderId: orderId ?? null,
      amount: Number(amount),
      commission: Number(commission),
      status: 'pending',
    },
  })
  log.info(
    { traffickerId, tenantId, campaignId, saleId: sale.id, amount, commission },
    'sale registered',
  )
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
  const sale = await db.traffickerSale.findUnique({
    where: { id: saleId },
    include: { campaign: true },
  })
  if (!sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  }
  if (sale.status !== 'pending') {
    return NextResponse.json(
      { error: `Sale is already in status '${sale.status}'` },
      { status: 409 },
    )
  }

  // Credit the wallet and record the transaction atomically
  const result = await db.$transaction(async (tx) => {
    const trafficker = await tx.trafficker.findUnique({
      where: { id: sale.traffickerId },
    })
    if (!trafficker) throw new Error('Trafficker vanished mid-transaction')
    const balanceBefore = trafficker.walletBalance
    const balanceAfter = balanceBefore + sale.commission
    const [updatedSale, , transaction] = await Promise.all([
      tx.traffickerSale.update({
        where: { id: saleId },
        data: { status: 'confirmed' },
      }),
      tx.trafficker.update({
        where: { id: trafficker.id },
        data: { walletBalance: balanceAfter },
      }),
      tx.traffickerTransaction.create({
        data: {
          traffickerId: trafficker.id,
          direction: 'inbound',
          type: 'commission',
          category: 'sale',
          amount: sale.commission,
          balanceBefore,
          balanceAfter,
          description: `Comisión por venta ${sale.id} (campaña ${sale.campaign.name})`,
          reference: sale.id,
          referenceType: 'sale',
          status: 'completed',
        },
      }),
    ])
    return { sale: updatedSale, transaction }
  })

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
  const sale = await db.traffickerSale.findUnique({ where: { id: saleId } })
  if (!sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  }
  if (sale.status === 'confirmed' || sale.status === 'compensated') {
    return NextResponse.json(
      { error: `Cannot fail a sale already in status '${sale.status}'` },
      { status: 409 },
    )
  }
  const updated = await db.traffickerSale.update({
    where: { id: saleId },
    data: { status: 'failed' },
  })
  log.info(
    { saleId, traffickerId: sale.traffickerId, reason },
    'sale marked as failed',
  )
  return NextResponse.json({ sale: updated })
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
  const trafficker = await db.trafficker.findUnique({
    where: { id: traffickerId },
  })
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
  const walletAccount = await db.walletAccount.findUnique({
    where: { id: walletAccountId },
  })
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

  const result = await db.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawalRequest.create({
      data: {
        traffickerId,
        tenantId: null,
        walletAccountId,
        amount: amt,
        fee,
        netAmount,
        totpRequired: true,
        totpVerified,
        totpVerifiedAt: totpVerified ? new Date() : null,
        status: totpVerified ? 'pending_processing' : 'pending_2fa',
      },
    })
    const transaction = await tx.traffickerTransaction.create({
      data: {
        traffickerId,
        direction: 'outbound',
        type: 'withdrawal',
        category: 'cashout',
        amount: amt,
        balanceBefore: trafficker.walletBalance,
        balanceAfter: trafficker.walletBalance, // not yet deducted — only on completion
        description: `Retiro solicitado → ${walletAccount.accountType} ${walletAccount.accountNumber}`,
        reference: withdrawal.id,
        referenceType: 'withdrawal',
        status: 'pending',
      },
    })
    return { withdrawal, transaction }
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
