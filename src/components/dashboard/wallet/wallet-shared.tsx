// ZIAY — Shared types, helpers, and small presentational primitives
// for the wallet dashboard view. Split out from wallet-view.tsx in
// SPRINT8-VIEWS-SPLIT-001 — no behavior changes, just file layout.

import {
  Wallet as WalletIcon, Building2, Smartphone, Globe, Landmark,
} from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type Txn = {
  id: string
  direction: string
  type: string
  category: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  description: string | null
  reference: string | null
  referenceType: string | null
  status: string
  createdAt: string
}

export type Account = {
  id: string
  accountType: string
  accountHolder: string
  accountNumber: string
  bankName: string | null
  isDefault: boolean
  verified: boolean
}

export type Withdrawal = {
  id: string
  amount: number
  fee: number
  netAmount: number
  status: string
  totpRequired: boolean
  totpVerified: boolean
  createdAt: string
  completedAt: string | null
  walletAccount: Account
}

export type WalletData = {
  trafficker: { id: string; name: string; email: string; phone: string | null; status: string }
  balance: number
  stats: {
    inbound: number; outbound: number; net: number
    transactions: number; pending: number; commissions: number
  }
  transactions: Txn[]
  accounts: Account[]
  pendingWithdrawals: Withdrawal[]
  withdrawalHistory: Withdrawal[]
  twoFactorEnabled: boolean
  twoFactor: { enabled: boolean; enabledAt: string | null } | null
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

export function maskAccount(num: string) {
  if (!num) return '—'
  const last4 = num.slice(-4)
  return `•••• ${last4}`
}

export function accountTypeMeta(t: string) {
  switch (t) {
    case 'bank': return { label: 'Banco', icon: Landmark, cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' }
    case 'nequi': return { label: 'Nequi', icon: Smartphone, cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20' }
    case 'daviplata': return { label: 'Daviplata', icon: Smartphone, cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20' }
    case 'paypal': return { label: 'PayPal', icon: Globe, cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'wise': return { label: 'Wise', icon: Globe, cls: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-teal-500/20' }
    default: return { label: t, icon: Building2, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20' }
  }
}

export function withdrawalStatusMeta(s: string) {
  switch (s) {
    case 'pending_2fa': return { label: 'Pendiente 2FA', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20' }
    case 'pending_processing': return { label: 'En proceso', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'processing': return { label: 'Procesando', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'completed': return { label: 'Completado', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' }
    case 'rejected': return { label: 'Rechazado', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

export function txnTypeMeta(t: string) {
  switch (t) {
    case 'commission': return { label: 'Comisión', cls: 'text-emerald-600 dark:text-emerald-400' }
    case 'withdrawal': return { label: 'Retiro', cls: 'text-rose-600 dark:text-rose-400' }
    case 'refund': return { label: 'Reembolso', cls: 'text-amber-600 dark:text-amber-400' }
    case 'fee': return { label: 'Comisión (fee)', cls: 'text-rose-600 dark:text-rose-400' }
    case 'bonus': return { label: 'Bono', cls: 'text-emerald-600 dark:text-emerald-400' }
    case 'penalty': return { label: 'Penalización', cls: 'text-rose-600 dark:text-rose-400' }
    default: return { label: t, cls: 'text-foreground' }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// StatCard
// ───────────────────────────────────────────────────────────────────────────

export function StatCard({
  icon: Icon, label, value, accent,
}: {
  icon: typeof WalletIcon; label: string; value: string; accent: string
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3 min-w-0">
        <div className={cn('size-10 rounded-xl flex items-center justify-center ring-1 shrink-0', accent)}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium truncate">{label}</div>
          <div className="text-xl font-bold tabular-nums truncate">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}
