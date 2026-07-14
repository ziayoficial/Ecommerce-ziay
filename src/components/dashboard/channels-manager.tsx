'use client'
import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useTenantId } from '@/hooks/use-tenant'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import { toast } from 'sonner'
import { t } from '@/lib/i18n'
import {
  Plus, Trash2, Edit2, MessageCircle, Send, Instagram, Phone, Key, CheckCircle2, XCircle,
  Eye, EyeOff, Save, X, AlertCircle, RefreshCw,
} from 'lucide-react'

type Channel = {
  id: string; tenantId: string; type: string; name: string; displayName: string
  accountId: string | null; verified: boolean; active: boolean; country: string | null
  paymentStrategy: string; requirePrepayMin: number | null; prepayDiscountPct: number | null; codFee: number | null
  wabaId: string | null; phoneNumberId: string | null
  hasWhatsappToken: boolean; hasPageAccessToken: boolean
  pageId: string | null; igAccountId: string | null
  verifyToken: string | null; appSecret: string | null
  createdAt: string; updatedAt: string
}

const channelMeta: Record<string, { icon: typeof Phone; label: string; color: string }> = {
  whatsapp: { icon: Phone, label: 'WhatsApp', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  messenger: { icon: Send, label: 'Messenger', color: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  instagram: { icon: Instagram, label: 'Instagram', color: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300' },
  telegram: { icon: Send, label: 'Telegram', color: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' },
}

export function ChannelsManager() {
  const tenantId = useTenantId()
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({})
  const [confirmDeactivate, setConfirmDeactivate] = useState<Channel | null>(null)

  const load = useCallback(async (showRefreshing = false) => {
    if (!tenantId) return
    if (showRefreshing) setRefreshing(true)
    setError(null)
    let cancelled = false
    try {
      const r = await fetch(`/api/channels?tenantId=${tenantId}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      if (!cancelled) { setChannels(d.channels || []); setLoading(false); setLastUpdated(new Date()) }
    } catch (err) {
      console.error('Channels fetch failed', err)
      if (!cancelled) {
        setError('No pudimos cargar los canales. Verifica tu conexión o intenta de nuevo.')
        setLoading(false)
      }
    } finally {
      if (!cancelled) setRefreshing(false)
    }
    return () => { cancelled = true }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const openNew = () => { setEditingChannel(null); setDialogOpen(true) }
  const openEdit = (c: Channel) => { setEditingChannel(c); setDialogOpen(true) }

  const toggleToken = (id: string) => setShowTokens(prev => ({ ...prev, [id]: !prev[id] }))

  if (loading) return (
    <section aria-label="Canales">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="size-4 text-primary" /> Canales de Mensajería</CardTitle>
              <CardDescription>Gestiona tus líneas de WhatsApp, Messenger e Instagram — agrega, edita credenciales, desactiva</CardDescription>
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </CardContent>
      </Card>
    </section>
  )

  if (error) {
    return (
      <section aria-label="Canales">
        <Alert variant="destructive" className="animate-fade-in-up">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar los canales</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void load(true)} className="gap-1.5">
              <RefreshCw className="size-3.5" /> Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  return (
    <section aria-label="Canales">
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="size-4 text-primary" /> Canales de Mensajería</CardTitle>
            <CardDescription>Gestiona tus líneas de WhatsApp, Messenger e Instagram — agrega, edita credenciales, desactiva</CardDescription>
            {lastUpdated && (
              <div className="text-[10px] text-muted-foreground mt-1">
                Actualizado hace <strong className="text-foreground tabular-nums">{timeAgo(lastUpdated)}</strong>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing} className="gap-1.5">
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
              {refreshing ? t('common.refreshing') : t('common.refresh')}
            </Button>
            <Button onClick={openNew} size="sm" className="gap-1.5"><Plus className="size-3.5" /> Nuevo canal</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {channels.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <MessageCircle className="size-8 mx-auto mb-2 opacity-30" />
            Sin canales configurados. Click "Nuevo canal" para agregar.
          </div>
        ) : channels.map((c) => {
          const meta = channelMeta[c.type] || channelMeta.whatsapp
          const Icon = meta.icon
          return (
            <div key={c.id} className={cn('rounded-xl border p-3 transition-colors', !c.active && 'opacity-50')}>
              <div className="flex items-start gap-3">
                <div className={cn('size-9 rounded-lg flex items-center justify-center shrink-0', meta.color)}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c.displayName}</span>
                    {c.verified ? <Badge variant="outline" className="text-[9px] gap-0.5 text-emerald-600"><CheckCircle2 className="size-2.5" /> Verificado</Badge> : <Badge variant="outline" className="text-[9px] gap-0.5 text-amber-600"><AlertCircle className="size-2.5" /> Sin verificar</Badge>}
                    {!c.active && <Badge variant="outline" className="text-[9px] text-rose-600">Inactivo</Badge>}
                    <Badge variant="outline" className="text-[9px]">{c.paymentStrategy}</Badge>
                    {c.country && <Badge variant="outline" className="text-[9px]">{c.country}</Badge>}
                  </div>
                  {/* Credentials status */}
                  <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    {c.type === 'whatsapp' && (
                      <>
                        <span className={cn('flex items-center gap-0.5', c.wabaId ? 'text-emerald-600' : 'text-rose-500')}>
                          {c.wabaId ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} WABA ID
                        </span>
                        <span className={cn('flex items-center gap-0.5', c.phoneNumberId ? 'text-emerald-600' : 'text-rose-500')}>
                          {c.phoneNumberId ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} Phone ID
                        </span>
                        <span className={cn('flex items-center gap-0.5', c.hasWhatsappToken ? 'text-emerald-600' : 'text-rose-500')}>
                          {c.hasWhatsappToken ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} Token
                        </span>
                      </>
                    )}
                    {c.type === 'messenger' && (
                      <>
                        <span className={cn('flex items-center gap-0.5', c.pageId ? 'text-emerald-600' : 'text-rose-500')}>
                          {c.pageId ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} Page ID
                        </span>
                        <span className={cn('flex items-center gap-0.5', c.hasPageAccessToken ? 'text-emerald-600' : 'text-rose-500')}>
                          {c.hasPageAccessToken ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} Page Token
                        </span>
                      </>
                    )}
                    {c.type === 'instagram' && (
                      <>
                        <span className={cn('flex items-center gap-0.5', c.igAccountId ? 'text-emerald-600' : 'text-rose-500')}>
                          {c.igAccountId ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} IG Account ID
                        </span>
                        <span className={cn('flex items-center gap-0.5', c.hasPageAccessToken ? 'text-emerald-600' : 'text-rose-500')}>
                          {c.hasPageAccessToken ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} Token
                        </span>
                      </>
                    )}
                    <span className={cn('flex items-center gap-0.5', c.verifyToken ? 'text-emerald-600' : 'text-rose-500')}>
                      {c.verifyToken ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} Verify Token
                    </span>
                    <span className={cn('flex items-center gap-0.5', c.appSecret ? 'text-emerald-600' : 'text-rose-500')}>
                      {c.appSecret ? <CheckCircle2 className="size-2.5" /> : <XCircle className="size-2.5" />} App Secret
                    </span>
                  </div>
                  {c.accountId && <div className="text-[10px] text-muted-foreground font-mono">{c.accountId}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Editar canal ${c.displayName}`} onClick={() => openEdit(c)}><Edit2 className="size-3" /></Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500" aria-label={`Eliminar canal ${c.displayName}`} onClick={() => setConfirmDeactivate(c)}><Trash2 className="size-3" /></Button>
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>

      {/* New/Edit channel dialog */}
      <ChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channel={editingChannel}
        tenantId={tenantId || ''}
        onSaved={() => { setDialogOpen(false); void load() }}
      />

      {/* Deactivate confirmation dialog (replaces native confirm()) */}
      <AlertDialog open={!!confirmDeactivate} onOpenChange={(open) => { if (!open) setConfirmDeactivate(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar este canal?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeactivate
                ? `Se desactivará el canal "${confirmDeactivate.displayName}". Las conversaciones existentes se conservan.`
                : 'Las conversaciones existentes se conservan.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDeactivate) return
                const id = confirmDeactivate.id
                setConfirmDeactivate(null)
                try {
                  await fetch(`/api/channels?channelId=${id}`, { method: 'DELETE' })
                  toast.success('Canal desactivado')
                  void load()
                } catch { toast.error('No se pudo desactivar') }
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
    </section>
  )
}

// ── Channel dialog (create/edit) ──
function ChannelDialog({ open, onOpenChange, channel, tenantId, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  channel: Channel | null
  tenantId: string
  onSaved: () => void
}) {
  const [type, setType] = useState(channel?.type || 'whatsapp')
  const [name, setName] = useState(channel?.name || '')
  const [displayName, setDisplayName] = useState(channel?.displayName || '')
  const [accountId, setAccountId] = useState(channel?.accountId || '')
  const [country, setCountry] = useState(channel?.country || 'CO')
  const [paymentStrategy, setPaymentStrategy] = useState(channel?.paymentStrategy || 'hybrid')
  const [requirePrepayMin, setRequirePrepayMin] = useState(channel?.requirePrepayMin?.toString() || '')
  const [prepayDiscountPct, setPrepayDiscountPct] = useState(channel?.prepayDiscountPct?.toString() || '5')
  const [codFee, setCodFee] = useState(channel?.codFee?.toString() || '8000')
  // Credentials
  const [wabaId, setWabaId] = useState(channel?.wabaId || '')
  const [phoneNumberId, setPhoneNumberId] = useState(channel?.phoneNumberId || '')
  const [whatsappToken, setWhatsappToken] = useState('')
  const [pageId, setPageId] = useState(channel?.pageId || '')
  const [pageAccessToken, setPageAccessToken] = useState('')
  const [igAccountId, setIgAccountId] = useState(channel?.igAccountId || '')
  const [verifyToken, setVerifyToken] = useState(channel?.verifyToken || '')
  const [appSecret, setAppSecret] = useState(channel?.appSecret || '')
  const [showSecrets, setShowSecrets] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reset when channel changes
  useEffect(() => {
    if (channel) {
      setType(channel.type); setName(channel.name); setDisplayName(channel.displayName)
      setAccountId(channel.accountId || ''); setCountry(channel.country || 'CO')
      setPaymentStrategy(channel.paymentStrategy)
      setRequirePrepayMin(channel.requirePrepayMin?.toString() || '')
      setPrepayDiscountPct(channel.prepayDiscountPct?.toString() || '5')
      setCodFee(channel.codFee?.toString() || '8000')
      setWabaId(channel.wabaId || ''); setPhoneNumberId(channel.phoneNumberId || '')
      setPageId(channel.pageId || ''); setIgAccountId(channel.igAccountId || '')
      setVerifyToken(channel.verifyToken || ''); setAppSecret(channel.appSecret || '')
      setWhatsappToken(''); setPageAccessToken('')
    } else {
      setType('whatsapp'); setName(''); setDisplayName(''); setAccountId(''); setCountry('CO')
      setPaymentStrategy('hybrid'); setRequirePrepayMin(''); setPrepayDiscountPct('5'); setCodFee('8000')
      setWabaId(''); setPhoneNumberId(''); setWhatsappToken('')
      setPageId(''); setPageAccessToken(''); setIgAccountId('')
      setVerifyToken(''); setAppSecret('')
    }
  }, [channel, open])

  const save = async () => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        tenantId, type, name, displayName, accountId: accountId || null, country,
        paymentStrategy, verified: true, active: true,
        requirePrepayMin: requirePrepayMin ? Number(requirePrepayMin) : null,
        prepayDiscountPct: Number(prepayDiscountPct) || 0,
        codFee: Number(codFee) || 0,
        verifyToken: verifyToken || null,
        appSecret: appSecret || null,
      }
      // Type-specific credentials
      if (type === 'whatsapp') {
        payload.wabaId = wabaId || null
        payload.phoneNumberId = phoneNumberId || null
        if (whatsappToken) payload.whatsappToken = whatsappToken // only update if provided
      }
      if (type === 'messenger') {
        payload.pageId = pageId || null
        if (pageAccessToken) payload.pageAccessToken = pageAccessToken
      }
      if (type === 'instagram') {
        payload.igAccountId = igAccountId || null
        if (pageAccessToken) payload.pageAccessToken = pageAccessToken // IG uses same Meta token
      }

      if (channel) {
        // Edit
        payload.channelId = channel.id
        await fetch('/api/channels', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        toast.success('Canal actualizado')
      } else {
        // Create
        await fetch('/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        toast.success('Canal creado')
      }
      onSaved()
    } catch {
      toast.error('No se pudo guardar el canal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>{channel ? 'Editar canal' : 'Nuevo canal'}</DialogTitle>
          <DialogDescription>Configura los campos según el tipo de canal. Los campos marcados con * son obligatorios.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cd-type" className="text-xs">Tipo de canal *</Label>
              <Select value={type} onValueChange={setType} disabled={!!channel}>
                <SelectTrigger id="cd-type" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">📱 WhatsApp</SelectItem>
                  <SelectItem value="messenger">💬 Messenger</SelectItem>
                  <SelectItem value="instagram">📸 Instagram</SelectItem>
                  <SelectItem value="telegram">✈️ Telegram</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cd-country" className="text-xs">País</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="cd-country" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CO">🇨🇴 Colombia</SelectItem>
                  <SelectItem value="MX">🇲🇽 México</SelectItem>
                  <SelectItem value="ES">🇪🇸 España</SelectItem>
                  <SelectItem value="DE">🇩🇪 Alemania</SelectItem>
                  <SelectItem value="">🌍 Internacional</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cd-name" className="text-xs">Nombre interno *</Label>
              <Input id="cd-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="WhatsApp Colombia" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cd-display-name" className="text-xs">Display name *</Label>
              <Input id="cd-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="WhatsApp · CO" className="h-9" />
            </div>
          </div>

          {/* Payment strategy */}
          <Separator />
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cd-strategy" className="text-xs">Estrategia pago</Label>
              <Select value={paymentStrategy} onValueChange={setPaymentStrategy}>
                <SelectTrigger id="cd-strategy" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="advance">Anticipado</SelectItem>
                  <SelectItem value="cod">Contra entrega</SelectItem>
                  <SelectItem value="hybrid">Híbrido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cd-prepay-min" className="text-xs">Min prepay (COP)</Label>
              <Input id="cd-prepay-min" type="number" value={requirePrepayMin} onChange={(e) => setRequirePrepayMin(e.target.value)} placeholder="250000" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cd-prepay-disc" className="text-xs">% descuento prepay</Label>
              <Input id="cd-prepay-disc" type="number" value={prepayDiscountPct} onChange={(e) => setPrepayDiscountPct(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* Credentials by type */}
          <Separator />
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-1.5"><Key className="size-3.5" /> Credenciales</Label>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowSecrets(!showSecrets)}>
              {showSecrets ? <EyeOff className="size-3" /> : <Eye className="size-3" />} {showSecrets ? 'Ocultar' : 'Mostrar'}
            </Button>
          </div>

          {type === 'whatsapp' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-2">
              <div className="col-span-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">WhatsApp Cloud API (Meta Business)</div>
              <div className="space-y-1">
                <Label htmlFor="cd-waba-id" className="text-xs">WABA ID *</Label>
                <Input id="cd-waba-id" value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="123456789012345" className="h-9 font-mono text-xs" type={showSecrets ? 'text' : 'password'} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cd-phone-id" className="text-xs">Phone Number ID *</Label>
                <Input id="cd-phone-id" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="987654321098765" className="h-9 font-mono text-xs" type={showSecrets ? 'text' : 'password'} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="cd-wa-token" className="text-xs">Access Token {channel && '(dejar vacío para mantener actual)'}</Label>
                <Input id="cd-wa-token" value={whatsappToken} onChange={(e) => setWhatsappToken(e.target.value)} placeholder="EAAG..." className="h-9 font-mono text-xs" type={showSecrets ? 'text' : 'password'} />
              </div>
            </div>
          )}

          {type === 'messenger' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-sky-500/5 border border-sky-500/20 space-y-2">
              <div className="col-span-2 text-xs font-medium text-sky-700 dark:text-sky-400">Facebook Messenger</div>
              <div className="space-y-1">
                <Label htmlFor="cd-page-id" className="text-xs">Page ID *</Label>
                <Input id="cd-page-id" value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="1234567890" className="h-9 font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cd-account-id" className="text-xs">Account ID (número)</Label>
                <Input id="cd-account-id" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="+57 300 111 2233" className="h-9" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="cd-page-token" className="text-xs">Page Access Token {channel && '(dejar vacío para mantener actual)'}</Label>
                <Input id="cd-page-token" value={pageAccessToken} onChange={(e) => setPageAccessToken(e.target.value)} placeholder="EAAG..." className="h-9 font-mono text-xs" type={showSecrets ? 'text' : 'password'} />
              </div>
            </div>
          )}

          {type === 'instagram' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-fuchsia-500/5 border border-fuchsia-500/20 space-y-2">
              <div className="col-span-2 text-xs font-medium text-fuchsia-700 dark:text-fuchsia-400">Instagram DM</div>
              <div className="space-y-1">
                <Label htmlFor="cd-ig-id" className="text-xs">IG Business Account ID *</Label>
                <Input id="cd-ig-id" value={igAccountId} onChange={(e) => setIgAccountId(e.target.value)} placeholder="1784..." className="h-9 font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cd-ig-handle" className="text-xs">Account ID (handle)</Label>
                <Input id="cd-ig-handle" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="@commerceflow" className="h-9" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="cd-ig-token" className="text-xs">Access Token {channel && '(dejar vacío para mantener actual)'}</Label>
                <Input id="cd-ig-token" value={pageAccessToken} onChange={(e) => setPageAccessToken(e.target.value)} placeholder="EAAG..." className="h-9 font-mono text-xs" type={showSecrets ? 'text' : 'password'} />
              </div>
            </div>
          )}

          {/* Webhook security (all channels) */}
          <Separator />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cd-verify-token" className="text-xs">Verify Token (webhook)</Label>
              <Input id="cd-verify-token" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} placeholder="commerceflow_verify" className="h-9 font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cd-app-secret" className="text-xs">App Secret (HMAC)</Label>
              <Input id="cd-app-secret" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="abc123..." className="h-9 font-mono text-xs" type={showSecrets ? 'text' : 'password'} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-1.5"><X className="size-3.5" /> Cancelar</Button>
          <Button onClick={save} disabled={saving || !name || !displayName} className="gap-1.5">
            {saving ? t('common.saving_data') : <><Save className="size-3.5" /> {t('common.save')}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
