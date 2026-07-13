// ZIAY — Wallet transactions tab (table + period summary row).
// Split out from wallet-view.tsx in SPRINT8-VIEWS-SPLIT-001.

import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

import { formatCurrency, shortDate, shortTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { type WalletData, txnTypeMeta } from './wallet-shared'

// ───────────────────────────────────────────────────────────────────────────
// WalletTransactions — transactions table card
// ───────────────────────────────────────────────────────────────────────────

export function WalletTransactions({ data }: { data: WalletData }) {
  const { stats } = data
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">Movimientos</CardTitle>
            <CardDescription className="truncate">
              Últimas {data.transactions.length} transacciones · flujo neto {formatCurrency(stats.net, 'COP', { compact: true })}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {data.transactions.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No hay transacciones todavía.
          </div>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">Fecha</TableHead>
                  <TableHead className="min-w-[120px]">Tipo</TableHead>
                  <TableHead className="min-w-[120px]">Categoría</TableHead>
                  <TableHead className="min-w-[180px]">Descripción</TableHead>
                  <TableHead className="text-right min-w-[120px]">Monto</TableHead>
                  <TableHead className="text-right min-w-[120px]">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Summary row */}
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={4} className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                    Resumen del período
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    <span className={stats.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                      {stats.net >= 0 ? '+' : ''}{formatCurrency(stats.net, 'COP', { compact: true })}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{data.transactions.length} mov.</TableCell>
                </TableRow>
                {data.transactions.map((t) => {
                  const typeMeta = txnTypeMeta(t.type)
                  const isInbound = t.direction === 'inbound'
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">{shortDate(t.createdAt)}</div>
                        <div>{shortTime(t.createdAt)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          {isInbound ? (
                            <ArrowDownCircle className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <ArrowUpCircle className="size-4 text-rose-600 dark:text-rose-400 shrink-0" />
                          )}
                          <span className={cn('text-xs font-medium truncate', typeMeta.cls)}>{typeMeta.label}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate">{t.category}</TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="text-sm truncate" title={t.description || ''}>{t.description || '—'}</div>
                        {t.reference && <div className="text-[10px] text-muted-foreground font-mono truncate">{t.reference}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        <span className={isInbound ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-rose-600 dark:text-rose-400 font-semibold'}>
                          {isInbound ? '+' : '−'}{formatCurrency(t.amount, 'COP', { compact: true })}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {formatCurrency(t.balanceAfter, 'COP', { compact: true })}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
