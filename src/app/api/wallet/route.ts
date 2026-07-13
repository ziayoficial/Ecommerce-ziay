// Wallet API — fintech layer for traffickers.
//
// GET  ?traffickerId=X | ?tenantId=X
//      → balance, stats, transactions (last 50), accounts, pendingWithdrawals,
//        withdrawalHistory, twoFactorEnabled, trafficker
//
// POST (body.action):
//   setup_2fa          → returns { secret, uri } for QR enrollment
//   verify_2fa         → marks TwoFactorConfig.enabled=true (token verified)
//   register_account   → creates WalletAccount
//   request_withdrawal → creates WithdrawalRequest (status pending_2fa if totp required)
//   process_withdrawal → admin/process: marks withdrawal completed, records outbound txn
//   record_transaction → records a WalletTransaction + TraffickerTransaction
//
// Auth: requireAuth() on every entry. For trafficker-scoped routes, the caller
// must either be the trafficker themselves (matched by email) or an admin/finance
// operator with no tenantId (platform-level).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { generateTOTPSecret, verifyTOTP, hashBackupCodes } from '@/lib/totp'
import { rateLimit } from '@/lib/middleware/rate-limit'

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

async function resolveTrafficker(req: NextRequest) {
  const { session, error } = await requireAuth()
  if (error) return { session: null, error, trafficker: null }

  const sp = req.nextUrl.searchParams
  const explicitId = sp.get('traffickerId')
  const email = (session?.user as any)?.email as string | undefined
  const role = (session?.user as any)?.role as string | undefined

  // 1) Explicit ID — admin/finance can read anyone; trafficker can only read self.
  if (explicitId) {
    const t = await db.trafficker.findUnique({ where: { id: explicitId } })
    if (!t) {
      return {
        session,
        error: NextResponse.json({ error: 'Trafficker not found' }, { status: 404 }),
        trafficker: null,
      }
    }
    // Self or platform admin/finance — allow. Otherwise forbid.
    const isSelf = email && t.email.toLowerCase() === email.toLowerCase()
    const isPrivileged = role === 'admin' || role === 'finance'
    if (!isSelf && !isPrivileged) {
      return {
        session,
        error: NextResponse.json({ error: 'Forbidden: not the trafficker owner' }, { status: 403 }),
        trafficker: null,
      }
    }
    return { session, error: null, trafficker: t }
  }

  // 2) No explicit ID → fall back to the logged-in user's email.
  if (!email) {
    return {
      session,
      error: NextResponse.json({ error: 'No trafficker context (missing email)' }, { status: 400 }),
      trafficker: null,
    }
  }
  const t = await db.trafficker.findUnique({ where: { email: email.toLowerCase() } })
  if (t) {
    return { session, error: null, trafficker: t }
  }

  // 3) Logged-in user is NOT a trafficker (e.g. admin/agent/finance).
  //    For admins/finance, show the first trafficker as a demo view.
  if (role === 'admin' || role === 'finance') {
    const demoTrafficker = await db.trafficker.findFirst({ orderBy: { createdAt: 'asc' } })
    if (demoTrafficker) {
      return { session, error: null, trafficker: demoTrafficker }
    }
  }

  return {
    session,
    error: NextResponse.json({ error: 'Trafficker not found for this user' }, { status: 404 }),
    trafficker: null,
  }
}

const FEE_PCT = 0.01 // 1% withdrawal fee
const FEE_MIN = 1000 // min COP fee

function computeFee(amount: number) {
  return Math.max(amount * FEE_PCT, FEE_MIN)
}

// ───────────────────────────────────────────────────────────────────────────
// GET
// ───────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Rate limit: 20 req/min per IP
  const limited = rateLimit(req, { max: 20, windowMs: 60_000, namespace: 'api:wallet:get' })
  if (limited) return limited

  const { error, trafficker } = await resolveTrafficker(req)
  if (error) return error
  if (!trafficker) return NextResponse.json({ error: 'No trafficker' }, { status: 400 })

  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined

  const [transactions, accounts, withdrawals, twoFactor] = await Promise.all([
    db.walletTransaction.findMany({
      where: { traffickerId: trafficker.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db.walletAccount.findMany({
      where: { traffickerId: trafficker.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    }),
    db.withdrawalRequest.findMany({
      where: { traffickerId: trafficker.id },
      include: { walletAccount: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.twoFactorConfig.findUnique({ where: { traffickerId: trafficker.id } }),
  ])

  const inbound = transactions
    .filter(t => t.direction === 'inbound')
    .reduce((s, t) => s + t.amount, 0)
  const outbound = transactions
    .filter(t => t.direction === 'outbound')
    .reduce((s, t) => s + t.amount, 0)
  const net = inbound - outbound
  const commissions = transactions
    .filter(t => t.type === 'commission')
    .reduce((s, t) => s + t.amount, 0)

  const pendingWithdrawals = withdrawals.filter(w =>
    ['pending_2fa', 'pending_processing', 'processing'].includes(w.status)
  )
  const withdrawalHistory = withdrawals.filter(w =>
    ['completed', 'rejected'].includes(w.status)
  )

  return NextResponse.json({
    trafficker: {
      id: trafficker.id,
      name: trafficker.name,
      email: trafficker.email,
      phone: trafficker.phone,
      status: trafficker.status,
    },
    balance: trafficker.walletBalance,
    stats: {
      inbound,
      outbound,
      net,
      transactions: transactions.length,
      pending: pendingWithdrawals.length,
      commissions,
    },
    transactions,
    accounts,
    pendingWithdrawals,
    withdrawalHistory,
    twoFactorEnabled: twoFactor?.enabled ?? false,
    twoFactor: twoFactor
      ? { enabled: twoFactor.enabled, enabledAt: twoFactor.enabledAt }
      : null,
    tenantId: tenantId || null,
  })
}

// ───────────────────────────────────────────────────────────────────────────
// POST — action dispatch
// ───────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Rate limit: 10 req/min per IP (stricter for POST — financial operations)
  const limited = rateLimit(req, { max: 10, windowMs: 60_000, namespace: 'api:wallet:post' })
  if (limited) return limited

  const { error, trafficker } = await resolveTrafficker(req)
  if (error) return error
  if (!trafficker) return NextResponse.json({ error: 'No trafficker' }, { status: 400 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const action = body?.action as string | undefined
  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  switch (action) {
    // ── 2FA setup: generate secret + otpauth URI for QR display ──────────
    case 'setup_2fa': {
      // If already enabled, refuse to regenerate to avoid breaking an active
      // authenticator. The user must first disable 2FA (not in scope).
      const existing = await db.twoFactorConfig.findUnique({
        where: { traffickerId: trafficker.id },
      })
      if (existing?.enabled) {
        return NextResponse.json(
          { error: '2FA already enabled — disable first to regenerate' },
          { status: 409 },
        )
      }
      // CRITICAL: secret is AES-256-GCM encrypted before storing.
      // plainSecret is returned ONCE for QR code display.
      // backupCodes are hashed (scrypt + salt) before storing — plain returned once.
      const { secret: encryptedSecret, plainSecret, uri } = generateTOTPSecret(trafficker.email)
      const plainBackupCodes = generateBackupCodesPlain()
      const hashedBackupCodes = hashBackupCodes(plainBackupCodes)
      await db.twoFactorConfig.upsert({
        where: { traffickerId: trafficker.id },
        update: { secret: encryptedSecret, backupCodes: hashedBackupCodes, enabled: false, enabledAt: null },
        create: {
          traffickerId: trafficker.id,
          secret: encryptedSecret,
          backupCodes: hashedBackupCodes,
          enabled: false,
        },
      })
      return NextResponse.json({ secret: plainSecret, uri, backupCodes: plainBackupCodes })
    }

    // ── 2FA verify: confirm TOTP, flip enabled=true ──────────────────────
    case 'verify_2fa': {
      const token = String(body.token || '').trim()
      if (!/^\d{6}$/.test(token)) {
        return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
      }
      const cfg = await db.twoFactorConfig.findUnique({
        where: { traffickerId: trafficker.id },
      })
      if (!cfg) {
        return NextResponse.json(
          { error: 'No 2FA setup in progress — call setup_2fa first' },
          { status: 409 },
        )
      }
      if (!verifyTOTP(token, cfg.secret)) {
        return NextResponse.json({ error: 'Invalid TOTP token' }, { status: 401 })
      }
      const updated = await db.twoFactorConfig.update({
        where: { id: cfg.id },
        data: { enabled: true, enabledAt: new Date() },
      })
      return NextResponse.json({ enabled: updated.enabled, enabledAt: updated.enabledAt })
    }

    // ── Register a payout account (bank / nequi / daviplata / paypal / wise)
    case 'register_account': {
      const {
        accountType, accountHolder, accountNumber, bankName,
        documentType, documentNumber, isDefault,
      } = body
      if (!accountType || !accountHolder || !accountNumber) {
        return NextResponse.json(
          { error: 'accountType, accountHolder, accountNumber are required' },
          { status: 400 },
        )
      }
      const validTypes = ['bank', 'nequi', 'daviplata', 'paypal', 'wise']
      if (!validTypes.includes(accountType)) {
        return NextResponse.json({ error: 'Invalid accountType' }, { status: 400 })
      }
      // If this is set as default, clear the previous default first.
      if (isDefault) {
        await db.walletAccount.updateMany({
          where: { traffickerId: trafficker.id, isDefault: true },
          data: { isDefault: false },
        })
      }
      const account = await db.walletAccount.create({
        data: {
          traffickerId: trafficker.id,
          accountType,
          accountHolder: String(accountHolder),
          accountNumber: String(accountNumber),
          bankName: bankName ? String(bankName) : null,
          documentType: documentType ? String(documentType) : null,
          documentNumber: documentNumber ? String(documentNumber) : null,
          isDefault: !!isDefault,
          verified: false,
        },
      })
      return NextResponse.json({ account })
    }

    // ── Request a withdrawal (creates WithdrawalRequest in pending_2fa) ──
    case 'request_withdrawal': {
      const { walletAccountId, amount, totpToken } = body
      const amt = Number(amount)
      if (!walletAccountId || !amt || amt <= 0) {
        return NextResponse.json(
          { error: 'walletAccountId and a positive amount are required' },
          { status: 400 },
        )
      }
      if (amt > trafficker.walletBalance) {
        return NextResponse.json(
          { error: 'Insufficient balance' },
          { status: 400 },
        )
      }
      const account = await db.walletAccount.findUnique({
        where: { id: walletAccountId },
      })
      if (!account || account.traffickerId !== trafficker.id) {
        return NextResponse.json(
          { error: 'Account not found or not owned by trafficker' },
          { status: 404 },
        )
      }

      // If 2FA is enabled, the request must be authorized with a TOTP.
      const cfg = await db.twoFactorConfig.findUnique({
        where: { traffickerId: trafficker.id },
      })
      const totpRequired = cfg?.enabled ?? false
      let totpVerified = false
      if (totpRequired) {
        if (!totpToken || !verifyTOTP(String(totpToken), cfg!.secret)) {
          return NextResponse.json(
            { error: 'Invalid or missing TOTP token' },
            { status: 401 },
          )
        }
        totpVerified = true
      }

      const fee = computeFee(amt)
      const net = amt - fee
      const withdrawal = await db.withdrawalRequest.create({
        data: {
          traffickerId: trafficker.id,
          walletAccountId: account.id,
          amount: amt,
          fee,
          netAmount: net,
          totpRequired,
          totpVerified,
          totpVerifiedAt: totpVerified ? new Date() : null,
          status: totpVerified ? 'pending_processing' : 'pending_2fa',
        },
      })
      return NextResponse.json({ withdrawal })
    }

    // ── Process (complete) a withdrawal — admin/finance operation ────────
    case 'process_withdrawal': {
      const { withdrawalId, externalReference } = body
      if (!withdrawalId) {
        return NextResponse.json(
          { error: 'withdrawalId required' },
          { status: 400 },
        )
      }
      const w = await db.withdrawalRequest.findUnique({
        where: { id: withdrawalId },
      })
      if (!w || w.traffickerId !== trafficker.id) {
        return NextResponse.json(
          { error: 'Withdrawal not found or not owned' },
          { status: 404 },
        )
      }
      if (w.status !== 'pending_processing') {
        return NextResponse.json(
          { error: `Cannot process withdrawal in status ${w.status}` },
          { status: 409 },
        )
      }
      if (w.amount > trafficker.walletBalance) {
        return NextResponse.json(
          { error: 'Balance changed — insufficient funds' },
          { status: 400 },
        )
      }

      // CRITICAL: Use Prisma $transaction for atomicity — balance decrement,
      // transaction record, and withdrawal status update MUST all succeed or
      // all fail. This prevents money loss if the server crashes mid-operation.
      const balanceBefore = trafficker.walletBalance
      const balanceAfter = balanceBefore - w.amount

      const result = await db.$transaction(async (tx) => {
        // 1. Decrement trafficker balance
        await tx.trafficker.update({
          where: { id: trafficker.id },
          data: { walletBalance: balanceAfter },
        })
        // 2. Record outbound transaction
        await tx.walletTransaction.create({
          data: {
            traffickerId: trafficker.id,
            direction: 'outbound',
            type: 'withdrawal',
            category: 'cashout',
            amount: w.amount,
            balanceBefore,
            balanceAfter,
            description: `Retiro #${w.id.slice(-6)} a ${w.walletAccountId}`,
            reference: w.id,
            referenceType: 'withdrawal',
            status: 'completed',
          },
        })
        // 3. Mark withdrawal as completed
        const updated = await tx.withdrawalRequest.update({
          where: { id: w.id },
          data: {
            status: 'completed',
            externalReference: externalReference || null,
            processedAt: new Date(),
            completedAt: new Date(),
          },
        })
        // 4. Create audit log entry
        await tx.auditLog.create({
          data: {
            action: 'withdrawal_processed',
            entity: 'withdrawal',
            entityId: w.id,
            meta: JSON.stringify({
              withdrawalId: w.id,
              traffickerId: trafficker.id,
              amount: w.amount,
              balanceBefore,
              balanceAfter,
              processedBy: 'wallet_api',
            }),
          },
        })
        return updated
      })
      return NextResponse.json({ withdrawal: result, balance: balanceAfter })
    }

    // ── Record an arbitrary transaction (e.g. commission credit, refund) ─
    case 'record_transaction': {
      const { direction, type, category, amount, description, reference, referenceType } = body
      const amt = Number(amount)
      if (!direction || !type || !amt) {
        return NextResponse.json(
          { error: 'direction, type, amount are required' },
          { status: 400 },
        )
      }
      if (!['inbound', 'outbound'].includes(direction)) {
        return NextResponse.json({ error: 'Invalid direction' }, { status: 400 })
      }
      const signedAmount = direction === 'inbound' ? Math.abs(amt) : -Math.abs(amt)
      const balanceBefore = trafficker.walletBalance
      const balanceAfter = balanceBefore + signedAmount
      if (balanceAfter < 0) {
        return NextResponse.json(
          { error: 'Transaction would result in a negative balance' },
          { status: 400 },
        )
      }
      const [txn] = await Promise.all([
        db.walletTransaction.create({
          data: {
            traffickerId: trafficker.id,
            direction,
            type,
            category: category || type,
            amount: Math.abs(amt),
            balanceBefore,
            balanceAfter,
            description: description || null,
            reference: reference || null,
            referenceType: referenceType || null,
            status: 'completed',
          },
        }),
        db.trafficker.update({
          where: { id: trafficker.id },
          data: { walletBalance: balanceAfter },
        }),
      ])
      return NextResponse.json({ transaction: txn, balance: balanceAfter })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Backup-code storage helpers (stored as JSON in a String column).
// ───────────────────────────────────────────────────────────────────────────

function generateBackupCodesPlain(): string[] {
  const codes: string[] = []
  const seen = new Set<string>()
  while (codes.length < 10) {
    const n = Math.floor(Math.random() * 100_000_000)
    const code = n.toString().padStart(8, '0')
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`
    if (seen.has(formatted)) continue
    seen.add(formatted)
    codes.push(formatted)
  }
  return codes
}
