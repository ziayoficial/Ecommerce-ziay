'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, MessagesSquare,
  Target, Wallet, Percent, Sparkles, RefreshCw, AlertCircle, Info,
  Inbox,
} from 'lucide-react'
import { formatCurrency, formatNumber, formatPercent, formatMultiplier, shortDate, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/hooks/use-tenant'

// Human-readable tooltip text for each KPI — explains what the metric means.
const KPI_HELP = {
  revenue: 'Ingresos brutos de los pedidos en los últimos 14 días (independientemente de si ya están cobrados).',
  roas: 'Return on Ad Spend: ingresos por cada $1 invertido en pauta. ROAS ≥ 1.5 es sano.',
  orders: 'Número total de pedidos en los últimos 14 días, dividido por modo de pago.',
  spend: 'Total invertido en pauta (Meta/Google/TikTok) y utilidad neta después de COGS y pauta.',
} as const

type Overview = {
  range: { days: number }
  kpis: {
    revenue: number; revenuePaid: number; orders: number; conversations: number
    totalSpend: number; grossProfit: number; netProfit: number
    roi: number; roas: number; cpa: number; ctr: number; aov: number
    advanceOrders: number; codOrders: number; advanceRate: number
  }
  channelSplit: { id: string; name: string; type: string; orders: number; revenue: number; strategy: string }[]
  series: { date: string; revenue: number; spend: number; orders: number }[]
}

function Kpi({ icon: Icon, label, value, sub, trend, accent, help }: {
  icon: typeof DollarSign; label: string; value: string; sub?: string
  trend?: 'up' | 'down' | 'neutral'; accent?: 'primary' | 'amber' | 'rose' | 'violet'
  help?: string
}) {
  const accentMap = {
    primary: 'bg-primary/10 text-primary ring-primary/20',
    amber: 'bg-amber-500/10 text-amber-600 ring-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-600 ring-rose-500/20',
    violet: 'bg-violet-500/10 text-violet-600 ring-violet-500/20',
  } as const
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
              {label}
              {help && (
                <TooltipProvider delayDuration={200}>
                  <UITooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label={`¿Qué es ${label}?`} className="text-muted-foreground/70 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                        <Info className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-56"><p className="text-xs">{help}</p></TooltipContent>
                  </UITooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <div className={`size-9 rounded-xl flex items-center justify-center ring-1 ${accentMap[accent || 'primary']}`} aria-hidden>
            <Icon className="size-4.5" />
          </div>
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-3 text-xs">
            {trend === 'up' && <TrendingUp className="size-3.5 text-emerald-600" />}
            {trend === 'down' && <TrendingDown className="size-3.5 text-rose-600" />}
            <span className={trend === 'up' ? 'text-emerald-700 dark:text-emerald-400 font-medium' : trend === 'down' ? 'text-rose-700 dark:text-rose-400 font-medium' : 'text-muted-foreground'}>
              {trend === 'up' ? 'Tendencia positiva' : trend === 'down' ? 'Revisar' : 'Estable'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const channelColor = (type: string) => {
  switch (type) {
    case 'whatsapp': return '#22c55e'
    case 'messenger': return '#0ea5e9'
    case 'instagram': return '#d946ef'
    default: return '#64748b'
  }
}

export function OverviewView() {
  const tenantId = useTenantId()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!tenantId) return
    if (showRefreshing) setRefreshing(true)
    setError(null)
    try {
      const res = await fetch(`/api/overview?days=14&tenantId=${tenantId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setData(d)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Overview fetch failed', err)
      setError('No pudimos cargar los KPIs. Verifica tu conexión o intenta de nuevo.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    fetch(`/api/overview?days=14&tenantId=${tenantId}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (!cancelled) { setData(d); setLastUpdated(new Date()); setLoading(false) } })
      .catch((err) => {
        console.error('Overview fetch failed', err)
        if (!cancelled) { setError('No pudimos cargar los KPIs. Verifica tu conexión o intenta de nuevo.'); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [tenantId])

  // ── Empty state: tenant has data but zero orders in the window ──
  const isEmpty = data && (data.kpis.orders === 0 && data.kpis.conversations === 0)

  if (error) {
    return (
      <Alert variant="destructive" className="animate-fade-in-up">
        <AlertCircle className="size-4" />
        <AlertTitle>Error al cargar el resumen</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => fetchData(true)} className="gap-1.5">
            <RefreshCw className="size-3.5" /> Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 rounded-xl lg:col-span-2" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    )
  }

  // ── Friendly empty state with CTA ──
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-4 animate-fade-in-up">
        <div className="size-20 rounded-2xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center mb-5">
          <Inbox className="size-9 text-primary" />
        </div>
        <h2 className="text-lg font-semibold">Aún no hay actividad en los últimos 14 días</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-2">
          Una vez que entran conversaciones y se registran pedidos, verás aquí los KPIs de ingresos,
          ROAS, CPA y el split por canal. Conecta un canal en Mensajería para empezar.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          <a href="/messenger" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <MessagesSquare className="size-4" /> Ir a Mensajería
          </a>
          <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} /> Refrescar
          </Button>
        </div>
      </div>
    )
  }

  const k = data.kpis
  const channelChartData = data.channelSplit.map(c => ({ name: c.name, value: c.revenue, type: c.type, orders: c.orders }))

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* ── Header: last-updated + refresh ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {lastUpdated ? (
            <span>Actualizado hace <strong className="text-foreground tabular-nums">{timeAgo(lastUpdated.toISOString())}</strong></span>
          ) : (
            <span>Datos de muestra</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing} className="gap-1.5">
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          {refreshing ? 'Actualizando…' : 'Refrescar'}
        </Button>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={DollarSign} label="Ingresos (14d)" value={formatCurrency(k.revenue, 'COP', { compact: true })}
          sub={`${formatCurrency(k.revenuePaid, 'COP', { compact: true })} cobrados · AOV ${formatCurrency(k.aov)}`} accent="primary" trend="up" help={KPI_HELP.revenue} />
        <Kpi icon={Target} label="ROAS" value={formatMultiplier(k.roas)}
          sub={`CPA ${formatCurrency(k.cpa)} · ROI ${formatMultiplier(k.roi)}`} accent="amber" trend={k.roas >= 1.5 ? 'up' : 'down'} help={KPI_HELP.roas} />
        <Kpi icon={ShoppingCart} label="Pedidos" value={formatNumber(k.orders)}
          sub={`${k.advanceOrders} anticipado · ${k.codOrders} contra entrega`} accent="violet" trend="up" help={KPI_HELP.orders} />
        <Kpi icon={Wallet} label="Inversión en pauta" value={formatCurrency(k.totalSpend, 'COP', { compact: true })}
          sub={`Utilidad neta ${formatCurrency(k.netProfit, 'COP', { compact: true })}`} accent="rose" trend={k.netProfit > 0 ? 'up' : 'down'} help={KPI_HELP.spend} />
      </div>

      {/* Revenue vs Spend chart */}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">Ingresos vs. Inversión en pauta</CardTitle>
            <CardDescription className="truncate md:whitespace-normal">Últimos 14 días · COP</CardDescription>
          </div>
          <div className="flex items-center gap-4 text-xs shrink-0">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" /> Ingresos</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-rose-400" /> Pauta</span>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.series} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="spd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                interval="preserveStartEnd"
                minTickGap={24}
                angle={-35}
                textAnchor="end"
                height={50}
              />
              <YAxis tickFormatter={(v) => formatCurrency(v, 'COP', { compact: true })} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={64} />
              <Tooltip
                contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                formatter={(v: number, n) => [formatCurrency(v), n === 'revenue' ? 'Ingresos' : 'Pauta']}
                labelFormatter={(l) => `Día ${shortDate(l as string)}`}
              />
              <Area type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} fill="url(#rev)" />
              <Area type="monotone" dataKey="spend" stroke="#f43f5e" strokeWidth={2} fill="url(#spd)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Two columns: channel split + payment mode */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Ingresos por canal</CardTitle>
            <CardDescription>WhatsApp domina en CO · Messenger/IG en internacional</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {channelChartData.map((c) => {
                const max = Math.max(...channelChartData.map(x => x.value), 1)
                return (
                  <div key={c.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="size-2.5 rounded-sm" style={{ background: channelColor(c.type) }} />
                        {c.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{formatCurrency(c.value, 'COP', { compact: true })} · {c.orders} pedidos</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(c.value / max) * 100}%`, background: channelColor(c.type) }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modo de pago</CardTitle>
            <CardDescription>Penetración de anticipado vs. contra entrega</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={[
                  { name: 'Anticipado', value: k.advanceOrders, fill: 'var(--primary)' },
                  { name: 'Contra entrega', value: k.codOrders, fill: '#f59e0b' },
                ]} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75} paddingAngle={3}>
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-4 text-sm -mt-2">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" /> Anticipado {formatPercent(k.advanceRate, 0)}</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-amber-500" /> COD {formatPercent(100 - k.advanceRate, 0)}</span>
            </div>
            <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/15 flex gap-2 text-xs">
              <Sparkles className="size-4 text-primary shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                <strong className="text-foreground">Recomendación:</strong> el pago anticipado mejora el flujo de caja y reduce rechazos. Para pedidos &gt; $250k en CO, ofrece 5% off por prepago vía carrito.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Conversations + summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 flex items-center justify-center">
              <MessagesSquare className="size-5" />
            </div>
            <div>
              <div className="text-2xl font-bold">{k.conversations}</div>
              <div className="text-xs text-muted-foreground">Conversaciones nuevas (14d)</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-xl bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20 flex items-center justify-center">
              <Percent className="size-5" />
            </div>
            <div>
              <div className="text-2xl font-bold">{formatPercent(k.ctr)} CTR</div>
              <div className="text-xs text-muted-foreground">Click-through de la pauta</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 flex items-center justify-center">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <div className="text-2xl font-bold">{formatCurrency(k.grossProfit, 'COP', { compact: true })}</div>
              <div className="text-xs text-muted-foreground">Utilidad bruta (post-COGS)</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
