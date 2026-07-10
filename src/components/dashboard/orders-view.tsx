'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { formatCurrency, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTenantId } from '@/hooks/use-tenant'
import {
  CreditCard, Truck, CheckCircle2, Clock, XCircle, Search,
  TrendingUp, Wallet, Percent, Package,
} from 'lucide-react'

type Order = {
  id: string; number: string; status: string; paymentMode: string; paymentStatus: string
  subtotal: number; discount: number; codFee: number; total: number; currency: string
  country?: string; city?: string; createdAt: string; paidAt: string | null
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

export function OrdersView() {
  const tenantId = useTenantId()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [modeFilter, setModeFilter] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    fetch(`/api/orders?status=${statusFilter}&mode=${modeFilter}&q=${encodeURIComponent(q)}&tenantId=${tenantId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setOrders(d.orders || []); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [statusFilter, modeFilter, q, tenantId])

  const advanceOrders = orders.filter(o => o.paymentMode === 'advance')
  const codOrders = orders.filter(o => o.paymentMode === 'cod')
  const totalRevenue = orders.reduce((s, o) => s + o.total, 0)
  const paidRevenue = orders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0)
  const codPending = orders.filter(o => o.paymentMode === 'cod' && o.paymentStatus === 'cod_pending').length
  const prepDiscount = orders.reduce((s, o) => s + o.discount, 0)

  const updateStatus = async (id: string, status: string, paymentStatus?: string, event?: string) => {
    await fetch(`/api/orders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, paymentStatus, event }),
    })
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, ...(paymentStatus ? { paymentStatus } : {}) } : o))
    toast.success(`Pedido actualizado a "${status}"`)
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

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="text-base">Pedidos</CardTitle>
              <CardDescription>{orders.length} pedidos · {advanceOrders.length} anticipado · {codOrders.length} contra entrega</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar # pedido..." className="pl-8 h-9 w-44" />
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
                <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : orders.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Sin pedidos con estos filtros</div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Pedido</TableHead>
                    <TableHead className="min-w-[180px]">Cliente</TableHead>
                    <TableHead className="min-w-[240px]">Items</TableHead>
                    <TableHead className="w-28">Pago</TableHead>
                    <TableHead className="w-32">Total</TableHead>
                    <TableHead className="w-32">Estado</TableHead>
                    <TableHead className="w-32">Atribución</TableHead>
                    <TableHead className="w-40 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => {
                    const sm = statusMeta(o.status)
                    const pm = platformMeta(o.sourcePlatform)
                    const StatusIcon = sm.icon
                    return (
                      <TableRow key={o.id} className="hover:bg-muted/40">
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
                          <span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full', sm.cls)}>
                            <StatusIcon className="size-3" /> {sm.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded inline-block w-fit', pm.cls)}>{pm.label}</span>
                            {o.sourceAd && <span className="text-[10px] text-muted-foreground truncate max-w-28" title={o.sourceAd.externalId}>{o.sourceAd.name}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Select onValueChange={(v) => {
                            const eventMap: Record<string, string> = { paid: 'paid', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled' }
                            const payMap: Record<string, string> = { paid: 'paid' }
                            updateStatus(o.id, v, payMap[v], eventMap[v])
                          }} defaultValue="">
                            <SelectTrigger className="h-8 w-32 text-xs ml-auto"><SelectValue placeholder="Mover a..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="paid">Marcar pagado</SelectItem>
                              <SelectItem value="preparing">Preparando</SelectItem>
                              <SelectItem value="shipped">Enviar</SelectItem>
                              <SelectItem value="delivered">Entregado</SelectItem>
                              <SelectItem value="cancelled">Cancelar</SelectItem>
                            </SelectContent>
                          </Select>
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
