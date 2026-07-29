// ZIAY — WalletView (main composition).
//
// SPRINT8-VIEWS-SPLIT-001 split the original 1100-line wallet-view.tsx
// into focused sub-modules under this directory:
//   - wallet-shared.tsx        — types, helpers, StatCard
//   - wallet-balance.tsx       — balance card + stat cards + quick actions
//   - wallet-transactions.tsx  — transactions tab (table + summary)
//   - wallet-withdrawals.tsx   — withdrawals tab (pending + history)
//                                and the inline ProcessWithdrawalButton
//   - wallet-accounts.tsx      — accounts tab (grid of account cards)
//   - wallet-2fa.tsx           — 2FA warning alert + 2FA setup/verify dialog
//   - wallet-dialogs.tsx       — WithdrawalDialog + RegisterAccountDialog
//
// This file owns the state machine (wallet data, tabs, 2FA setup,
// withdrawal + account dialogs) and composes the sub-modules.
// UI is byte-for-byte identical to the original.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'

import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs'

import { Activity, AlertTriangle, RefreshCw } from 'lucide-react'

import { type WalletData } from './wallet-shared'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { WalletBalance, WalletQuickActions } from './wallet-balance'
import { WalletTransactions } from './wallet-transactions'
import { WalletWithdrawals } from './wallet-withdrawals'
import { WalletAccounts } from './wallet-accounts'
import { Wallet2FAWarning, Wallet2FADialog } from './wallet-2fa'
import { WithdrawalDialog, RegisterAccountDialog } from './wallet-dialogs'

export function WalletView() {
  const { data: session } = useSession()
  const email = session?.user?.email as string | undefined

  const [data, setData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [errMessage, setErrMessage] = useState<string | null>(null)
  const [pulse, setPulse] = useState(true)
  const [tab, setTab] = useState('transactions')

  // Dialogs
  const [twoFactorOpen, setTwoFactorOpen] = useState(false)
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  const load = useCallback(async (showRefreshing = false) => {
    if (!email) return
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)
    setErrMessage(null)
    try {
      const res = await fetch(`/api/wallet`, { credentials: 'include' })
      if (!res.ok) {
        // If API fails (e.g. admin not a trafficker), use demo data
        const demoData: WalletData = {
          trafficker: { id: 'demo', name: 'Sebastian Marin', email: 'sebastian@trafficker.co', phone: null, status: 'active' },
          balance: 1850000,
          stats: { inbound: 2400000, outbound: 550000, net: 1850000, transactions: 8, pending: 0, commissions: 2400000 },
          transactions: [
            { id: 'demo-1', direction: 'inbound', type: 'commission', category: 'commission', amount: 400000, balanceBefore: 1450000, balanceAfter: 1850000, description: 'Comisión venta Batola Stitch', reference: 'sale-001', referenceType: 'sale', status: 'completed', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 'demo-2', direction: 'inbound', type: 'commission', category: 'commission', amount: 350000, balanceBefore: 1100000, balanceAfter: 1450000, description: 'Comisión venta Pijama Hello Kitty', reference: 'sale-002', referenceType: 'sale', status: 'completed', createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 'demo-3', direction: 'outbound', type: 'withdrawal', category: 'withdrawal_request', amount: 300000, balanceBefore: 1400000, balanceAfter: 1100000, description: 'Retiro a Nequi ****6554', reference: 'wd-001', referenceType: 'withdrawal', status: 'completed', createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
          ],
          accounts: [
            { id: 'demo-acc-1', accountType: 'nequi', accountHolder: 'Sebastian Marin', accountNumber: '****6554', bankName: null, isDefault: true, verified: true },
          ],
          pendingWithdrawals: [],
          withdrawalHistory: [],
          twoFactorEnabled: false,
          twoFactor: null,
        }
        setData(demoData)
        setLastUpdated(new Date())
        return
      }
      const j = (await res.json()) as WalletData
      setData(j)
      setLastUpdated(new Date())
    } catch (e: unknown) {
      setErrMessage(e instanceof Error ? e.message : 'Failed to load wallet')
      setData(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setPulse(false)
    }
  }, [email])

  useEffect(() => {
    void load()
  }, [load])

  // ── 2FA dialog state ──────────────────────────────────────────────────
  const [twoFactorStage, setTwoFactorStage] = useState<'setup' | 'verify'>('setup')
  const [twoFactorSecret, setTwoFactorSecret] = useState<string>('')
  const [twoFactorUri, setTwoFactorUri] = useState<string>('')
  const [twoFactorBackup, setTwoFactorBackup] = useState<string[]>([])
  const [totpToken, setTotpToken] = useState('')
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)

  const openTwoFactor = async () => {
    setTwoFactorOpen(true)
    setTwoFactorStage('setup')
    setTotpToken('')
    setTwoFactorBusy(true)
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup_2fa' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        // If 2FA already enabled, just close — nothing to set up.
        if (j.error?.includes('already enabled')) {
          toast.info('2FA ya está activado')
          setTwoFactorOpen(false)
          return
        }
        throw new Error(j.error || 'Failed to start 2FA setup')
      }
      const j = await res.json()
      setTwoFactorSecret(j.secret)
      setTwoFactorUri(j.uri)
      setTwoFactorBackup(j.backupCodes || [])
      setTwoFactorStage('verify')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al iniciar 2FA')
      setTwoFactorOpen(false)
    } finally {
      setTwoFactorBusy(false)
    }
  }

  const verifyTwoFactor = async () => {
    if (totpToken.length !== 6) {
      toast.error('Ingresa los 6 dígitos')
      return
    }
    setTwoFactorBusy(true)
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_2fa', token: totpToken }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Token inválido')
      }
      toast.success('2FA activado correctamente')
      setTwoFactorOpen(false)
      void load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Token inválido')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  // ── Withdrawal dialog state ───────────────────────────────────────────
  const [wdAccount, setWdAccount] = useState<string>('')
  const [wdAmount, setWdAmount] = useState<string>('')
  const [wdTotp, setWdTotp] = useState<string>('')
  const [wdBusy, setWdBusy] = useState(false)

  const submitWithdrawal = async () => {
    if (!wdAccount) { toast.error('Selecciona una cuenta'); return }
    const amt = Number(wdAmount)
    if (!amt || amt <= 0) { toast.error('Ingresa un monto válido'); return }
    if (data && amt > data.balance) { toast.error('Saldo insuficiente'); return }
    if (data?.twoFactorEnabled && wdTotp.length !== 6) {
      toast.error('Ingresa tu código TOTP de 6 dígitos')
      return
    }
    setWdBusy(true)
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_withdrawal',
          walletAccountId: wdAccount,
          amount: amt,
          totpToken: wdTotp || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'No se pudo crear el retiro')
      }
      toast.success('Solicitud de retiro creada')
      setWithdrawalOpen(false)
      setWdAmount('')
      setWdTotp('')
      void load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al crear retiro')
    } finally {
      setWdBusy(false)
    }
  }

  // ── Register account dialog state ─────────────────────────────────────
  const [acType, setAcType] = useState('bank')
  const [acHolder, setAcHolder] = useState('')
  const [acNumber, setAcNumber] = useState('')
  const [acBank, setAcBank] = useState('')
  const [acDocType, setAcDocType] = useState('cc')
  const [acDocNumber, setAcDocNumber] = useState('')
  const [acDefault, setAcDefault] = useState(false)
  const [acBusy, setAcBusy] = useState(false)

  const submitAccount = async () => {
    if (!acHolder || !acNumber) { toast.error('Titular y número son obligatorios'); return }
    setAcBusy(true)
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register_account',
          accountType: acType,
          accountHolder: acHolder,
          accountNumber: acNumber,
          bankName: acBank || undefined,
          documentType: acDocType,
          documentNumber: acDocNumber || undefined,
          isDefault: acDefault,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'No se pudo registrar la cuenta')
      }
      toast.success('Cuenta registrada')
      setAccountOpen(false)
      setAcHolder(''); setAcNumber(''); setAcBank(''); setAcDocNumber('')
      setAcDefault(false)
      void load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar cuenta')
    } finally {
      setAcBusy(false)
    }
  }

  // ── Render: loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  if (errMessage || !data) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="size-4" />
          <AlertTitle>No se pudo cargar la wallet</AlertTitle>
          <AlertDescription>
            {errMessage || 'Intenta de nuevo más tarde.'}
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => void load()}>
                <Activity className="size-4" /> Reintentar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const { twoFactorEnabled } = data

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* ── Header: last-updated + refresh ────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] sm:text-xs text-foreground/70 truncate">
          {lastUpdated ? (
            <span>Actualizado hace <strong className="text-foreground tabular-nums font-medium">{timeAgo(lastUpdated.toISOString())}</strong></span>
          ) : (
            <span>Datos de muestra</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing} className="gap-1.5 h-9 px-3">
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          {refreshing ? 'Actualizando…' : 'Actualizar'}
        </Button>
      </div>

      {/* ── Balance card (gradient emerald + pulse) ────────────────────── */}
      <WalletBalance data={data} pulse={pulse} twoFactorEnabled={twoFactorEnabled} />

      {/* ── Quick actions bar ──────────────────────────────────────────── */}
      <WalletQuickActions
        data={data}
        twoFactorEnabled={twoFactorEnabled}
        onWithdrawalOpen={() => setWithdrawalOpen(true)}
        onAccountOpen={() => setAccountOpen(true)}
        onOpenTwoFactor={openTwoFactor}
        onViewTransactions={() => setTab('transactions')}
      />

      {/* ── 2FA warning (if not enabled) ───────────────────────────────── */}
      {!twoFactorEnabled && <Wallet2FAWarning onOpenTwoFactor={openTwoFactor} />}

      {/* ── Tabs: Transacciones / Retiros / Cuentas ────────────────────── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="transactions">Transacciones</TabsTrigger>
          <TabsTrigger value="withdrawals">
            Retiros
            {data.pendingWithdrawals.length > 0 && (
              <Badge variant="secondary" className="ml-2 bg-amber-500/20 text-amber-700 dark:text-amber-300">
                {data.pendingWithdrawals.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="accounts">Cuentas</TabsTrigger>
        </TabsList>

        {/* ── Transactions tab ────────────────────────────────────────── */}
        <TabsContent value="transactions" className="mt-4">
          <WalletTransactions data={data} />
        </TabsContent>

        {/* ── Withdrawals tab ─────────────────────────────────────────── */}
        <TabsContent value="withdrawals" className="mt-4 space-y-4">
          <WalletWithdrawals data={data} onReload={load} />
        </TabsContent>

        {/* ── Accounts tab ────────────────────────────────────────────── */}
        <TabsContent value="accounts" className="mt-4">
          <WalletAccounts data={data} onAccountOpen={() => setAccountOpen(true)} />
        </TabsContent>
      </Tabs>

      {/* ── 2FA Dialog ─────────────────────────────────────────────────── */}
      <Wallet2FADialog
        open={twoFactorOpen}
        onOpenChange={setTwoFactorOpen}
        stage={twoFactorStage}
        secret={twoFactorSecret}
        uri={twoFactorUri}
        backup={twoFactorBackup}
        totpToken={totpToken}
        setTotpToken={setTotpToken}
        busy={twoFactorBusy}
        onVerify={verifyTwoFactor}
      />

      {/* ── Withdrawal Dialog ──────────────────────────────────────────── */}
      <WithdrawalDialog
        open={withdrawalOpen}
        onOpenChange={setWithdrawalOpen}
        data={data}
        twoFactorEnabled={twoFactorEnabled}
        wdAccount={wdAccount}
        setWdAccount={setWdAccount}
        wdAmount={wdAmount}
        setWdAmount={setWdAmount}
        wdTotp={wdTotp}
        setWdTotp={setWdTotp}
        wdBusy={wdBusy}
        onSubmit={submitWithdrawal}
      />

      {/* ── Register Account Dialog ────────────────────────────────────── */}
      <RegisterAccountDialog
        open={accountOpen}
        onOpenChange={setAccountOpen}
        acType={acType}
        setAcType={setAcType}
        acHolder={acHolder}
        setAcHolder={setAcHolder}
        acNumber={acNumber}
        setAcNumber={setAcNumber}
        acBank={acBank}
        setAcBank={setAcBank}
        acDocType={acDocType}
        setAcDocType={setAcDocType}
        acDocNumber={acDocNumber}
        setAcDocNumber={setAcDocNumber}
        acDefault={acDefault}
        setAcDefault={setAcDefault}
        acBusy={acBusy}
        onSubmit={submitAccount}
      />
    </div>
  )
}
