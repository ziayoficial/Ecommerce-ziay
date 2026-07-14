// ZIAY — Wallet withdrawals tab (pending + history tables) and the inline
// ProcessWithdrawalButton. Split out from wallet-view.tsx in
// SPRINT8-VIEWS-SPLIT-001.

import { useState } from 'react'
import { toast } from 'sonner'

import { AlertTriangle, CheckCircle2, Loader2, Lock } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

import { formatCurrency, shortDate, shortTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  type WalletData, maskAccount, withdrawalStatusMeta,
} from './wallet-shared'

// ───────────────────────────────────────────────────────────────────────────
// ProcessWithdrawalButton — small inline action used inside the pending table
// ───────────────────────────────────────────────────────────────────────────

function ProcessWithdrawalButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const handle = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process_withdrawal', withdrawalId: id }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'No se pudo procesar')
      }
      toast.success('Retiro procesado correctamente')
      onDone()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al procesar')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={handle} disabled={busy} className="h-7 text-xs">
      {busy ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
      Procesar
    </Button>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// WalletWithdrawals — pending + history tables (the full withdrawals tab body)
// ───────────────────────────────────────────────────────────────────────────

export function WalletWithdrawals({
  data, onReload,
}: {
  data: WalletData
  onReload: () => void
}) {
  return (
    <>
      {data.pendingWithdrawals.length > 0 && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="size-4 text-amber-600" />
          <AlertTitle className="text-amber-700 dark:text-amber-300">
            {data.pendingWithdrawals.length} retiro{data.pendingWithdrawals.length === 1 ? '' : 's'} pendiente{data.pendingWithdrawals.length === 1 ? '' : 's'}
          </AlertTitle>
          <AlertDescription className="text-muted-foreground">
            Verifica el estado de cada solicitud. Las que requieren 2FA se completan al ingresar el TOTP.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Retiros pendientes</CardTitle>
          <CardDescription>{data.pendingWithdrawals.length} en curso</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.pendingWithdrawals.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sin retiros pendientes.</div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Fecha</TableHead>
                    <TableHead className="min-w-[160px]">Cuenta</TableHead>
                    <TableHead className="text-right min-w-[120px]">Monto</TableHead>
                    <TableHead className="text-right min-w-[100px]">Fee</TableHead>
                    <TableHead className="text-right min-w-[120px]">Neto</TableHead>
                    <TableHead className="min-w-[140px]">Estado</TableHead>
                    <TableHead className="min-w-[100px] text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pendingWithdrawals.map((w) => {
                    const meta = withdrawalStatusMeta(w.status)
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          <div className="font-medium text-foreground">{shortDate(w.createdAt)}</div>
                          <div>{shortTime(w.createdAt)}</div>
                        </TableCell>
                        <TableCell className="min-w-0">
                          <div className="text-sm truncate">{w.walletAccount.accountHolder}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate">
                            {maskAccount(w.walletAccount.accountNumber)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap font-medium">
                          {formatCurrency(w.amount, 'COP', { compact: true })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                          {formatCurrency(w.fee, 'COP', { compact: true })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap font-semibold">
                          {formatCurrency(w.netAmount, 'COP', { compact: true })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[10px]', meta.cls)}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {w.status === 'pending_processing' && (
                            <ProcessWithdrawalButton id={w.id} onDone={onReload} />
                          )}
                          {w.status === 'pending_2fa' && (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300">
                              <Lock className="size-3 mr-1" /> Requiere 2FA
                            </Badge>
                          )}
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historial de retiros</CardTitle>
          <CardDescription>{data.withdrawalHistory.length} completados / rechazados</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.withdrawalHistory.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sin historial.</div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Fecha</TableHead>
                    <TableHead className="min-w-[160px]">Cuenta</TableHead>
                    <TableHead className="text-right min-w-[120px]">Monto</TableHead>
                    <TableHead className="text-right min-w-[100px]">Fee</TableHead>
                    <TableHead className="text-right min-w-[120px]">Neto</TableHead>
                    <TableHead className="min-w-[140px]">Estado</TableHead>
                    <TableHead className="min-w-[140px]">Completado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.withdrawalHistory.map((w) => {
                    const meta = withdrawalStatusMeta(w.status)
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          <div className="font-medium text-foreground">{shortDate(w.createdAt)}</div>
                          <div>{shortTime(w.createdAt)}</div>
                        </TableCell>
                        <TableCell className="min-w-0">
                          <div className="text-sm truncate">{w.walletAccount.accountHolder}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate">
                            {maskAccount(w.walletAccount.accountNumber)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap font-medium">
                          {formatCurrency(w.amount, 'COP', { compact: true })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                          {formatCurrency(w.fee, 'COP', { compact: true })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap font-semibold">
                          {formatCurrency(w.netAmount, 'COP', { compact: true })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[10px]', meta.cls)}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {w.completedAt ? `${shortDate(w.completedAt)} ${shortTime(w.completedAt)}` : '—'}
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
    </>
  )
}
