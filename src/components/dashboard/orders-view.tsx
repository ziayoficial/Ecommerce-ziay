'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatCurrency, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTenantId } from '@/hooks/use-tenant'
import { isWithinRetractoWindow } from '@/lib/compliance/retracto'
import {
  CreditCard, Truck, CheckCircle2, Clock, XCircle, Search,
  TrendingUp, Wallet, Percent, Package, Download, ChevronDown,
  ChevronRight, RefreshCw, AlertCircle, Inbox, SlidersHorizontal,
  RotateCcw,
} from 'lucide-react'

type Order = {
  id: string; number: string; status: string; paymentMode: string; paymentStatus: string
  subtotal: number; discount: number; codFee: number; total: number; currency: string
  country?: string; city?: string; createdAt: string; paidAt: string | null
  // SPRINT-COMPLIANCE-FINAL-001 · P3 — Ley 1480 Art 47 retracto deadline
  // stamped at order creation. Null for legacy orders. The dashboard renders
  // a "Retracto" button only while this is in the future.
  retractoWindowUntil?: string | null
  sourceAd: { id: string; name: string; externalId: string } | null
  sourceCampaign?: string; sourcePlatform?: string
  customer: { id: string; name: string; phone?: string; country?: string }
  items: { name: string; quantity: number; unitPrice: number }[]
}

const statusMeta = (s: string) => {
  switch (s) {
    case 'new': return { label: 'Nuevo', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300', icon: Clock }
    case 'pending_payment': return { label: 'Pago pendiente', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', icon: Clock }
    case 'paid': return { label: 'Pagado', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', icon: CheckCircle2 }
    case 'preparing': return { label: 'Preparando', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', icon: Package }
    case 'shipped': return { label: 'Enviado', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', icon: Truck }
    case 'delivered': return { label: 'Entregado', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', icon: CheckCircle2 }
    case 'returned': return { label: 'Devuelto', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', icon: XCircle }
    case 'cancelled': return { label: 'Cancelado', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300', icon: XCircle }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300', icon: Clock }
  }
}

const platformMeta = (p?: string) => {
  switch (p) {
    case 'meta': return { label: 'Meta', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' }
    case 'google': return { label: 'Google', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    case 'tiktok': return { label: 'TikTok', cls: 'bg-slate-900/10 text-slate-700 dark:text-slate-300' }
    case 'organic': return { label: 'Orgánico', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }
    default: return { label: p || '—', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

// All possible statuses — used to render quick-filter chips with counts.
const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'new', label: 'Nuevo' },
  { value: 'pending_payment', label: 'Pago pendiente' },
  { value: 'paid', label: 'Pagado' },
  { value: 'preparing', label: 'Preparando' },
  { value: 'shipped', label: 'Enviado' },
  { value: 'delivered', label: 'Entregado' },
  { value: 'returned', label: 'Devuelto' },
  { value: 'cancelled', label: 'Cancelado' },
] as const

export function OrdersView() {
  const tenantId = useTenantId()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [modeFilter, setModeFilter] = useState('all')
  const [q, setQ] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const loadOrders = useCallback(async (showRefreshing = false) => {
    if (!tenantId) return
    if (showRefreshing) setRefreshing(true)
    try {
      setError(null)
      const res = await fetch(`/api/orders?status=${statusFilter}&mode=${modeFilter}&q=${encodeURIComponent(q)}&tenantId=${tenantId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setOrders(d.orders || [])
    } catch (err) {
      console.error('Orders fetch failed', err)
      setError('No pudimos cargar los pedidos. Intenta de nuevo.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [statusFilter, modeFilter, q, tenantId])

  useEffect(() => { loadOrders() }, [loadOrders])

  // ── Status counts for the quick-filter chips ──
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: orders.length }
    for (const o of orders) counts[o.status] = (counts[o.status] || 0) + 1
    return counts
  }, [orders])

  const advanceOrders = orders.filter(o => o.paymentMode === 'advance')
  const codOrders = orders.filter(o => o.paymentMode === 'cod')
  const totalRevenue = orders.reduce((s, o) => s + o.total, 0)
  const paidRevenue = orders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0)
  const codPending = orders.filter(o => o.paymentMode === 'cod' && o.paymentStatus === 'cod_pending').length
  const prepDiscount = orders.reduce((s, o) => s + o.discount, 0)

  // ── Bulk selection helpers ──
  const selectedIds = useMemo(() => Object.keys(selected).filter(id => selected[id]), [selected])
  const selectedCount = selectedIds.length
  const allSelected = orders.length > 0 && selectedCount === orders.length
  const someSelected = selectedCount > 0 && !allSelected
  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(Object.fromEntries(orders.map(o => [o.id, true])))
    } else {
      setSelected({})
    }
  }
  function toggleOne(id: string, checked: boolean) {
    setSelected(prev => ({ ...prev, [id]: checked }))
  }

  // ── CSV export: client-side, no backend round-trip needed ──
  function exportCsv() {
    const target = selectedCount > 0 ? orders.filter(o => selected[o.id]) : orders
    if (target.length === 0) {
      toast.info('No hay pedidos para exportar')
      return
    }
    const headers = ['Número', 'Estado', 'Modo de pago', 'Pago status', 'Cliente', 'Ciudad', 'País', 'Items', 'Total', 'Descuento', 'Recargo COD', 'Campaña', 'Plataforma', 'Creado']
    const rows = target.map(o => [
      o.number, o.status, o.paymentMode, o.paymentStatus,
      o.customer.name, o.city || '', o.country || '',
      o.items.map(i => `${i.quantity}x ${i.name}`).join(' | '),
      o.total, o.discount, o.codFee,
      o.sourceCampaign || '', o.sourcePlatform || '',
      o.createdAt,
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(cell => {
        const s = String(cell ?? '')
        // RFC 4180: wrap in quotes if contains comma/quote/newline, double the quotes.
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }).join(','))
      .join('\n')
    // Prepend BOM so Excel reads UTF-8 correctly (accents, emojis).
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pedidos-${new Date().toISOString().slice(0, 10)}${selectedCount > 0 ? `-_${selectedCount}` : ''}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`${target.length} pedidos exportados a CSV`)
  }

  async function bulkUpdateStatus(status: string) {
    if (selectedCount === 0) return
    await Promise.allSettled(selectedIds.map(id =>
      fetch(`/api/orders/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    ))
    setOrders(prev => prev.map(o => selected[o.id] ? { ...o, status } : o))
    toast.success(`${selectedCount} pedidos actualizados a "${status}"`)
    setSelected({})
  }

  const updateStatus = async (id: string, status: string, paymentStatus?: string, event?: string) => {
    await fetch(`/api/orders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, paymentStatus, event }),
    })
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, ...(paymentStatus ? { paymentStatus } : {}) } : o))
    toast.success(`Pedido actualizado a "${status}"`)
  }

  // ── SPRINT-COMPLIANCE-FINAL-001 · P3 — retracto handler (Ley 1480 Art 47) ──
  // Cancels the order + persists the 30-day refund deadline via the
  // `/api/compliance/retracto` endpoint. The button is only rendered while
  // `order.retractoWindowUntil` is in the future (see the row actions cell),
  // but we re-check `isWithinRetractoWindow(order.createdAt)` here as
  // defense-in-depth against clock skew / race between render and click.
  const handleRetracto = useCallback(async (order: Order) => {
    if (!tenantId) return
    if (!isWithinRetractoWindow(new Date(order.createdAt))) {
      toast.error('El plazo de 5 días para retracto (Ley 1480 Art 47) ya venció.')
      return
    }
    if (!confirm(`¿Solicitar retracto para la orden ${order.number}? Esto cancelará la orden y procesará el reembolso.`)) {
      return
    }
    try {
      const res = await fetch('/api/compliance/retracto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          tenantId,
          reason: 'Solicitado desde dashboard',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(data.message || 'Retracto procesado')
        loadOrders(true)
      } else {
        toast.error(data.error || data.message || 'Error al procesar retracto')
      }
    } catch {
      toast.error('Error de conexión')
    }
  }, [tenantId, loadOrders])

  if (error) {
    return (
      <Alert variant="destructive" className="animate-fade-in-up" role="alert">
        <AlertCircle className="size-4" />
        <AlertTitle>Error al cargar los pedidos</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => loadOrders(true)} className="gap-1.5">
            <RefreshCw className="size-3.5" /> Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 flex items-center justify-center"><Wallet className="size-5" /></div>
          <div><div className="text-lg font-bold">{formatCurrency(totalRevenue, 'COP', { compact: true })}</div><div className="text-xs text-muted-foreground">Ingresos totales</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 flex items-center justify-center"><CheckCircle2 className="size-5" /></div>
          <div><div className="text-lg font-bold">{formatCurrency(paidRevenue, 'COP', { compact: true })}</div><div className="text-xs text-muted-foreground">Cobrado efectivamente</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 flex items-center justify-center"><Truck className="size-5" /></div>
          <div><div className="text-lg font-bold">{codPending}</div><div className="text-xs text-muted-foreground">COD pendientes de cobro</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20 flex items-center justify-center"><Percent className="size-5" /></div>
          <div><div className="text-lg font-bold">{formatCurrency(prepDiscount, 'COP', { compact: true })}</div><div className="text-xs text-muted-foreground">Descuentos por prepago</div></div>
        </CardContent></Card>
      </div>

      {/* ── Status quick-filter chips with counts ── */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
        {STATUS_OPTIONS.map(opt => {
          const count = statusCounts[opt.value] || 0
          const isActive = statusFilter === opt.value
          if (opt.value !== 'all' && count === 0 && !isActive) return null
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              aria-pressed={isActive}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-accent border-border'
              )}
            >
              {opt.label}
              {count > 0 && (
                <span className={cn(
                  'inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] tabular-nums',
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Filters (collapsible) */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-3 cursor-pointer select-none hover:bg-muted/30 transition-colors">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <SlidersHorizontal className="size-4 text-primary" />
                    Pedidos
                    <Badge variant="outline" className="text-[10px] h-5 tabular-nums">{orders.length}</Badge>
                    {selectedCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-5">{selectedCount} seleccionados</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>{advanceOrders.length} anticipado · {codOrders.length} contra entrega</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); exportCsv() }} className="gap-1.5" aria-label="Exportar a CSV">
                    <Download className="size-3.5" /> <span className="hidden sm:inline">Exportar CSV</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); loadOrders(true) }} disabled={refreshing} className="gap-1.5" aria-label="Refrescar pedidos">
                    <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1" aria-label={filtersOpen ? 'Contraer filtros' : 'Expandir filtros'}>
                    {filtersOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <span className="hidden sm:inline">{filtersOpen ? 'Contraer' : 'Expandir'}</span>
                  </Button>
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-6">
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar # pedido, cliente, ciudad..." className="pl-8 h-9" aria-label="Buscar pedidos" />
                </div>
                <Select value={modeFilter} onValueChange={setModeFilter}>
                  <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Modo de pago" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los pagos</SelectItem>
                    <SelectItem value="advance">Anticipado</SelectItem>
                    <SelectItem value="cod">Contra entrega</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los estados</SelectItem>
                    <SelectItem value="new">Nuevo</SelectItem>
                    <SelectItem value="paid">Pagado</SelectItem>
                    <SelectItem value="preparing">Preparando</SelectItem>
                    <SelectItem value="shipped">Enviado</SelectItem>
                    <SelectItem value="delivered">Entregado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Bulk actions bar — visible only when at least one order is selected.
          On mobile it floats at the bottom (fixed); on md+ it sits inline above the table. */}
      {selectedCount > 0 && (
        <div
          role="region"
          aria-label="Acciones masivas"
          className="fixed md:static bottom-4 left-4 right-4 z-30 md:z-auto
                     flex items-center justify-between gap-3 p-3 rounded-lg border
                     bg-background md:bg-primary/5 shadow-lg md:shadow-none
                     animate-fade-in-up flex-wrap"
        >
          <div className="text-xs font-medium">{selectedCount} pedidos seleccionados</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select onValueChange={(v) => bulkUpdateStatus(v)} defaultValue="">
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Mover selección a…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Marcar pagado</SelectItem>
                <SelectItem value="preparing">Preparando</SelectItem>
                <SelectItem value="shipped">Enviar</SelectItem>
                <SelectItem value="delivered">Entregado</SelectItem>
                <SelectItem value="cancelled">Cancelar</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5"><Download className="size-3.5" /> Exportar selección</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected({})} aria-label="Limpiar selección">Limpiar</Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-14 px-4 gap-3">
              <div className="size-14 rounded-2xl bg-muted/60 ring-1 ring-border flex items-center justify-center">
                <Inbox className="size-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Sin pedidos con estos filtros</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">Prueba cambiando los filtros de estado o modo de pago, o espera a que entren nuevos pedidos desde Mensajería.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setStatusFilter('all'); setModeFilter('all'); setQ('') }} className="gap-1.5">Limpiar filtros</Button>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 sticky left-0 bg-background z-10">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={(v) => toggleAll(!!v)}
                        aria-label="Seleccionar todos los pedidos"
                      />
                    </TableHead>
                    <TableHead className="w-32">Pedido</TableHead>
                    <TableHead className="min-w-[180px]">Cliente</TableHead>
                    <TableHead className="min-w-[240px]">Items</TableHead>
                    <TableHead className="w-28">Pago</TableHead>
                    <TableHead className="w-32">Total</TableHead>
                    <TableHead className="w-32">Estado</TableHead>
                    <TableHead className="min-w-[160px]">Atribución</TableHead>
                    <TableHead className="w-40 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => {
                    const sm = statusMeta(o.status)
                    const pm = platformMeta(o.sourcePlatform)
                    const StatusIcon = sm.icon
                    const isSel = !!selected[o.id]
                    return (
                      <TableRow key={o.id} className={cn('hover:bg-muted/40', isSel && 'bg-primary/5')} data-selected={isSel || undefined}>
                        <TableCell className="sticky left-0 bg-background z-10">
                          <Checkbox
                            checked={isSel}
                            onCheckedChange={(v) => toggleOne(o.id, !!v)}
                            aria-label={`Seleccionar pedido ${o.number}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-mono font-medium text-sm">{o.number}</div>
                          <div className="text-[10px] text-muted-foreground">{shortDate(o.createdAt)}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm line-clamp-2 leading-tight" title={o.customer.name}>{o.customer.name}</div>
                          <div className="text-[11px] text-muted-foreground line-clamp-1" title={`${o.city || '—'}, ${o.country || '—'}`}>{o.city || '—'}{o.country ? `, ${o.country}` : ''}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-muted-foreground line-clamp-2 leading-snug" title={o.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}>
                            {o.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={o.paymentMode === 'advance' ? 'default' : 'secondary'} className="text-[10px] gap-1">
                            {o.paymentMode === 'advance' ? <><CreditCard className="size-3" /> Anticipado</> : <><Truck className="size-3" /> COD</>}
                          </Badge>
                          {o.paymentStatus === 'cod_pending' && <div className="text-[10px] text-amber-600 mt-0.5">Pendiente cobro</div>}
                          {o.paymentStatus === 'paid' && <div className="text-[10px] text-emerald-600 mt-0.5">Cobrado</div>}
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold tabular-nums text-sm">{formatCurrency(o.total, o.currency)}</div>
                          {o.discount > 0 && <div className="text-[10px] text-emerald-600">-{formatCurrency(o.discount, 'COP', { compact: true })} prepago</div>}
                          {o.codFee > 0 && <div className="text-[10px] text-muted-foreground">+{formatCurrency(o.codFee)} envío COD</div>}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider delayDuration={200}>
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full cursor-help')}>
                                  <StatusIcon className="size-3" /> {sm.label}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent><p className="text-xs">Estado actual: {o.status}</p></TooltipContent>
                            </UITooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          <div className="flex flex-col gap-1">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded inline-block w-fit whitespace-nowrap', pm.cls)}>{pm.label}</span>
                            {o.sourceAd && <span className="text-[10px] text-muted-foreground truncate max-w-[180px]" title={o.sourceAd.externalId}>{o.sourceAd.name}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* SPRINT-COMPLIANCE-FINAL-001 · P3 — Retracto button.
                                Visible only while the 5-day window (Ley 1480 Art 47)
                                is open AND the order isn't already cancelled. */}
                            {o.retractoWindowUntil &&
                              new Date(o.retractoWindowUntil) > new Date() &&
                              o.status !== 'cancelled' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10 h-8 px-2 text-xs gap-1"
                                  onClick={() => handleRetracto(o)}
                                  aria-label={`Solicitar retracto para pedido ${o.number}`}
                                >
                                  <RotateCcw className="size-3" />
                                  Retracto
                                </Button>
                              )}
                            <Select onValueChange={(v) => {
                              const eventMap: Record<string, string> = { paid: 'paid', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled' }
                              const payMap: Record<string, string> = { paid: 'paid' }
                              updateStatus(o.id, v, payMap[v], eventMap[v])
                            }} defaultValue="">
                              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Mover a..." /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="paid">Marcar pagado</SelectItem>
                                <SelectItem value="preparing">Preparando</SelectItem>
                                <SelectItem value="shipped">Enviar</SelectItem>
                                <SelectItem value="delivered">Entregado</SelectItem>
                                <SelectItem value="cancelled">Cancelar</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
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

      {/* Payment strategy explainer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="size-4 text-primary" /> Estrategia de pagos recomendada</CardTitle>
          <CardDescription>Cómo se decide anticipado vs. contra entrega por canal y país</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border bg-primary/5 space-y-2">
              <div className="flex items-center gap-2"><CreditCard className="size-4 text-primary" /><Badge variant="default">Anticipado</Badge></div>
              <p className="text-xs text-muted-foreground">Recomendado para internacional (Messenger/IG) y pedidos &gt; $250k en CO. Mejora flujo de caja, reduce devoluciones, descuenta 5-7% al cliente.</p>
              <div className="text-xs"><strong>Cobro:</strong> carrito ecommerce (Mercado Pago, Wompi, Stripe, PayU)</div>
            </div>
            <div className="p-4 rounded-xl border bg-amber-500/5 space-y-2">
              <div className="flex items-center gap-2"><Truck className="size-4 text-amber-600" /><Badge variant="secondary">Contra entrega</Badge></div>
              <p className="text-xs text-muted-foreground">Fuerte en Colombia y México para primera compra &lt; $250k. Reduce fricción, ideal para clientes nuevos desconfiados. Recargo de envío $8k CO / $60 MXN.</p>
              <div className="text-xs"><strong>Riesgo:</strong> ~12-18% rechazo en puerta (mitigar con confirmación + reglas)</div>
            </div>
            <div className="p-4 rounded-xl border bg-violet-500/5 space-y-2">
              <div className="flex items-center gap-2"><Percent className="size-4 text-violet-600" /><Badge variant="outline">Híbrido (configurable)</Badge></div>
              <p className="text-xs text-muted-foreground">Por canal o por país: muestra ambas opciones y deja al cliente elegir. El sistema sugiere prepago con descuento para tickets altos y COD para bajos.</p>
              <div className="text-xs"><strong>Reglas:</strong> configurables en <strong>Configuración → Estrategia de pago</strong></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
