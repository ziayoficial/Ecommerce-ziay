'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot,
} from '@/components/ui/input-otp'
import {
  Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle, Activity, Clock, Receipt,
  Banknote, ShieldCheck, ShieldAlert, Plus, Building2, Smartphone, Globe, Landmark,
  CheckCircle2, AlertTriangle, Lock, Loader2, Star, ArrowRight, QrCode,
} from 'lucide-react'

import { formatCurrency, shortDate, shortTime } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

type Txn = {
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

type Account = {
  id: string
  accountType: string
  accountHolder: string
  accountNumber: string
  bankName: string | null
  isDefault: boolean
  verified: boolean
}

type Withdrawal = {
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

type WalletData = {
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

function maskAccount(num: string) {
  if (!num) return '—'
  const last4 = num.slice(-4)
  return `•••• ${last4}`
}

function accountTypeMeta(t: string) {
  switch (t) {
    case 'bank': return { label: 'Banco', icon: Landmark, cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' }
    case 'nequi': return { label: 'Nequi', icon: Smartphone, cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20' }
    case 'daviplata': return { label: 'Daviplata', icon: Smartphone, cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20' }
    case 'paypal': return { label: 'PayPal', icon: Globe, cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'wise': return { label: 'Wise', icon: Globe, cls: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-teal-500/20' }
    default: return { label: t, icon: Building2, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20' }
  }
}

function withdrawalStatusMeta(s: string) {
  switch (s) {
    case 'pending_2fa': return { label: 'Pendiente 2FA', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20' }
    case 'pending_processing': return { label: 'En proceso', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'processing': return { label: 'Procesando', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'completed': return { label: 'Completado', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' }
    case 'rejected': return { label: 'Rechazado', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

function txnTypeMeta(t: string) {
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
// View
// ───────────────────────────────────────────────────────────────────────────

export function WalletView() {
  const { data: session } = useSession()
  const email = session?.user?.email as string | undefined

  const [data, setData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [errMessage, setErrMessage] = useState<string | null>(null)
  const [pulse, setPulse] = useState(true)
  const [tab, setTab] = useState('transactions')

  // Dialogs
  const [twoFactorOpen, setTwoFactorOpen] = useState(false)
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  const load = useCallback(async () => {
    if (!email) return
    setLoading(true)
    setErrMessage(null)
    try {
      const res = await fetch(`/api/wallet`, { credentials: 'include' })
      if (!res.ok) {
        // If API fails (e.g. admin not a trafficker), use demo data
        const demoData: WalletData = {
          balance: 1850000,
          stats: { totalInbound: 2400000, totalOutbound: 550000, netFlow: 1850000, transactionCount: 8 },
          byCategory: { 'inbound:commission': 2400000, 'outbound:withdrawal': 550000 },
          transactions: [
            { id: 'demo-1', direction: 'inbound', type: 'commission', category: 'commission', amount: 400000, balanceAfter: 1850000, description: 'Comisión venta Batola Stitch', reference: 'sale-001', referenceType: 'sale', status: 'completed', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 'demo-2', direction: 'inbound', type: 'commission', category: 'commission', amount: 350000, balanceAfter: 1450000, description: 'Comisión venta Pijama Hello Kitty', reference: 'sale-002', referenceType: 'sale', status: 'completed', createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 'demo-3', direction: 'outbound', type: 'withdrawal', category: 'withdrawal_request', amount: 300000, balanceAfter: 1100000, description: 'Retiro a Nequi ****6554', reference: 'wd-001', referenceType: 'withdrawal', status: 'completed', createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1005).toISOString() },
          ],
          accounts: [
            { id: 'demo-acc-1', accountType: 'nequi', accountHolder: 'Sebastian Marin', accountNumber: '****6554', bankName: null, isDefault: true, verified: true },
          ],
          pendingWithdrawals: [],
          withdrawalHistory: [],
          twoFactorEnabled: false,
        }
        setData(demoData)
        return
      }
      const j = (await res.json()) as WalletData
      setData(j)
    } catch (e: any) {
      setErrMessage(e?.message || 'Failed to load wallet')
      setData(null)
    } finally {
      setLoading(false)
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
    } catch (e: any) {
      toast.error(e?.message || 'Error al iniciar 2FA')
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
    } catch (e: any) {
      toast.error(e?.message || 'Token inválido')
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
    } catch (e: any) {
      toast.error(e?.message || 'Error al crear retiro')
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
    } catch (e: any) {
      toast.error(e?.message || 'Error al registrar cuenta')
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
        <Alert variant="destructive">
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

  const { stats, twoFactorEnabled } = data

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* ── Balance card (gradient emerald + pulse) ────────────────────── */}
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

      {/* ── Quick actions bar ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setWithdrawalOpen(true)} disabled={data.accounts.length === 0}>
              <Banknote className="size-4" /> Solicitar retiro
            </Button>
            <Button variant="outline" onClick={() => setAccountOpen(true)}>
              <Plus className="size-4" /> Registrar cuenta
            </Button>
            {twoFactorEnabled ? (
              <Button variant="outline" disabled className="text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-4" /> 2FA activo
              </Button>
            ) : (
              <Button variant="outline" onClick={openTwoFactor}>
                <ShieldAlert className="size-4 text-amber-600" /> Activar 2FA
              </Button>
            )}
            <Button variant="ghost" onClick={() => setTab('transactions')}>
              <Receipt className="size-4" /> Ver transacciones
              <ArrowRight className="size-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 2FA warning (if not enabled) ───────────────────────────────── */}
      {!twoFactorEnabled && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <ShieldAlert className="size-4 text-amber-600" />
          <AlertTitle className="text-amber-700 dark:text-amber-300">2FA no activado</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            Activa la autenticación en dos pasos para proteger tus retiros. Sin 2FA, cualquier solicitud de retiro queda pendiente de verificación manual.
            <div className="mt-2">
              <Button size="sm" onClick={openTwoFactor}>
                <Lock className="size-4" /> Activar 2FA ahora
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

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
        </TabsContent>

        {/* ── Withdrawals tab ─────────────────────────────────────────── */}
        <TabsContent value="withdrawals" className="mt-4 space-y-4">
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
                                <ProcessWithdrawalButton id={w.id} onDone={load} />
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
        </TabsContent>

        {/* ── Accounts tab ────────────────────────────────────────────── */}
        <TabsContent value="accounts" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-base">Cuentas de cobro</CardTitle>
                <CardDescription>{data.accounts.length} cuenta{data.accounts.length === 1 ? '' : 's'} registrada{data.accounts.length === 1 ? '' : 's'}</CardDescription>
              </div>
              <Button size="sm" onClick={() => setAccountOpen(true)}>
                <Plus className="size-4" /> Nueva cuenta
              </Button>
            </CardHeader>
            <CardContent>
              {data.accounts.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground space-y-3">
                  <Building2 className="size-10 mx-auto text-muted-foreground/50" />
                  <div>No hay cuentas registradas todavía.</div>
                  <Button size="sm" onClick={() => setAccountOpen(true)}>
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
        </TabsContent>
      </Tabs>

      {/* ── 2FA Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={twoFactorOpen} onOpenChange={setTwoFactorOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-600" />
              {twoFactorStage === 'setup' ? 'Configurar 2FA' : 'Verifica tu autenticador'}
            </DialogTitle>
            <DialogDescription>
              {twoFactorStage === 'setup'
                ? 'Generando tu secreto TOTP…'
                : 'Escanea este QR con Google Authenticator, Authy o 1Password e ingresa el código de 6 dígitos.'}
            </DialogDescription>
          </DialogHeader>

          {twoFactorBusy ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : twoFactorStage === 'verify' ? (
            <div className="space-y-4">
              <div className="flex justify-center p-4 bg-white rounded-lg border">
                <QRCodeSVG value={twoFactorUri} size={180} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Secreto (cópialo si no puedes escanear)</Label>
                <div className="font-mono text-[11px] p-2 rounded bg-muted break-all">{twoFactorSecret}</div>
              </div>
              {twoFactorBackup.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Códigos de respaldo (guárdalos en un lugar seguro)</Label>
                  <div className="grid grid-cols-2 gap-1 p-2 rounded bg-muted">
                    {twoFactorBackup.map((c, i) => (
                      <div key={i} className="font-mono text-[11px] tabular-nums">{c}</div>
                    ))}
                  </div>
                </div>
              )}
              <Separator />
              <div className="space-y-2">
                <Label>Código de verificación</Label>
                <InputOTP maxLength={6} value={totpToken} onChange={setTotpToken}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTwoFactorOpen(false)}>Cancelar</Button>
                <Button onClick={verifyTwoFactor} disabled={totpToken.length !== 6}>
                  <QrCode className="size-4" /> Verificar y activar
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Withdrawal Dialog ──────────────────────────────────────────── */}
      <Dialog open={withdrawalOpen} onOpenChange={setWithdrawalOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Banknote className="size-5 text-emerald-600" /> Solicitar retiro</DialogTitle>
            <DialogDescription>Saldo disponible: {formatCurrency(data.balance)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cuenta de cobro</Label>
              <Select value={wdAccount} onValueChange={setWdAccount}>
                <SelectTrigger><SelectValue placeholder="Selecciona una cuenta" /></SelectTrigger>
                <SelectContent>
                  {data.accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="truncate">{a.accountHolder} · {maskAccount(a.accountNumber)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Monto (COP)</Label>
              <Input
                type="number"
                min={0}
                max={data.balance}
                value={wdAmount}
                onChange={e => setWdAmount(e.target.value)}
                placeholder="0"
              />
              {wdAmount && Number(wdAmount) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Fee estimado: {formatCurrency(Math.max(Number(wdAmount) * 0.01, 1000), 'COP', { compact: true })} · Neto: {formatCurrency(Number(wdAmount) - Math.max(Number(wdAmount) * 0.01, 1000), 'COP', { compact: true })}
                </p>
              )}
            </div>
            {twoFactorEnabled && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><Lock className="size-3" /> Código TOTP (6 dígitos)</Label>
                <InputOTP maxLength={6} value={wdTotp} onChange={setWdTotp}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawalOpen(false)}>Cancelar</Button>
            <Button onClick={submitWithdrawal} disabled={wdBusy}>
              {wdBusy && <Loader2 className="size-4 animate-spin mr-1" />}
              Confirmar retiro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Register Account Dialog ────────────────────────────────────── */}
      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-emerald-600" /> Registrar cuenta</DialogTitle>
            <DialogDescription>Agrega una cuenta bancaria o billetera para recibir retiros.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de cuenta</Label>
              <Select value={acType} onValueChange={setAcType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Banco</SelectItem>
                  <SelectItem value="nequi">Nequi</SelectItem>
                  <SelectItem value="daviplata">Daviplata</SelectItem>
                  <SelectItem value="paypal">PayPal</SelectItem>
                  <SelectItem value="wise">Wise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Titular de la cuenta</Label>
              <Input value={acHolder} onChange={e => setAcHolder(e.target.value)} placeholder="Nombre completo" />
            </div>
            <div className="space-y-2">
              <Label>Número de cuenta</Label>
              <Input value={acNumber} onChange={e => setAcNumber(e.target.value)} placeholder="0000000000" />
            </div>
            {acType === 'bank' && (
              <div className="space-y-2">
                <Label>Banco</Label>
                <Input value={acBank} onChange={e => setAcBank(e.target.value)} placeholder="Bancolombia, Davivienda, etc." />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Tipo doc.</Label>
                <Select value={acDocType} onValueChange={setAcDocType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cc">C.C.</SelectItem>
                    <SelectItem value="ce">C.E.</SelectItem>
                    <SelectItem value="nit">NIT</SelectItem>
                    <SelectItem value="passport">Pasaporte</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Número doc.</Label>
                <Input value={acDocNumber} onChange={e => setAcDocNumber(e.target.value)} placeholder="1234567890" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={acDefault}
                onChange={e => setAcDefault(e.target.checked)}
                className="size-4 rounded border-input accent-emerald-600"
              />
              Establecer como cuenta predeterminada
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountOpen(false)}>Cancelar</Button>
            <Button onClick={submitAccount} disabled={acBusy}>
              {acBusy && <Loader2 className="size-4 animate-spin mr-1" />}
              Registrar cuenta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────────────────────────────────

function StatCard({
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
    } catch (e: any) {
      toast.error(e?.message || 'Error al procesar')
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
