// ZIAY — Marketplace cross-brand dashboard view (main composition).
// Split out from marketplace-view.tsx in AUDIT-FINAL-SPLIT-001 — owns the
// state (load / refresh / lead-config form) and composes the three tab
// sub-components (CatalogTab / MyListingsTab / ReferralsTab) plus the
// publish-listing dialog.

'use client'
import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/hooks/use-tenant'
import { toast } from 'sonner'
import {
  Store, Users, Share2, Plus, Package, RefreshCw, CheckCircle2,
} from 'lucide-react'
import { type MarketplaceData } from './marketplace-shared'
import { CatalogTab } from './marketplace-listings'
import { MyListingsTab } from './marketplace-my'
import { ReferralsTab } from './marketplace-referrals'

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
          <CatalogTab
            listings={data.listings}
            fromTenantId={tenantId!}
            onDone={load}
          />
        </TabsContent>

        {/* Mis listings */}
        <TabsContent value="mine" className="mt-4">
          <MyListingsTab
            myListings={data.myListings}
            tenantId={tenantId!}
            onDone={load}
          />
        </TabsContent>

        {/* Referrals */}
        <TabsContent value="referrals" className="mt-4">
          <ReferralsTab
            sent={data.referrals.sent}
            received={data.referrals.received}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Internal sub-components (only used in the main view header)
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
