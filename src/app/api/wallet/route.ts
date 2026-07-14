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
//
// SPRINT8-SERVICES-REST-001 — migrated every Trafficker / WalletTransaction /
// WalletAccount / WithdrawalRequest / TwoFactorConfig read+write to
// `walletService`. The 2FA secret + TOTP verification helpers stay in the
// route (they're cryptographic, not DB-bound). Response shapes unchanged.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { generateTOTPSecret, verifyTOTP, hashBackupCodes } from '@/lib/totp'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { walletService, traffickerService } from '@/lib/services'

const log = getLogger('api:wallet')

// ───────────────────────────────────────────────────────────────────────────
// Body schemas (per-action discriminated union)
// ───────────────────────────────────────────────────────────────────────────

const Setup2faSchema = z.object({
  action: z.literal('setup_2fa'),
})

const Verify2faSchema = z.object({
  action: z.literal('verify_2fa'),
  token: z.string(),
})

const RegisterAccountSchema = z.object({
  action: z.literal('register_account'),
  accountType: z.enum(['bank', 'nequi', 'daviplata', 'paypal', 'wise']),
  accountHolder: z.string().min(1),
  accountNumber: z.string().min(1),
  bankName: z.string().nullable().optional(),
  documentType: z.string().nullable().optional(),
  documentNumber: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
})

const RequestWithdrawalSchema = z.object({
  action: z.literal('request_withdrawal'),
  walletAccountId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  totpToken: z.string().optional(),
})

const ProcessWithdrawalSchema = z.object({
  action: z.literal('process_withdrawal'),
  withdrawalId: z.string().min(1),
  externalReference: z.string().nullable().optional(),
})

const RecordTransactionSchema = z.object({
  action: z.literal('record_transaction'),
  direction: z.enum(['inbound', 'outbound']),
  type: z.string().min(1),
  category: z.string().optional(),
  amount: z.union([z.number(), z.string()]),
  description: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  referenceType: z.string().nullable().optional(),
})

const WalletBodySchema = z.discriminatedUnion('action', [
  Setup2faSchema,
  Verify2faSchema,
  RegisterAccountSchema,
  RequestWithdrawalSchema,
  ProcessWithdrawalSchema,
  RecordTransactionSchema,
])

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

async function resolveTrafficker(req: NextRequest) {
  const { session, error } = await requireAuth()
  if (error) return { session: null, error, trafficker: null }

  const sp = req.nextUrl.searchParams
  const explicitId = sp.get('traffickerId')
  // `session.user.{email,role}` are typed via the Session augmentation in
  // `src/types/next-auth.d.ts` — direct access, no cast needed.
  const email = session?.user?.email
  const role = session?.user?.role

  // 1) Explicit ID — admin/finance can read anyone; trafficker can only read self.
  if (explicitId) {
    const t = await traffickerService.getTraffickerById(explicitId)
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
  const t = await traffickerService.getTraffickerByEmail(email)
  if (t) {
    return { session, error: null, trafficker: t }
  }

  // 3) Logged-in user is NOT a trafficker (e.g. admin/agent/finance).
  //    For admins/finance, show the first trafficker as a demo view.
  if (role === 'admin' || role === 'finance') {
    const demoTrafficker = await traffickerService.getFirstTrafficker()
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

  try {
    const { transactions, accounts, withdrawals, twoFactor } =
      await walletService.getWalletDashboard(trafficker.id)

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
  } catch (err) {
    captureError(err as Error, { path: '/api/wallet', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST — action dispatch
// ───────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Rate limit: 10 req/min per IP (stricter for POST — financial operations)
  const limited = rateLimit(req, { max: 10, windowMs: 60_000, namespace: 'api:wallet:post' })
  if (limited) return limited

  const { session, error, trafficker } = await resolveTrafficker(req)
  if (error) return error
  if (!trafficker) return NextResponse.json({ error: 'No trafficker' }, { status: 400 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch (err) {
    captureError(err, { action: 'wallet:parse' })
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = WalletBodySchema.safeParse(raw)
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
      // ── 2FA setup: generate secret + otpauth URI for QR display ──────────
      case 'setup_2fa': {
        // If already enabled, refuse to regenerate to avoid breaking an active
        // authenticator. The user must first disable 2FA (not in scope).
        const existing = await walletService.getTwoFactorConfig(trafficker.id)
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
        await walletService.upsertTwoFactorSetup(trafficker.id, {
          secret: encryptedSecret,
          backupCodes: hashedBackupCodes,
        })
        log.info({ traffickerId: trafficker.id }, '2fa setup initiated')
        return NextResponse.json({ secret: plainSecret, uri, backupCodes: plainBackupCodes })
      }

      // ── 2FA verify: confirm TOTP, flip enabled=true ──────────────────────
      case 'verify_2fa': {
        const token = String(body.token || '').trim()
        if (!/^\d{6}$/.test(token)) {
          return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
        }
        const cfg = await walletService.getTwoFactorConfig(trafficker.id)
        if (!cfg) {
          return NextResponse.json(
            { error: 'No 2FA setup in progress — call setup_2fa first' },
            { status: 409 },
          )
        }
        if (!verifyTOTP(token, cfg.secret)) {
          return NextResponse.json({ error: 'Invalid TOTP token' }, { status: 401 })
        }
        const updated = await walletService.enableTwoFactor(cfg.id)
        log.info({ traffickerId: trafficker.id, enabledAt: updated.enabledAt }, '2fa verified — enabled')
        return NextResponse.json({ enabled: updated.enabled, enabledAt: updated.enabledAt })
      }

      // ── Register a payout account (bank / nequi / daviplata / paypal / wise)
      case 'register_account': {
        const {
          accountType, accountHolder, accountNumber, bankName,
          documentType, documentNumber, isDefault,
        } = body
        const account = await walletService.registerWalletAccount({
          traffickerId: trafficker.id,
          accountType,
          accountHolder: String(accountHolder),
          accountNumber: String(accountNumber),
          bankName: bankName ? String(bankName) : null,
          documentType: documentType ? String(documentType) : null,
          documentNumber: documentNumber ? String(documentNumber) : null,
          isDefault: !!isDefault,
        })
        return NextResponse.json({ account })
      }

      // ── Request a withdrawal (creates WithdrawalRequest in pending_2fa) ──
      case 'request_withdrawal': {
        const { walletAccountId, amount, totpToken } = body
        const amt = Number(amount)
        if (!amt || amt <= 0) {
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
        const account = await walletService.getWalletAccount(walletAccountId)
        if (!account || account.traffickerId !== trafficker.id) {
          return NextResponse.json(
            { error: 'Account not found or not owned by trafficker' },
            { status: 404 },
          )
        }

        // If 2FA is enabled, the request must be authorized with a TOTP.
        const cfg = await walletService.getTwoFactorConfig(trafficker.id)
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
        const withdrawal = await walletService.createWithdrawalRequest({
          traffickerId: trafficker.id,
          walletAccountId: account.id,
          amount: amt,
          fee,
          netAmount: net,
          totpRequired,
          totpVerified,
        })
        log.info(
          { traffickerId: trafficker.id, withdrawalId: withdrawal.id, amount: amt, fee, net, totpRequired, totpVerified },
          'withdrawal request created',
        )
        return NextResponse.json({ withdrawal })
      }

      // ── Process (complete) a withdrawal — admin/finance operation ────────
      case 'process_withdrawal': {
        // FIX-SECURITY-AUTH-001 (#14) — role gate. The handler comment said
        // "admin/finance operation" but the code allowed any caller (including
        // the trafficker themselves, via `resolveTrafficker` falling through
        // to "first trafficker" for non-trafficker sessions) to mark their
        // own withdrawal as completed — bypassing the admin-approval gate.
        if (session?.user?.role !== 'admin' && session?.user?.role !== 'finance') {
          return NextResponse.json(
            { error: 'Forbidden: admin/finance only' },
            { status: 403 },
          )
        }
        const { withdrawalId, externalReference } = body
        const w = await walletService.getWithdrawalRequest(withdrawalId)
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

        const balanceBefore = trafficker.walletBalance
        const balanceAfter = balanceBefore - w.amount

        const result = await walletService.processWithdrawal({
          withdrawalId: w.id,
          traffickerId: trafficker.id,
          walletAccountId: w.walletAccountId,
          amount: w.amount,
          balanceBefore,
          balanceAfter,
          externalReference: externalReference || null,
        })
        log.info(
          { traffickerId: trafficker.id, withdrawalId: w.id, amount: w.amount, balanceBefore, balanceAfter, externalReference: externalReference || null },
          'withdrawal processed — balance debited',
        )
        return NextResponse.json({ withdrawal: result, balance: balanceAfter })
      }

      // ── Record an arbitrary transaction (e.g. commission credit, refund) ─
      case 'record_transaction': {
        const { direction, type, category, amount, description, reference, referenceType } = body
        const amt = Number(amount)
        const signedAmount = direction === 'inbound' ? Math.abs(amt) : -Math.abs(amt)
        const balanceBefore = trafficker.walletBalance
        const balanceAfter = balanceBefore + signedAmount
        if (balanceAfter < 0) {
          return NextResponse.json(
            { error: 'Transaction would result in a negative balance' },
            { status: 400 },
          )
        }
        const txn = await walletService.recordTransaction({
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
        })
        return NextResponse.json({ transaction: txn, balance: balanceAfter })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    captureError(err as Error, { path: '/api/wallet', method: 'POST', action })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
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
