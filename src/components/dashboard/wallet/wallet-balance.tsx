// ZIAY — Wallet balance card + stat cards + quick actions bar.
// Split out from wallet-view.tsx in SPRINT8-VIEWS-SPLIT-001.
//
// Exports:
//   - WalletBalance     — the gradient balance card + 6 stat cards grid
//   - WalletQuickActions — the action buttons row (solicitar retiro,
//                          registrar cuenta, activar 2FA, ver transacciones)

import {
  Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle, Activity, Clock, Receipt,
  Banknote, ShieldCheck, ShieldAlert, Plus, ArrowRight,
} from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

import { type WalletData, StatCard } from './wallet-shared'

// ───────────────────────────────────────────────────────────────────────────
// WalletBalance — gradient balance card + 6 stat cards grid
// ───────────────────────────────────────────────────────────────────────────

export function WalletBalance({
  data, pulse, twoFactorEnabled,
}: {
  data: WalletData
  pulse: boolean
  twoFactorEnabled: boolean
}) {
  const { stats } = data
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-1 overflow-hidden border-0 bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-white">
        <CardContent className="p-6 relative">
          <div className="flex items-start justify-between min-w-0">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-emerald-50/80 font-medium">
                Saldo disponible
              </div>
              <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight break-all">
                {formatCurrency(data.balance)}
              </div>
              <div className="mt-1 text-xs text-emerald-50/80 truncate">
                {data.trafficker.name} · {data.trafficker.email}
              </div>
            </div>
            <div className={cn(
              'size-11 rounded-xl bg-white/15 ring-1 ring-white/30 flex items-center justify-center shrink-0',
              pulse && 'animate-pulse',
            )}>
              <WalletIcon className="size-6" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className="bg-white/15 text-white border-0 hover:bg-white/20">
              <span className={cn('size-1.5 rounded-full mr-1.5', data.trafficker.status === 'active' ? 'bg-emerald-300' : 'bg-amber-300')} />
              {data.trafficker.status}
            </Badge>
            {twoFactorEnabled ? (
              <Badge className="bg-white/15 text-white border-0 hover:bg-white/20">
                <ShieldCheck className="size-3 mr-1" /> 2FA activo
              </Badge>
            ) : (
              <Badge className="bg-amber-500/30 text-white border-0 hover:bg-amber-500/40">
                <ShieldAlert className="size-3 mr-1" /> 2FA pendiente
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 6 stat cards — laid out as 2x3 next to the balance card */}
      <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          icon={ArrowDownCircle}
          label="Entradas totales"
          value={formatCurrency(stats.inbound, 'COP', { compact: true })}
          accent="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20"
        />
        <StatCard
          icon={ArrowUpCircle}
          label="Salidas totales"
          value={formatCurrency(stats.outbound, 'COP', { compact: true })}
          accent="bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20"
        />
        <StatCard
          icon={Activity}
          label="Flujo neto"
          value={formatCurrency(stats.net, 'COP', { compact: true })}
          accent="bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20"
        />
        <StatCard
          icon={Receipt}
          label="Transacciones"
          value={String(stats.transactions)}
          accent="bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20"
        />
        <StatCard
          icon={Clock}
          label="Pendientes"
          value={String(stats.pending)}
          accent="bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20"
        />
        <StatCard
          icon={Banknote}
          label="Comisiones"
          value={formatCurrency(stats.commissions, 'COP', { compact: true })}
          accent="bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-teal-500/20"
        />
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// WalletQuickActions — action buttons row
// ───────────────────────────────────────────────────────────────────────────

export function WalletQuickActions({
  data, twoFactorEnabled, onWithdrawalOpen, onAccountOpen, onOpenTwoFactor, onViewTransactions,
}: {
  data: WalletData
  twoFactorEnabled: boolean
  onWithdrawalOpen: () => void
  onAccountOpen: () => void
  onOpenTwoFactor: () => void
  onViewTransactions: () => void
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onWithdrawalOpen} disabled={data.accounts.length === 0}>
            <Banknote className="size-4" /> Solicitar retiro
          </Button>
          <Button variant="outline" onClick={onAccountOpen}>
            <Plus className="size-4" /> Registrar cuenta
          </Button>
          {twoFactorEnabled ? (
            <Button variant="outline" disabled className="text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-4" /> 2FA activo
            </Button>
          ) : (
            <Button variant="outline" onClick={onOpenTwoFactor}>
              <ShieldAlert className="size-4 text-amber-600" /> Activar 2FA
            </Button>
          )}
          <Button variant="ghost" onClick={onViewTransactions}>
            <Receipt className="size-4" /> Ver transacciones
            <ArrowRight className="size-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
