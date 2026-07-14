// ZIAY — Wallet accounts tab (grid of account cards).
// Split out from wallet-view.tsx in SPRINT8-VIEWS-SPLIT-001.

import {
  Building2, Plus, CheckCircle2, Clock, Star,
} from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { cn } from '@/lib/utils'

import {
  type WalletData, maskAccount, accountTypeMeta,
} from './wallet-shared'

// ───────────────────────────────────────────────────────────────────────────
// WalletAccounts — accounts grid card
// ───────────────────────────────────────────────────────────────────────────

export function WalletAccounts({
  data, onAccountOpen,
}: {
  data: WalletData
  onAccountOpen: () => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">Cuentas de cobro</CardTitle>
          <CardDescription>{data.accounts.length} cuenta{data.accounts.length === 1 ? '' : 's'} registrada{data.accounts.length === 1 ? '' : 's'}</CardDescription>
        </div>
        <Button size="sm" onClick={onAccountOpen}>
          <Plus className="size-4" /> Nueva cuenta
        </Button>
      </CardHeader>
      <CardContent>
        {data.accounts.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground space-y-3">
            <Building2 className="size-10 mx-auto text-muted-foreground/50" />
            <div>No hay cuentas registradas todavía.</div>
            <Button size="sm" onClick={onAccountOpen}>
              <Plus className="size-4" /> Registrar primera cuenta
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.accounts.map((a) => {
              const meta = accountTypeMeta(a.accountType)
              const Icon = meta.icon
              return (
                <div
                  key={a.id}
                  className={cn(
                    'relative rounded-xl border p-4 transition-all hover:shadow-md',
                    a.isDefault ? 'border-emerald-500/40 bg-emerald-500/5' : 'bg-card',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className={cn('size-10 rounded-lg flex items-center justify-center ring-1 shrink-0', meta.cls)}>
                      <Icon className="size-5" />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                      {a.isDefault && (
                        <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0">
                          <Star className="size-3 mr-1" /> Predeterminada
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 min-w-0">
                    <div className="font-semibold text-sm truncate" title={a.accountHolder}>{a.accountHolder}</div>
                    <div className="text-sm font-mono text-muted-foreground tabular-nums">{maskAccount(a.accountNumber)}</div>
                    {a.bankName && <div className="text-xs text-muted-foreground truncate">{a.bankName}</div>}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {a.verified ? (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="size-3 mr-1" /> Verificada
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300">
                        <Clock className="size-3 mr-1" /> Sin verificar
                      </Badge>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
