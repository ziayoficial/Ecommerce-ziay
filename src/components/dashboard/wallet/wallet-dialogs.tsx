// ZIAY — Wallet dialogs (WithdrawalDialog + RegisterAccountDialog).
// Split out from wallet-view.tsx in SPRINT8-VIEWS-SPLIT-001.
//
// All dialog state stays in index.tsx; these are pure presentational
// components that receive props.

import { Banknote, Plus, Lock, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot,
} from '@/components/ui/input-otp'

import { formatCurrency } from '@/lib/format'
import { t } from '@/lib/i18n'

import { type WalletData, maskAccount } from './wallet-shared'

// ───────────────────────────────────────────────────────────────────────────
// WithdrawalDialog
// ───────────────────────────────────────────────────────────────────────────

export function WithdrawalDialog({
  open, onOpenChange, data, twoFactorEnabled,
  wdAccount, setWdAccount, wdAmount, setWdAmount,
  wdTotp, setWdTotp, wdBusy, onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: WalletData
  twoFactorEnabled: boolean
  wdAccount: string
  setWdAccount: (v: string) => void
  wdAmount: string
  setWdAmount: (v: string) => void
  wdTotp: string
  setWdTotp: (v: string) => void
  wdBusy: boolean
  onSubmit: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Banknote className="size-5 text-emerald-600" /> Solicitar retiro</DialogTitle>
          <DialogDescription>Saldo disponible: {formatCurrency(data.balance)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="withdrawal-account">Cuenta de cobro</Label>
            <Select value={wdAccount} onValueChange={setWdAccount}>
              <SelectTrigger id="withdrawal-account"><SelectValue placeholder="Selecciona una cuenta" /></SelectTrigger>
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
            <Label htmlFor="withdrawal-amount">Monto (COP)</Label>
            <Input
              id="withdrawal-amount"
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
              <Label htmlFor="withdrawal-totp" className="flex items-center gap-1"><Lock className="size-3" /> Código TOTP (6 dígitos)</Label>
              <InputOTP id="withdrawal-totp" maxLength={6} value={wdTotp} onChange={setWdTotp}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={onSubmit} disabled={wdBusy}>
            {wdBusy && <Loader2 className="size-4 animate-spin mr-1" />}
            Confirmar retiro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// RegisterAccountDialog
// ───────────────────────────────────────────────────────────────────────────

export function RegisterAccountDialog({
  open, onOpenChange,
  acType, setAcType, acHolder, setAcHolder, acNumber, setAcNumber,
  acBank, setAcBank, acDocType, setAcDocType, acDocNumber, setAcDocNumber,
  acDefault, setAcDefault, acBusy, onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  acType: string
  setAcType: (v: string) => void
  acHolder: string
  setAcHolder: (v: string) => void
  acNumber: string
  setAcNumber: (v: string) => void
  acBank: string
  setAcBank: (v: string) => void
  acDocType: string
  setAcDocType: (v: string) => void
  acDocNumber: string
  setAcDocNumber: (v: string) => void
  acDefault: boolean
  setAcDefault: (v: boolean) => void
  acBusy: boolean
  onSubmit: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-emerald-600" /> Registrar cuenta</DialogTitle>
          <DialogDescription>Agrega una cuenta bancaria o billetera para recibir retiros.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-type">Tipo de cuenta</Label>
            <Select value={acType} onValueChange={setAcType}>
              <SelectTrigger id="account-type"><SelectValue /></SelectTrigger>
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
            <Label htmlFor="account-holder">Titular de la cuenta</Label>
            <Input id="account-holder" value={acHolder} onChange={e => setAcHolder(e.target.value)} placeholder="Nombre completo" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-number">Número de cuenta</Label>
            <Input id="account-number" value={acNumber} onChange={e => setAcNumber(e.target.value)} placeholder="0000000000" />
          </div>
          {acType === 'bank' && (
            <div className="space-y-2">
              <Label htmlFor="account-bank">Banco</Label>
              <Input id="account-bank" value={acBank} onChange={e => setAcBank(e.target.value)} placeholder="Bancolombia, Davivienda, etc." />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="account-doc-type">Tipo doc.</Label>
              <Select value={acDocType} onValueChange={setAcDocType}>
                <SelectTrigger id="account-doc-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cc">C.C.</SelectItem>
                  <SelectItem value="ce">C.E.</SelectItem>
                  <SelectItem value="nit">NIT</SelectItem>
                  <SelectItem value="passport">Pasaporte</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-doc-number">Número doc.</Label>
              <Input id="account-doc-number" value={acDocNumber} onChange={e => setAcDocNumber(e.target.value)} placeholder="1234567890" />
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={onSubmit} disabled={acBusy}>
            {acBusy && <Loader2 className="size-4 animate-spin mr-1" />}
            Registrar cuenta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
