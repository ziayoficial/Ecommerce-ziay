'use client'
import { useEffect, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, MessagesSquare,
  Target, Wallet, Percent, Sparkles,
} from 'lucide-react'
import { formatCurrency, formatNumber, formatPercent, formatMultiplier, shortDate } from '@/lib/format'
import { useTenantId } from '@/hooks/use-tenant'

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

function Kpi({ icon: Icon, label, value, sub, trend, accent }: {
  icon: typeof DollarSign; label: string; value: string; sub?: string
  trend?: 'up' | 'down' | 'neutral'; accent?: 'primary' | 'amber' | 'rose' | 'violet'
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
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
            <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <div className={`size-9 rounded-xl flex items-center justify-center ring-1 ${accentMap[accent || 'primary']}`}>
            <Icon className="size-4.5" />
          </div>
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-3 text-xs">
            {trend === 'up' && <TrendingUp className="size-3.5 text-emerald-500" />}
            {trend === 'down' && <TrendingDown className="size-3.5 text-rose-500" />}
            <span className={trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-rose-600' : 'text-muted-foreground'}>
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

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    fetch(`/api/overview?days=14&tenantId=${tenantId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tenantId])

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    )
  }

  const k = data.kpis
  const channelChartData = data.channelSplit.map(c => ({ name: c.name, value: c.revenue, type: c.type, orders: c.orders }))

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={DollarSign} label="Ingresos (14d)" value={formatCurrency(k.revenue, 'COP', { compact: true })}
          sub={`${formatCurrency(k.revenuePaid, 'COP', { compact: true })} cobrados · AOV ${formatCurrency(k.aov)}`} accent="primary" trend="up" />
        <Kpi icon={Target} label="ROAS" value={formatMultiplier(k.roas)}
          sub={`CPA ${formatCurrency(k.cpa)} · ROI ${formatMultiplier(k.roi)}`} accent="amber" trend={k.roas >= 1.5 ? 'up' : 'down'} />
        <Kpi icon={ShoppingCart} label="Pedidos" value={formatNumber(k.orders)}
          sub={`${k.advanceOrders} anticipado · ${k.codOrders} contra entrega`} accent="violet" trend="up" />
        <Kpi icon={Wallet} label="Inversión en pauta" value={formatCurrency(k.totalSpend, 'COP', { compact: true })}
          sub={`Utilidad neta ${formatCurrency(k.netProfit, 'COP', { compact: true })}`} accent="rose" trend={k.netProfit > 0 ? 'up' : 'down'} />
      </div>

      {/* Revenue vs Spend chart */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Ingresos vs. Inversión en pauta</CardTitle>
            <CardDescription>Últimos 14 días · COP</CardDescription>
          </div>
          <div className="flex items-center gap-4 text-xs">
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
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tickFormatter={(v) => formatCurrency(v, 'COP', { compact: true })} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
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
