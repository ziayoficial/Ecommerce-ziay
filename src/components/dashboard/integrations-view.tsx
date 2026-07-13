'use client'
import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/hooks/use-tenant'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import {
  ShoppingBag, Truck, Plug, Package, Calculator, Eye, Sparkles, CheckCircle2,
  XCircle, AlertTriangle, Loader2, Zap, Database, Send,
  Key, EyeOff, Save, Trash2, AlertCircle, ChevronDown,
} from 'lucide-react'
import {
  INTEGRATION_REGISTRY,
  CATEGORY_META,
  CATEGORY_ORDER,
  getIntegrationsByCategory,
  type IntegrationConfig,
  type IntegrationCategory,
} from '@/lib/adapters/credential-fields'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────
type HealthCheck = { name: string; status: 'ok' | 'warning' | 'error' | 'not_configured'; detail: string }

type Product = {
  id: string; sku: string; name: string; description: string | null
  price: number; imageUrl: string | null; stock: number
  diseno: string | null; categoria: string | null
  fuenteSincronizacion: string | null
}

type FreightQuoteResult = {
  ok: boolean
  ciudad: string
  pais: string
  cantidad_unidades: number
  quote: { tarifa: number; tiempo_estimado_dias: number; transportadora: string }
} | { error: string }

type VisionResult = {
  reply: string
  agent: string
  confidence: number
  error?: string
}

type CredentialState = {
  configured: boolean
  fields: Record<string, string>
}

type CredentialsResponse = {
  integrations: Record<string, CredentialState>
}

// ───────────────────────────────────────────────────────────────────────────
// Static registry metadata — mirrors src/lib/adapters/registry.ts so the UI
// shows all 4 ecommerce routes + 3 logistics providers even before health data
// loads. The "active" badge comes from the per-tenant config (tenant.
// plataformaCatalogo / tenant.proveedorLogistico) which the /api/health endpoint
// already exposes via `tenant_catalog_adapter` / `tenant_logistics_adapter`.
// ───────────────────────────────────────────────────────────────────────────
const ECOM_ROUTES = [
  { id: 'whatsapp_catalog',  label: 'WhatsApp Catalog',   emoji: '💬', spec: '§8.2 — catálogo gestionado por Meta Commerce' },
  { id: 'woocommerce',       label: 'WooCommerce',        emoji: '🛒', spec: '§8.3 — REST consumer_key/secret del cliente' },
  { id: 'shopify',           label: 'Shopify',            emoji: '🅢', spec: '§8.3 — Admin GraphQL + OAuth access token' },
  { id: 'catalogo_propio_cliente', label: 'Supabase (cliente)', emoji: '🔌', spec: '§8.4 — read-only, sin escritura de inventario' },
  { id: 'catalogo_nuestro',  label: 'Supabase (nuestra)', emoji: '🗄️', spec: '§8.4 — read-write, multi-tenant' },
] as const

const LOGISTICS_ROUTES = [
  { id: 'dropi',     label: 'Dropi',       emoji: '📦', spec: '§9.6 — multitransportadora CO' },
  { id: '99envios',  label: '99envios',    emoji: '🚚', spec: '§9.6 — multitransportadora CO' },
  { id: 'aveonline', label: 'Aveonline',   emoji: '✈️', spec: '§9.6 — multitransportadora CO' },
] as const

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
function statusMeta(s: HealthCheck['status']) {
  switch (s) {
    case 'ok': return { label: 'Configurado',   dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', icon: CheckCircle2, iconCls: 'text-emerald-600' }
    case 'warning': return { label: 'Parcial',   dot: 'bg-amber-500',   badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',     icon: AlertTriangle, iconCls: 'text-amber-600' }
    case 'error': return { label: 'Error',       dot: 'bg-rose-500',    badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',        icon: XCircle, iconCls: 'text-rose-600' }
    default: return { label: 'No configurado',   dot: 'bg-slate-400',   badge: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',     icon: XCircle, iconCls: 'text-slate-500 dark:text-slate-400' }
  }
}

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
                      <div className="text-[10px] text-muted-foreground mt-0.5">{route.spec}</div>
                    </div>
                    <Icon className={cn('size-4 shrink-0', meta.iconCls)} />
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className={cn('size-1.5 rounded-full', meta.dot)} />
                    <span className="text-muted-foreground">{meta.label}</span>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                      <div className="text-[10px] text-muted-foreground mt-0.5">{route.spec}</div>
                    </div>
                    <Icon className={cn('size-4 shrink-0', meta.iconCls)} />
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className={cn('size-1.5 rounded-full', meta.dot)} />
                    <span className="text-muted-foreground">{meta.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Two-column: freight tester + vision identifier */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Freight quote tester */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="size-4 text-amber-600" /> Cotizador de flete
            </CardTitle>
            <CardDescription>Saramantha §6.8, §8.6 · usa el LogisticsAdapter activo del tenant</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="fq-city" className="text-xs text-muted-foreground">Ciudad destino</Label>
                <Input id="fq-city" value={fqCity} onChange={(e) => setFqCity(e.target.value)} placeholder="Bogotá" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fq-country" className="text-xs text-muted-foreground">País</Label>
                <Input id="fq-country" value={fqCountry} onChange={(e) => setFqCountry(e.target.value.toUpperCase())} placeholder="CO" maxLength={3} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fq-units" className="text-xs text-muted-foreground">Unidades</Label>
                <Input id="fq-units" type="number" min={1} value={fqUnits} onChange={(e) => setFqUnits(e.target.value)} />
              </div>
            </div>
            <Button onClick={runFreightQuote} disabled={fqLoading || !tenantId} className="w-full gap-1.5">
              {fqLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Cotizar flete
            </Button>
            {fqResult && (
              <div className="rounded-lg border p-3 bg-muted/30 text-sm">
                {'error' in fqResult ? (
                  <div className="flex items-center gap-2 text-rose-600">
                    <XCircle className="size-4 shrink-0" />
                    <span className="text-xs">{fqResult.error}</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Tarifa</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(fqResult.quote.tarifa, fqResult.pais === 'CO' ? 'COP' : 'USD')}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Tiempo estimado</span>
                      <span className="font-medium tabular-nums">{fqResult.quote.tiempo_estimado_dias} días</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Transportadora</span>
                      <Badge variant="outline" className="text-[10px]">{fqResult.quote.transportadora}</Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{fqResult.ciudad}, {fqResult.pais}</span>
                      <span>{fqResult.cantidad_unidades} und</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vision identifier */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-violet-600" /> Identificador visual (VLM)
            </CardTitle>
            <CardDescription>Saramantha §6.9 · agent "vision" · lee la franja de metadata de la imagen y devuelve el SKU</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="vi-url" className="text-xs text-muted-foreground">URL de la imagen del cliente</Label>
              <Input id="vi-url" value={viUrl} onChange={(e) => setViUrl(e.target.value)} placeholder="https://.../producto.jpg" />
              <p className="text-[10px] text-muted-foreground mt-1">El agente prioriza la franja de metadata (OCR). Si está recortada, compara visualmente contra el catálogo.</p>
            </div>
            <Button onClick={runVision} disabled={viLoading || !tenantId || !viUrl.trim()} variant="outline" className="w-full gap-1.5">
              {viLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Identificar producto
            </Button>
            {viResult && (
              <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300">agente {viResult.agent}</Badge>
                  {viResult.error
                    ? <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300">fallback</Badge>
                    : <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">confianza {(viResult.confidence * 100).toFixed(0)}%</Badge>}
                </div>
                <pre className="text-[11px] whitespace-pre-wrap break-words text-foreground/90 font-mono bg-background p-2 rounded border">{viResult.reply || '—'}</pre>
                {viResult.error && <p className="text-[10px] text-amber-600">IA no disponible — fallback determinístico.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" /> Estado completo del endpoint /api/health
          </CardTitle>
          <CardDescription>Lecturas reales por integración · refresh para revalidar</CardDescription>
        </CardHeader>
        <CardContent>
          {checksLoading ? (
            <div className="space-y-1.5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {checks.map(c => {
                const meta = statusMeta(c.status)
                const Icon = meta.icon
                return (
                  <div key={c.name} className="flex items-center gap-2 p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <Icon className={cn('size-3.5 shrink-0', meta.iconCls)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium font-mono truncate">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{c.detail}</div>
                    </div>
                    <Badge variant="outline" className={cn('text-[9px] h-4 px-1 shrink-0', meta.badge)}>{meta.label}</Badge>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credential management panel — where users actually enter the
          secrets that the adapters (woocommerce, mercadopago, ...) read.
          Renders below the health table so the user can see the live state
          first, then jump down to configure what's missing. */}
      <CredentialPanel />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CredentialPanel — full credential management UI.
//
// Loads the masked state from /api/integrations/credentials on mount, groups
// the integrations by category, and renders one expandable card per
// integration. Each card has show/hide password toggles, a Guardar button
// (POST) and an Eliminar button (DELETE).
//
// Local draft state: `drafts[integrationId][fieldKey] = string`. When the
// user expands a card, the draft is seeded from the masked server value
// (i.e. `••••abcd`); when the user starts typing, the draft is replaced.
// On save we send the whole draft — fields still showing the mask are sent
// as the mask literal, but the API merges with existing values, so any
// unchanged masked field is overwritten with the mask string. To avoid
// this footgun, we skip sending fields whose draft value still equals the
// masked server value.
// ───────────────────────────────────────────────────────────────────────────

function CredentialPanel() {
  const [creds, setCreds] = useState<Record<string, CredentialState>>({})
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Per-integration draft fields (raw user input).
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  // Per-field password visibility toggle. Keyed by `${integrationId}.${fieldKey}`.
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  // Per-integration in-flight save/delete state (for button spinners).
  const [busy, setBusy] = useState<Record<string, 'save' | 'delete' | undefined>>({})

  const loadCredentials = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrations/credentials')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as CredentialsResponse
      setCreds(data.integrations || {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      toast.error('No se pudieron cargar las credenciales', { description: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCredentials()
  }, [loadCredentials])

  const grouped = getIntegrationsByCategory()

  const toggleExpand = (integrationId: string) => {
    setExpandedId((prev) => (prev === integrationId ? null : integrationId))
    // Seed the draft from the masked server value when first expanding.
    setDrafts((prev) => {
      if (prev[integrationId]) return prev
      const server = creds[integrationId]?.fields || {}
      return { ...prev, [integrationId]: { ...server } }
    })
  }

  const updateDraft = (integrationId: string, fieldKey: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [integrationId]: {
        ...(prev[integrationId] || {}),
        [fieldKey]: value,
      },
    }))
  }

  const toggleVisible = (integrationId: string, fieldKey: string) => {
    const k = `${integrationId}.${fieldKey}`
    setVisible((prev) => ({ ...prev, [k]: !prev[k] }))
  }

  // Strip fields whose draft still equals the masked server value so we
  // don't overwrite the stored secret with the mask literal.
  const buildSavePayload = (integration: IntegrationConfig): Record<string, string> => {
    const draft = drafts[integration.id] || {}
    const server = creds[integration.id]?.fields || {}
    const payload: Record<string, string> = {}
    for (const field of integration.fields) {
      const v = draft[field.key] ?? ''
      if (v && v === server[field.key]) continue // unchanged mask
      payload[field.key] = v
    }
    return payload
  }

  const handleSave = async (integration: IntegrationConfig) => {
    const payload = buildSavePayload(integration)
    setBusy((b) => ({ ...b, [integration.id]: 'save' }))
    try {
      const res = await fetch('/api/integrations/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration: integration.id, fields: payload }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as CredentialState & { integration: string }
      setCreds((prev) => ({
        ...prev,
        [integration.id]: { configured: data.configured, fields: data.fields },
      }))
      // Re-seed the draft from the freshly masked server state so the
      // inputs show the updated mask right away.
      setDrafts((prev) => ({
        ...prev,
        [integration.id]: { ...data.fields },
      }))
      toast.success(`${integration.name}: credenciales guardadas`, {
        description: data.configured ? 'Integración lista para usar' : 'Faltan campos requeridos',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      toast.error(`No se pudieron guardar las credenciales de ${integration.name}`, { description: msg })
    } finally {
      setBusy((b) => ({ ...b, [integration.id]: undefined }))
    }
  }

  const handleDelete = async (integration: IntegrationConfig) => {
    setBusy((b) => ({ ...b, [integration.id]: 'delete' }))
    try {
      const res = await fetch('/api/integrations/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration: integration.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      setCreds((prev) => {
        const next = { ...prev }
        delete next[integration.id]
        return next
      })
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[integration.id]
        return next
      })
      setExpandedId((prev) => (prev === integration.id ? null : prev))
      toast.success(`${integration.name}: credenciales eliminadas`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      toast.error(`No se pudieron eliminar las credenciales de ${integration.name}`, { description: msg })
    } finally {
      setBusy((b) => ({ ...b, [integration.id]: undefined }))
    }
  }

  const totalConfigured = Object.values(creds).filter((c) => c.configured).length
  const totalIntegrations = INTEGRATION_REGISTRY.length

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="size-4 text-primary" /> Configuración de Credenciales
            </CardTitle>
            <CardDescription>
              {totalConfigured} de {totalIntegrations} integraciones configuradas · las credenciales se guardan cifradas y nunca se muestran completas
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadCredentials()} disabled={loading} className="gap-1.5 self-start">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
            Recargar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : (
          CATEGORY_ORDER.map((cat: IntegrationCategory) => {
            const meta = CATEGORY_META[cat]
            const integrations = grouped[cat]
            if (integrations.length === 0) return null
            const configuredInCat = integrations.filter((i) => creds[i.id]?.configured).length
            return (
              <section key={cat} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{meta.emoji}</span>
                  <h3 className="text-sm font-semibold">{meta.label}</h3>
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                    {configuredInCat}/{integrations.length}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground truncate">· {meta.description}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {integrations.map((integration) => (
                    <CredentialCard
                      key={integration.id}
                      integration={integration}
                      state={creds[integration.id]}
                      expanded={expandedId === integration.id}
                      draft={drafts[integration.id] || {}}
                      visible={visible}
                      busy={busy[integration.id]}
                      onToggleExpand={() => toggleExpand(integration.id)}
                      onUpdateDraft={(fieldKey, value) => updateDraft(integration.id, fieldKey, value)}
                      onToggleVisible={(fieldKey) => toggleVisible(integration.id, fieldKey)}
                      onSave={() => void handleSave(integration)}
                      onDelete={() => void handleDelete(integration)}
                    />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CredentialCard — single integration card.
// ───────────────────────────────────────────────────────────────────────────

type CredentialCardProps = {
  integration: IntegrationConfig
  state: CredentialState | undefined
  expanded: boolean
  draft: Record<string, string>
  visible: Record<string, boolean>
  busy: 'save' | 'delete' | undefined
  onToggleExpand: () => void
  onUpdateDraft: (fieldKey: string, value: string) => void
  onToggleVisible: (fieldKey: string) => void
  onSave: () => void
  onDelete: () => void
}

function CredentialCard({
  integration,
  state,
  expanded,
  draft,
  visible,
  busy,
  onToggleExpand,
  onUpdateDraft,
  onToggleVisible,
  onSave,
  onDelete,
}: CredentialCardProps) {
  const configured = state?.configured ?? false
  const serverFields = state?.fields ?? {}
  const requiredKeys = integration.fields.filter((f) => f.required).map((f) => f.key)
  const missingRequired = requiredKeys.filter((k) => !serverFields[k])

  return (
    <Collapsible
      open={expanded}
      onOpenChange={() => onToggleExpand()}
      className={cn(
        'rounded-xl border transition-all',
        configured ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card',
      )}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full text-left p-3 flex items-start gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          aria-expanded={expanded}
          aria-controls={`cred-content-${integration.id}`}
        >
          <span className="text-xl leading-none mt-0.5">{integration.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm truncate">{integration.name}</span>
              {configured ? (
                <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shrink-0">
                  <CheckCircle2 className="size-2.5" /> Configurado
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 shrink-0">
                  <AlertCircle className="size-2.5" /> Pendiente
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{integration.description}</div>
          </div>
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent id={`cred-content-${integration.id}`} className="px-3 pb-3 pt-0 space-y-3">
        <Separator />

        {/* Status hint */}
        {configured ? (
          <div className="flex items-start gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
            <span>Integración configurada. Los campos se muestran enmascarados por seguridad.</span>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span>
              {missingRequired.length > 0
                ? `Faltan ${missingRequired.length} campo(s) requerido(s): ${missingRequired.join(', ')}`
                : 'Ingresa las credenciales para activar esta integración.'}
            </span>
          </div>
        )}

        {/* Fields */}
        <div className="space-y-2.5">
          {integration.fields.map((field) => {
            const isPassword = field.type === 'password'
            const isVisible = visible[`${integration.id}.${field.key}`] ?? false
            const draftValue = draft[field.key] ?? ''
            const serverValue = serverFields[field.key] ?? ''
            // Show placeholder mask in the input if no draft has been entered.
            const displayValue = draftValue || (serverValue ? serverValue : '')
            const inputId = `cred-${integration.id}-${field.key}`
            return (
              <div key={field.key} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={inputId} className="text-xs font-medium">
                    {field.label}
                    {field.required && <span className="text-rose-500 ml-0.5">*</span>}
                  </Label>
                  {field.helpText && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[10px] text-muted-foreground cursor-help">ⓘ</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-56">{field.helpText}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id={inputId}
                    type={isPassword && !isVisible ? 'password' : 'text'}
                    value={displayValue}
                    onChange={(e) => onUpdateDraft(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                      'h-9 text-xs',
                      isPassword && 'pr-9',
                    )}
                    aria-label={`${field.label} para ${integration.name}`}
                  />
                  {isPassword && (
                    <button
                      type="button"
                      onClick={() => onToggleVisible(field.key)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      aria-label={isVisible ? 'Ocultar valor' : 'Mostrar valor'}
                      tabIndex={-1}
                    >
                      {isVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  )}
                </div>
                {field.helpText && (
                  <p className="text-[10px] text-muted-foreground">{field.helpText}</p>
                )}
              </div>
            )
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={onSave} disabled={busy === 'save'} className="gap-1.5 flex-1">
            {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Guardar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDelete}
            disabled={busy === 'delete' || (!configured && !state)}
            className="gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
            aria-label={`Eliminar credenciales de ${integration.name}`}
          >
            {busy === 'delete' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Eliminar
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
