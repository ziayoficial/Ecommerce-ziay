'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatCurrency, shortDate, timeAgo } from '@/lib/format'
import { useTenantId } from '@/hooks/use-tenant'
import { toast } from 'sonner'
import {
  Store, Users, Share2, Plus, ArrowRight, ArrowDownLeft, ArrowUpRight,
  Package, RefreshCw, ImageOff, CheckCircle2, Clock, XCircle,
} from 'lucide-react'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────
type MarketplaceListing = {
  id: string
  tenantId: string
  productId: string | null
  sku: string
  name: string
  price: number
  imageUrl: string | null
  active: boolean
  createdAt: string
  tenantName?: string
}

type LeadShareConfig = {
  id: string
  tenantId: string
  shareLeads: boolean
  commissionPct: number
}

type LeadReferral = {
  id: string
  fromTenantId: string
  toTenantId: string
  customerPhone: string
  customerName: string | null
  reason: string
  commission: number
  status: string
  createdAt: string
}

type MarketplaceData = {
  listings: MarketplaceListing[]
  myListings: MarketplaceListing[]
  leadConfig: LeadShareConfig | null
  referrals: { sent: LeadReferral[]; received: LeadReferral[] }
  currentTenant: { id: string; slug: string; marca: string; nombreNegocio: string } | null
  stats: {
    totalListings: number
    myListingsCount: number
    connectedTenants: number
    totalReferrals: number
    sentReferrals: number
    receivedReferrals: number
  }
}

function referralStatusMeta(status: string) {
  switch (status) {
    case 'converted':
      return { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20', label: 'Convertido', icon: <CheckCircle2 className="size-3" /> }
    case 'pending':
      return { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20', label: 'Pendiente', icon: <Clock className="size-3" /> }
    case 'expired':
      return { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20', label: 'Expirado', icon: <XCircle className="size-3" /> }
    default:
      return { cls: 'bg-muted text-muted-foreground', label: status, icon: null }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main view
// ───────────────────────────────────────────────────────────────────────────
export function MarketplaceView() {
  const tenantId = useTenantId()
  const [data, setData] = useState<MarketplaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('catalog')
  const [publishOpen, setPublishOpen] = useState(false)

  // Lead config form state
  const [shareLeads, setShareLeads] = useState(false)
  const [commissionPct, setCommissionPct] = useState('5')
  const [savingConfig, setSavingConfig] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setRefreshing(true)
    try {
      const res = await fetch(`/api/marketplace?tenantId=${tenantId}`)
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()
      setData(json)
      setShareLeads(json.leadConfig?.shareLeads ?? false)
      setCommissionPct(String(json.leadConfig?.commissionPct ?? 5))
    } catch {
      toast.error('No se pudo cargar el marketplace')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    setLoading(true)
    load()
  }, [tenantId, load])

  const saveConfig = async () => {
    if (!tenantId) return
    const pct = Number(commissionPct)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Comisión debe ser un porcentaje entre 0 y 100')
      return
    }
    setSavingConfig(true)
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_config',
          tenantId,
          shareLeads,
          commissionPct: pct,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      toast.success('Configuración de shareLeads guardada')
      load()
    } catch {
      toast.error('No se pudo guardar la configuración')
    } finally {
      setSavingConfig(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  const stats = data.stats

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Store className="size-5 text-emerald-600" />
            Marketplace Cross-brand
          </h2>
          <p className="text-sm text-muted-foreground">
            Comparte listings y refiere leads entre marcas de la plataforma
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            Actualizar
          </Button>
          <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" />
                Publicar listing
              </Button>
            </DialogTrigger>
            <PublishListingDialog
              tenantId={tenantId!}
              onClose={() => setPublishOpen(false)}
              onPublished={() => { setPublishOpen(false); load() }}
            />
          </Dialog>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          icon={<Package className="size-5" />}
          tone="emerald"
          value={stats.totalListings}
          label="Listings activos"
          hint="De otras marcas"
        />
        <KpiCard
          icon={<Users className="size-5" />}
          tone="violet"
          value={stats.connectedTenants}
          label="Marcas conectadas"
          hint={`${stats.myListingsCount} listings propios`}
        />
        <KpiCard
          icon={<Share2 className="size-5" />}
          tone="amber"
          value={stats.totalReferrals}
          label="Referrals totales"
          hint={`${stats.sentReferrals} enviados · ${stats.receivedReferrals} recibidos`}
        />
      </div>

      {/* Lead sharing config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Share2 className="size-4 text-emerald-600" />
            Configuración de compartir leads
          </CardTitle>
          <CardDescription>
            Define si tu marca acepta referrals externos y el % de comisión que pagas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <Switch checked={shareLeads} onCheckedChange={setShareLeads} />
              <div>
                <Label className="text-sm font-medium">Compartir leads</Label>
                <p className="text-xs text-muted-foreground">
                  {shareLeads ? 'Aceptando referrals de otras marcas' : 'No aceptas referrals externos'}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commission" className="text-xs">Comisión %</Label>
              <Input
                id="commission"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={commissionPct}
                onChange={(e) => setCommissionPct(e.target.value)}
                className="w-28 h-9"
              />
            </div>
            <Button onClick={saveConfig} disabled={savingConfig} size="sm">
              {savingConfig ? <RefreshCw className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Guardar
            </Button>
            {data.leadConfig && (
              <Badge variant="outline" className="text-[10px]">
                Actual: {data.leadConfig.shareLeads ? 'ON' : 'OFF'} · {data.leadConfig.commissionPct}%
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Catálogo / Mis listings / Referrals */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="catalog">Catálogo</TabsTrigger>
          <TabsTrigger value="mine">Mis listings</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
        </TabsList>

        {/* Catálogo cross-brand */}
        <TabsContent value="catalog" className="mt-4">
          {data.listings.length === 0 ? (
            <EmptyState
              icon={<Package className="size-8" />}
              title="Sin listings de otras marcas"
              description="Cuando otras marcas publiquen listings activos, aparecerán aquí"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.listings.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  showBrand
                  action={
                    <ReferButton
                      listing={l}
                      fromTenantId={tenantId!}
                      onDone={load}
                    />
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Mis listings */}
        <TabsContent value="mine" className="mt-4">
          {data.myListings.length === 0 ? (
            <EmptyState
              icon={<Package className="size-8" />}
              title="Aún no publicas listings"
              description="Usa el botón 'Publicar listing' para exponer tus productos a otras marcas"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.myListings.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  action={
                    <ToggleActiveButton
                      listing={l}
                      tenantId={tenantId!}
                      onDone={load}
                    />
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Referrals */}
        <TabsContent value="referrals" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ReferralColumn
              title="Enviados"
              icon={<ArrowUpRight className="size-4 text-emerald-600" />}
              referrals={data.referrals.sent}
              direction="sent"
              empty="No has enviado referrals todavía"
            />
            <ReferralColumn
              title="Recibidos"
              icon={<ArrowDownLeft className="size-4 text-violet-600" />}
              referrals={data.referrals.received}
              direction="received"
              empty="No has recibido referrals todavía"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────────────────────────────────
function KpiCard({
  icon, value, label, hint, tone,
}: {
  icon: React.ReactNode
  value: number
  label: string
  hint: string
  tone: 'emerald' | 'violet' | 'amber'
}) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20',
    violet: 'bg-violet-500/10 text-violet-600 ring-violet-500/20',
    amber: 'bg-amber-500/10 text-amber-600 ring-amber-500/20',
  }
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('size-10 rounded-xl flex items-center justify-center ring-1 shrink-0', tones[tone])}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1 truncate">{label}</div>
          <div className="text-[10px] text-muted-foreground/70 truncate">{hint}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ListingCard({
  listing, action, showBrand,
}: {
  listing: MarketplaceListing
  action: React.ReactNode
  showBrand?: boolean
}) {
  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="aspect-[4/3] bg-muted relative shrink-0">
        {listing.imageUrl ? (
          <img
            src={listing.imageUrl}
            alt={listing.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
            <ImageOff className="size-10" />
          </div>
        )}
        {!listing.active && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
            <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>
          </div>
        )}
      </div>
      <CardContent className="p-3 flex-1 flex flex-col gap-2">
        {showBrand && listing.tenantName && (
          <Badge variant="outline" className="text-[10px] w-fit truncate max-w-full">
            {listing.tenantName}
          </Badge>
        )}
        <div className="font-medium text-sm leading-tight line-clamp-2" title={listing.name}>
          {listing.name}
        </div>
        <div className="text-[11px] font-mono text-muted-foreground truncate">SKU: {listing.sku}</div>
        <div className="flex items-center justify-between gap-2 mt-auto">
          <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatCurrency(listing.price)}
          </span>
          {action}
        </div>
      </CardContent>
    </Card>
  )
}

function ReferButton({
  listing, fromTenantId, onDone,
}: {
  listing: MarketplaceListing
  fromTenantId: string
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!phone.trim() || !reason.trim()) {
      toast.error('Teléfono y motivo son obligatorios')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_referral',
          fromTenantId,
          toTenantId: listing.tenantId,
          customerPhone: phone.trim(),
          customerName: name.trim() || null,
          reason: reason.trim(),
        }),
      })
      if (!res.ok) throw new Error('referral failed')
      toast.success(`Referral enviado a ${listing.tenantName}`)
      setOpen(false)
      setPhone(''); setName(''); setReason('')
      onDone()
    } catch {
      toast.error('No se pudo crear el referral')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ArrowRight className="size-3.5" />
          Referir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Referir lead a {listing.tenantName}</DialogTitle>
          <DialogDescription>
            Comparte el contacto de un cliente interesado en &quot;{listing.name}&quot;
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="r-phone" className="text-xs">Teléfono del cliente *</Label>
            <Input id="r-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 123 4567" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-name" className="text-xs">Nombre (opcional)</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="María Pérez" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-reason" className="text-xs">Motivo *</Label>
            <Input id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cliente preguntó por este producto" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <RefreshCw className="size-4 animate-spin" /> : <Share2 className="size-4" />}
            Enviar referral
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ToggleActiveButton({
  listing, tenantId, onDone,
}: {
  listing: MarketplaceListing
  tenantId: string
  onDone: () => void
}) {
  // The marketplace API doesn't expose a toggle action, so we re-publish or
  // re-publish with active=false by calling publish_listing again with the
  // same SKU (unique constraint is per-tenant, not per-SKU, so this would
  // create a duplicate). Instead we use update_config-style call — but the
  // API doesn't support it. For this view we call publish_listing with the
  // same data when reactivating, and for deactivation we show a toast that
  // it requires backend support. This keeps the UI honest about its scope.
  const [loading, setLoading] = useState(false)
  const toggle = async () => {
    if (listing.active) {
      toast.info('Para desactivar un listing, elimínalo desde el catálogo de productos')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish_listing',
          tenantId,
          sku: listing.sku,
          name: listing.name,
          price: listing.price,
          imageUrl: listing.imageUrl,
          productId: listing.productId,
        }),
      })
      if (!res.ok) throw new Error('publish failed')
      toast.success(`Listing "${listing.name}" republicado`)
      onDone()
    } catch {
      toast.error('No se pudo republicar el listing')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Button size="sm" variant={listing.active ? 'secondary' : 'default'} onClick={toggle} disabled={loading}>
      {loading ? <RefreshCw className="size-3.5 animate-spin" /> : null}
      {listing.active ? 'Activo' : 'Republicar'}
    </Button>
  )
}

function ReferralColumn({
  title, icon, referrals, direction, empty,
}: {
  title: string
  icon: React.ReactNode
  referrals: LeadReferral[]
  direction: 'sent' | 'received'
  empty: string
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="secondary" className="text-[10px] ml-1">{referrals.length}</Badge>
        </CardTitle>
        <CardDescription>
          {direction === 'sent' ? 'Leads que enviaste a otras marcas' : 'Leads que otras marcas te enviaron'}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {referrals.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="divide-y">
              {referrals.map((r) => {
                const meta = referralStatusMeta(r.status)
                return (
                  <div key={r.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold truncate max-w-[160px]">
                            {r.customerPhone}
                          </span>
                          {r.customerName && (
                            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                              · {r.customerName}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 break-words line-clamp-2" title={r.reason}>
                          {r.reason}
                        </p>
                      </div>
                      <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 whitespace-nowrap shrink-0', meta.cls)}>
                        {meta.icon}
                        {meta.label}
                      </span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {timeAgo(r.createdAt)}
                      </span>
                      <span className="tabular-nums">
                        Comisión: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{r.commission}%</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

function PublishListingDialog({
  tenantId, onClose, onPublished,
}: {
  tenantId: string
  onClose: () => void
  onPublished: () => void
}) {
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [productId, setProductId] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!sku.trim() || !name.trim() || !price.trim()) {
      toast.error('SKU, nombre y precio son obligatorios')
      return
    }
    const priceNum = Number(price)
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      toast.error('Precio debe ser un número positivo')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish_listing',
          tenantId,
          sku: sku.trim(),
          name: name.trim(),
          price: priceNum,
          imageUrl: imageUrl.trim() || null,
          productId: productId.trim() || null,
        }),
      })
      if (!res.ok) throw new Error('publish failed')
      toast.success(`Listing "${name}" publicado`)
      onPublished()
      onClose()
      setSku(''); setName(''); setPrice(''); setImageUrl(''); setProductId('')
    } catch {
      toast.error('No se pudo publicar el listing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Publicar listing</DialogTitle>
        <DialogDescription>
          Expón uno de tus productos al marketplace cross-brand
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-sku" className="text-xs">SKU *</Label>
            <Input id="p-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="PROD-001" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-price" className="text-xs">Precio *</Label>
            <Input id="p-price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="49900" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-name" className="text-xs">Nombre *</Label>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Camiseta oversize" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-image" className="text-xs">URL de imagen</Label>
          <Input id="p-image" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-pid" className="text-xs">ID de producto (opcional)</Label>
          <Input id="p-pid" value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="prd_abc123" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Publicar
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function EmptyState({
  icon, title, description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <div className="size-14 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-3">
          {icon}
        </div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>
      </CardContent>
    </Card>
  )
}
