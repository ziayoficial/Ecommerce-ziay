// ZIAY — IntegrationsView (main composition).
//
// SPRINT8-VIEWS-SPLIT-001 split the original 956-line integrations-view.tsx
// into focused sub-modules under this directory:
//   - integrations-shared.tsx       — types, helpers, ECOM_ROUTES,
//                                     LOGISTICS_ROUTES, statusMeta
//   - integrations-health.tsx       — the /api/health endpoint table
//   - integrations-credentials.tsx  — CredentialPanel + CredentialCard
//   - integrations-tools.tsx        — freight quote tester + VLM identifier
//
// This file owns the state machine (health checks, active adapters,
// catalog, freight + vision testers) and composes the sub-modules.
// The header summary cards, EcommerceAdapter / LogisticsAdapter route
// cards, and catalog grid are inline because they read directly from the
// shared state. UI is byte-for-byte identical to the original.

'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'

import { cn } from '@/lib/utils'
import { useTenantId } from '@/hooks/use-tenant'
import { formatCurrency } from '@/lib/format'

import {
  ShoppingBag, Truck, Plug, Package, Zap, Database,
} from 'lucide-react'

import {
  type HealthCheck, type Product, type FreightQuoteResult, type VisionResult,
  ECOM_ROUTES, LOGISTICS_ROUTES, statusMeta,
} from './integrations-shared'
import { IntegrationsHealthTable } from './integrations-health'
import { IntegrationsTools } from './integrations-tools'
import { CredentialPanel } from './integrations-credentials'

export function IntegrationsView() {
  const tenantId = useTenantId()
  const [checks, setChecks] = useState<HealthCheck[]>([])
  const [activeCatalog, setActiveCatalog] = useState<string>('')
  const [activeLogistics, setActiveLogistics] = useState<string>('')
  const [checksLoading, setChecksLoading] = useState(true)

  const [products, setProducts] = useState<Product[]>([])
  const [prodLoading, setProdLoading] = useState(true)
  const [prodQ, setProdQ] = useState('')

  // Freight quote tester
  const [fqCity, setFqCity] = useState('Bogotá')
  const [fqCountry, setFqCountry] = useState('CO')
  const [fqUnits, setFqUnits] = useState('6')
  const [fqLoading, setFqLoading] = useState(false)
  const [fqResult, setFqResult] = useState<FreightQuoteResult | null>(null)

  // Vision identifier
  const [viUrl, setViUrl] = useState('')
  const [viLoading, setViLoading] = useState(false)
  const [viResult, setViResult] = useState<VisionResult | null>(null)

  // Load health + products
  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    setChecksLoading(true)
    fetch(`/api/health?tenantId=${tenantId}`).then(r => r.json()).then(d => {
      if (cancelled) return
      const all = (d.checks || []) as HealthCheck[]
      setChecks(all)
      // Resolve the active catalog / logistics adapter from the tenant-specific health rows
      const cat = all.find(c => c.name === 'tenant_catalog_adapter')
      const log = all.find(c => c.name === 'tenant_logistics_adapter')
      if (cat) setActiveCatalog((cat.detail.match(/'([^']+)'/)?.[1] || '').trim())
      if (log) setActiveLogistics((log.detail.match(/'([^']+)'/)?.[1] || '').trim())
      setChecksLoading(false)
    }).catch(() => { if (!cancelled) setChecksLoading(false) })

    return () => { cancelled = true }
  }, [tenantId])

  // Load catalog
  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    setProdLoading(true)
    fetch(`/api/catalog/products?tenantId=${tenantId}&q=${encodeURIComponent(prodQ)}`).then(r => r.json()).then(d => {
      if (cancelled) return
      setProducts(d.products || [])
      setProdLoading(false)
    }).catch(() => { if (!cancelled) setProdLoading(false) })
    return () => { cancelled = true }
  }, [tenantId, prodQ])

  const adapterStatus = (id: string): HealthCheck['status'] => {
    const c = checks.find(c => c.name === `adapter_${id}` || c.name === `logistics_${id}`)
    return c?.status || 'not_configured'
  }

  const runFreightQuote = async () => {
    if (!tenantId || !fqCity.trim()) return
    setFqLoading(true)
    setFqResult(null)
    try {
      const res = await fetch('/api/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, ciudad: fqCity.trim(),
          pais: fqCountry, cantidad_unidades: Number(fqUnits) || 1,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error en la cotización')
      setFqResult(data)
      toast.success(`Cotización: ${formatCurrency(data.quote.tarifa, 'COP')} · ${data.quote.transportadora}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setFqResult({ error: msg })
      toast.error('No se pudo cotizar el flete', { description: msg })
    } finally {
      setFqLoading(false)
    }
  }

  const runVision = async () => {
    if (!tenantId || !viUrl.trim()) return
    setViLoading(true)
    setViResult(null)
    try {
      const res = await fetch('/api/agents/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, imageUrl: viUrl.trim() }),
      })
      const data = await res.json()
      setViResult({
        reply: data.reply || '',
        agent: data.agent || 'vision',
        confidence: data.confidence || 0,
        error: data.error,
      })
      if (data.error) toast.info('IA no disponible — fallback usado')
      else toast.success(`SKU detectado · confianza ${(data.confidence * 100).toFixed(0)}%`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setViResult({ reply: '', agent: 'vision', confidence: 0, error: msg })
      toast.error('No se pudo identificar la imagen')
    } finally {
      setViLoading(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header — summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 flex items-center justify-center"><Plug className="size-5" /></div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">EcommerceAdapter</div>
              <div className="text-xs text-muted-foreground">5 rutas · 1 activa por tenant</div>
            </div>
            <Badge variant="outline" className="ml-auto text-[10px]">{activeCatalog || '—'}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 flex items-center justify-center"><Truck className="size-5" /></div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">LogisticsAdapter</div>
              <div className="text-xs text-muted-foreground">3 proveedores · 1 activo por tenant</div>
            </div>
            <Badge variant="outline" className="ml-auto text-[10px]">{activeLogistics || '—'}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20 flex items-center justify-center"><Database className="size-5" /></div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Estado de integraciones</div>
              <div className="text-xs text-muted-foreground">{checks.filter(c => c.status === 'ok').length} OK · {checks.filter(c => c.status === 'warning').length} parciales · {checks.filter(c => c.status === 'not_configured').length} sin configurar</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* EcommerceAdapter routes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingBag className="size-4 text-primary" /> EcommerceAdapter — 5 rutas de catálogo
          </CardTitle>
          <CardDescription>Saramantha §8.1–§8.5 · el adaptador concreto se resuelve en runtime desde <code className="text-[11px]">tenant.plataformaCatalogo</code></CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ECOM_ROUTES.map(route => {
              const status = adapterStatus(route.id === 'whatsapp_catalog' ? 'whatsapp' : route.id === 'catalogo_propio_cliente' || route.id === 'catalogo_nuestro' ? 'supabase' : route.id)
              const meta = statusMeta(status)
              const Icon = meta.icon
              const isActive = activeCatalog === route.id
              return (
                <div
                  key={route.id}
                  className={cn(
                    'rounded-xl border p-3 space-y-2 transition-all',
                    isActive ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xl leading-none">{route.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{route.label}</span>
                        {isActive && <Badge variant="default" className="text-[9px] h-4 px-1 gap-0.5"><Zap className="size-2.5" /> activo</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 whitespace-normal break-words">{route.spec}</div>
                    </div>
                    <Icon className={cn('size-4 shrink-0', meta.iconCls)} />
                  </div>
                  <div className="flex items-start gap-1.5 text-[10px] min-w-0">
                    <span className={cn('size-1.5 rounded-full shrink-0 mt-1', meta.dot)} />
                    <span className="text-muted-foreground whitespace-normal break-words min-w-0">{meta.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* LogisticsAdapter routes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="size-4 text-emerald-600" /> LogisticsAdapter — 3 proveedores multitransportadora
          </CardTitle>
          <CardDescription>Saramantha §9.6, §8.6 · el adaptador concreto se resuelve desde <code className="text-[11px]">tenant.proveedorLogistico</code></CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {LOGISTICS_ROUTES.map(route => {
              const status = adapterStatus(route.id)
              const meta = statusMeta(status)
              const Icon = meta.icon
              const isActive = activeLogistics === route.id
              return (
                <div
                  key={route.id}
                  className={cn(
                    'rounded-xl border p-3 space-y-2 transition-all',
                    isActive ? 'border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20' : 'border-border'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xl leading-none">{route.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{route.label}</span>
                        {isActive && <Badge variant="default" className="text-[9px] h-4 px-1 gap-0.5 bg-emerald-600 text-white"><Zap className="size-2.5" /> activo</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 whitespace-normal break-words">{route.spec}</div>
                    </div>
                    <Icon className={cn('size-4 shrink-0', meta.iconCls)} />
                  </div>
                  <div className="flex items-start gap-1.5 text-[10px] min-w-0">
                    <span className={cn('size-1.5 rounded-full shrink-0 mt-1', meta.dot)} />
                    <span className="text-muted-foreground whitespace-normal break-words min-w-0">{meta.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Two-column: freight tester + vision identifier */}
      <IntegrationsTools
        tenantId={tenantId}
        fqCity={fqCity}
        setFqCity={setFqCity}
        fqCountry={fqCountry}
        setFqCountry={setFqCountry}
        fqUnits={fqUnits}
        setFqUnits={setFqUnits}
        fqLoading={fqLoading}
        fqResult={fqResult}
        onRunFreightQuote={runFreightQuote}
        viUrl={viUrl}
        setViUrl={setViUrl}
        viLoading={viLoading}
        viResult={viResult}
        onRunVision={runVision}
      />

      {/* Catalog grid */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="size-4 text-primary" /> Catálogo sincronizado
              </CardTitle>
              <CardDescription>Productos leídos vía EcommerceAdapter activo · {products.length} items</CardDescription>
            </div>
            <div className="relative">
              <Input value={prodQ} onChange={(e) => setProdQ(e.target.value)} placeholder="Buscar SKU, nombre, diseño..." className="pl-3 h-9 w-full md:w-64" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {prodLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Sin productos en el catálogo de este tenant</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {products.map(p => (
                <TooltipProvider key={p.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="rounded-lg border overflow-hidden hover:shadow-md hover:border-primary/30 transition-all cursor-default bg-card">
                        <div className="aspect-square bg-muted relative overflow-hidden">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} className="size-full object-cover" loading="lazy" />
                          ) : (
                            <div className="size-full flex items-center justify-center text-muted-foreground/60">
                              <Package className="size-8" />
                            </div>
                          )}
                          {p.fuenteSincronizacion && (
                            <Badge variant="outline" className="absolute top-1 left-1 text-[9px] h-4 px-1 bg-background/80 backdrop-blur">
                              {p.fuenteSincronizacion}
                            </Badge>
                          )}
                        </div>
                        <div className="p-2 space-y-0.5">
                          <div className="font-mono text-[10px] text-muted-foreground truncate">{p.sku}</div>
                          <div className="text-xs font-medium truncate" title={p.name}>{p.name}</div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold tabular-nums">{formatCurrency(p.price)}</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">{p.stock}und</span>
                          </div>
                          {p.diseno && <div className="text-[9px] text-violet-600 truncate">🎨 {p.diseno}</div>}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs max-w-48">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-muted-foreground">{p.sku} · {p.categoria || '—'}</div>
                        {p.description && <div className="mt-1 text-[10px]">{p.description}</div>}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full health table */}
      <IntegrationsHealthTable checks={checks} checksLoading={checksLoading} />

      {/* Credential management panel — where users actually enter the
          secrets that the adapters (woocommerce, mercadopago, ...) read.
          Renders below the health table so the user can see the live state
          first, then jump down to configure what's missing. */}
      <CredentialPanel />
    </div>
  )
}
