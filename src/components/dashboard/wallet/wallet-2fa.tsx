// ZIAY — Wallet 2FA section (warning alert) + the 2FA setup/verify dialog.
// Split out from wallet-view.tsx in SPRINT8-VIEWS-SPLIT-001.

import { QRCodeSVG } from 'qrcode.react'

import { ShieldCheck, ShieldAlert, Lock, Loader2, QrCode } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot,
} from '@/components/ui/input-otp'
import { t } from '@/lib/i18n'

// ───────────────────────────────────────────────────────────────────────────
// Wallet2FAWarning — inline alert shown when 2FA is not enabled
// ───────────────────────────────────────────────────────────────────────────

export function Wallet2FAWarning({ onOpenTwoFactor }: { onOpenTwoFactor: () => void }) {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <ShieldAlert className="size-4 text-amber-600" />
      <AlertTitle className="text-amber-700 dark:text-amber-300">2FA no activado</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        Activa la autenticación en dos pasos para proteger tus retiros. Sin 2FA, cualquier solicitud de retiro queda pendiente de verificación manual.
        <div className="mt-2">
          <Button size="sm" onClick={onOpenTwoFactor}>
            <Lock className="size-4" /> Activar 2FA ahora
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Wallet2FADialog — TOTP setup + verify dialog
// ───────────────────────────────────────────────────────────────────────────

export function Wallet2FADialog({
  open, onOpenChange, stage, secret, uri, backup, totpToken, setTotpToken, busy, onVerify,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stage: 'setup' | 'verify'
  secret: string
  uri: string
  backup: string[]
  totpToken: string
  setTotpToken: (v: string) => void
  busy: boolean
  onVerify: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" />
            {stage === 'setup' ? 'Configurar 2FA' : 'Verifica tu autenticador'}
          </DialogTitle>
          <DialogDescription>
            {stage === 'setup'
              ? 'Generando tu secreto TOTP…'
              : 'Escanea este QR con Google Authenticator, Authy o 1Password e ingresa el código de 6 dígitos.'}
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="py-8 flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : stage === 'verify' ? (
          <div className="space-y-4">
            <div className="flex justify-center p-4 bg-white rounded-lg border">
              <QRCodeSVG value={uri} size={180} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Secreto (cópialo si no puedes escanear)</p>
              <div id="2fa-secret" className="font-mono text-[11px] p-2 rounded bg-muted break-all">{secret}</div>
            </div>
            {backup.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Códigos de respaldo (guárdalos en un lugar seguro)</p>
                <div id="2fa-backup-codes" className="grid grid-cols-2 gap-1 p-2 rounded bg-muted">
                  {backup.map((c, i) => (
                    <div key={i} className="font-mono text-[11px] tabular-nums">{c}</div>
                  ))}
                </div>
              </div>
            )}
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="2fa-verify-code">Código de verificación</Label>
              <InputOTP id="2fa-verify-code" maxLength={6} value={totpToken} onChange={setTotpToken}>
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
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button onClick={onVerify} disabled={totpToken.length !== 6}>
                <QrCode className="size-4" /> Verificar y activar
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
