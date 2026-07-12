'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatPercent, shortDate, timeAgo } from '@/lib/format'
import { useTenantId } from '@/hooks/use-tenant'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import {
  ShieldCheck, ShieldAlert, RotateCcw, Truck, Search, Sparkles, Send,
  AlertTriangle, Bell, RefreshCw, ChevronRight, Clock,
} from 'lucide-react'

// ───────────────────────────────────────────────────────────────────────────
// Types — mirror the API response shape
// ───────────────────────────────────────────────────────────────────────────
type CustomerScore = {
  id: string
  phone: string
  score: number
  category: string
  totalPedidos: number
  pedidosEntregados: number
  pedidosDevueltos: number
  lastOrderAt: string | null
}

type CarrierScore = {
  id: string
  carrierName: string
  score: number
  totalGuias: number
  entregadas: number
  devueltas: number
  avgDeliveryDays: number | null
}

type GuideTracking = {
  id: string
  guideNumber: string
  carrierName: string | null
  status: string
  lastEventAt: string | null
  daysStuck: number
}

type BehaviorAlert = {
  id: string
  alertType: string
  message: string
  buyerBehaviorId: string
  createdAt: string
  buyerBehavior: {
    phone: string
    riskLevel: string
    totalReturns: number
    totalOrders: number
  } | null
}

type LogisticsData = {
  customerScores: CustomerScore[]
  carrierScores: CarrierScore[]
  stuckGuides: GuideTracking[]
  alerts: BehaviorAlert[]
  stats: {
    confiables: number
    riesgo: number
    devolvedores: number
    stuckCount: number
    totalCustomers: number
    totalCarriers: number
    totalAlerts: number
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
function categoryMeta(category: string) {
  switch (category) {
    case 'confiable':
      return { label: 'Confiable', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20' }
    case 'riesgo':
      return { label: 'Riesgo', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20' }
    case 'devolvedor':
      return { label: 'Devolvedor', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20' }
    default:
      return { label: category, cls: 'bg-muted text-muted-foreground' }
  }
}

function alertSeverity(alertType: string): 'high' | 'medium' | 'low' {
  const t = alertType.toLowerCase()
  if (t.includes('blacklist') || t.includes('fraud') || t.includes('high')) return 'high'
  if (t.includes('return') || t.includes('caution') || t.includes('repeat')) return 'medium'
  return 'low'
}

function severityMeta(s: 'high' | 'medium' | 'low') {
  switch (s) {
    case 'high':
      return { dot: 'bg-rose-500', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20', label: 'Alta' }
    case 'medium':
      return { dot: 'bg-amber-500', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20', label: 'Media' }
    case 'low':
      return { dot: 'bg-emerald-500', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20', label: 'Baja' }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main view
// ───────────────────────────────────────────────────────────────────────────
export function LogisticsIntelligenceView() {
  const tenantId = useTenantId()
  const [data, setData] = useState<LogisticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchPhone, setSearchPhone] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [activeTab, setActiveTab] = useState('customers')

  const load = useCallback(async () => {
    if (!tenantId) return
    setRefreshing(true)
    try {
      const res = await fetch(`/api/logistics-intelligence?tenantId=${tenantId}`)
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()
      setData(json)
    } catch {
      toast.error('No se pudo cargar inteligencia logística')
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

  const filteredCustomers = useMemo(() => {
    if (!data) return []
    return data.customerScores.filter((c) => {
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false
      if (searchPhone && !c.phone.includes(searchPhone.trim())) return false
      return true
    })
  }, [data, categoryFilter, searchPhone])

  const carrierChartData = useMemo(() => {
    if (!data) return []
    return data.carrierScores.map((c) => ({
      name: c.carrierName.length > 14 ? c.carrierName.slice(0, 12) + '…' : c.carrierName,
      fullName: c.carrierName,
      deliveryRate: c.totalGuias > 0 ? Number(((c.entregadas / c.totalGuias) * 100).toFixed(1)) : 0,
      score: c.score,
    }))
  }, [data])

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
            <Truck className="size-5 text-emerald-600" />
            Inteligencia Logística
          </h2>
          <p className="text-sm text-muted-foreground">
            Scores de clientes y transportadoras, guías estancadas y alertas de comportamiento
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          Actualizar
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<ShieldCheck className="size-5" />}
          tone="emerald"
          value={stats.confiables}
          label="Clientes confiables"
          hint={`${stats.totalCustomers} totales`}
        />
        <KpiCard
          icon={<ShieldAlert className="size-5" />}
          tone="amber"
          value={stats.riesgo}
          label="Clientes riesgo"
          hint="Score 1–49%"
        />
        <KpiCard
          icon={<RotateCcw className="size-5" />}
          tone="rose"
          value={stats.devolvedores}
          label="Clientes devolvedores"
          hint="Score 0%"
        />
        <KpiCard
          icon={<AlertTriangle className="size-5" />}
          tone="slate"
          value={stats.stuckCount}
          label="Guías estancadas"
          hint="&gt; 3 días sin movimiento"
        />
      </div>

      {/* Tabs: Scores de Clientes / Scores de Transportadoras / Guías Stuck */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="customers">Clientes</TabsTrigger>
          <TabsTrigger value="carriers">Transportadoras</TabsTrigger>
          <TabsTrigger value="stuck">Guías Stuck</TabsTrigger>
        </TabsList>

        {/* Scores de Clientes */}
        <TabsContent value="customers" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-base">Scores de Clientes</CardTitle>
                  <CardDescription>
                    {filteredCustomers.length} de {data.customerScores.length} clientes
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      value={searchPhone}
                      onChange={(e) => setSearchPhone(e.target.value)}
                      placeholder="Buscar teléfono…"
                      className="pl-8 h-9 w-44"
                    />
                  </div>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-9 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="confiable">Confiable</SelectItem>
                      <SelectItem value="riesgo">Riesgo</SelectItem>
                      <SelectItem value="devolvedor">Devolvedor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredCustomers.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  Sin clientes que coincidan con el filtro
                </div>
              ) : (
                <ScrollArea className="max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[120px]">Teléfono</TableHead>
                        <TableHead className="w-24">Categoría</TableHead>
                        <TableHead className="text-right w-20">Score</TableHead>
                        <TableHead className="text-right w-20">Pedidos</TableHead>
                        <TableHead className="text-right w-24">Entregados</TableHead>
                        <TableHead className="text-right w-24">Devueltos</TableHead>
                        <TableHead className="w-28">Último pedido</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCustomers.map((c) => {
                        const meta = categoryMeta(c.category)
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="font-mono text-xs whitespace-nowrap">{c.phone}</TableCell>
                            <TableCell>
                              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap', meta.cls)}>
                                {meta.label}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap font-medium">
                              {c.score.toFixed(0)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap">{c.totalPedidos}</TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                              {c.pedidosEntregados}
                            </TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap text-rose-600 dark:text-rose-400">
                              {c.pedidosDevueltos}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {c.lastOrderAt ? shortDate(c.lastOrderAt) : '—'}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scores de Transportadoras */}
        <TabsContent value="carriers" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Tasa de entrega</CardTitle>
                <CardDescription>% entregadas sobre total de guías por transportadora</CardDescription>
              </CardHeader>
              <CardContent>
                {carrierChartData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                    Sin transportadoras
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(220, carrierChartData.length * 44)}>
                    <BarChart data={carrierChartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 11 }}
                        stroke="var(--muted-foreground)"
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        stroke="var(--muted-foreground)"
                        width={90}
                      />
                      <RTooltip
                        contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                        formatter={(v: number) => [`${v}%`, 'Entrega']}
                        labelFormatter={(_, p) => p?.[0]?.payload?.fullName ?? ''}
                      />
                      <Bar dataKey="deliveryRate" radius={[0, 6, 6, 0]}>
                        {carrierChartData.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={
                              entry.deliveryRate >= 80
                                ? 'oklch(0.72 0.19 152)'
                                : entry.deliveryRate >= 50
                                  ? 'oklch(0.78 0.16 80)'
                                  : 'oklch(0.66 0.2 25)'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Detalle por transportadora</CardTitle>
                <CardDescription>{data.carrierScores.length} transportadoras</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.carrierScores.length === 0 ? (
                  <div className="p-12 text-center text-sm text-muted-foreground">
                    Sin transportadoras registradas
                  </div>
                ) : (
                  <ScrollArea className="max-h-96">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[140px]">Transportadora</TableHead>
                          <TableHead className="text-right w-20">Score</TableHead>
                          <TableHead className="text-right w-20">Guías</TableHead>
                          <TableHead className="text-right w-24">Entregadas</TableHead>
                          <TableHead className="text-right w-24">Devueltas</TableHead>
                          <TableHead className="text-right w-28">Entrega %</TableHead>
                          <TableHead className="text-right w-24">Días prom.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.carrierScores.map((c) => {
                          const rate = c.totalGuias > 0 ? (c.entregadas / c.totalGuias) * 100 : 0
                          return (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium whitespace-nowrap truncate max-w-[180px]">
                                {c.carrierName}
                              </TableCell>
                              <TableCell className="text-right tabular-nums whitespace-nowrap font-medium">
                                {c.score.toFixed(0)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums whitespace-nowrap">{c.totalGuias}</TableCell>
                              <TableCell className="text-right tabular-nums whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                                {c.entregadas}
                              </TableCell>
                              <TableCell className="text-right tabular-nums whitespace-nowrap text-rose-600 dark:text-rose-400">
                                {c.devueltas}
                              </TableCell>
                              <TableCell className="text-right tabular-nums whitespace-nowrap">
                                <span className={cn(
                                  'text-xs font-semibold px-1.5 py-0.5 rounded',
                                  rate >= 80 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                                  rate >= 50 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
                                  'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                                )}>
                                  {formatPercent(rate, 0)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums whitespace-nowrap text-xs">
                                {c.avgDeliveryDays != null ? `${c.avgDeliveryDays.toFixed(1)}d` : '—'}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Guías Stuck */}
        <TabsContent value="stuck" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" />
                Guías estancadas
              </CardTitle>
              <CardDescription>
                {data.stuckGuides.length} guías sin movimiento &gt; 3 días
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {data.stuckGuides.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  No hay guías estancadas
                </div>
              ) : (
                <ScrollArea className="max-h-96">
                  <div className="divide-y">
                    {data.stuckGuides.map((g) => (
                      <StuckGuideRow key={g.id} guide={g} tenantId={tenantId!} onChanged={load} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Alerts section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="size-4 text-rose-500" />
            Alertas de comportamiento
          </CardTitle>
          <CardDescription>
            {data.alerts.length} alertas activas · generadas por BuyerBehavior + BehaviorAlert
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.alerts.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Sin alertas — comportamiento de clientes normal
            </div>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="divide-y">
                {data.alerts.map((a) => {
                  const sev = alertSeverity(a.alertType)
                  const meta = severityMeta(sev)
                  return (
                    <div key={a.id} className="p-4 flex items-start gap-3">
                      <span className={cn('size-2 rounded-full mt-1.5 shrink-0', meta.dot)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={cn('text-[10px]', meta.cls)}>
                            {meta.label}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground">
                            {a.alertType}
                          </span>
                          {a.buyerBehavior && (
                            <span className="text-xs font-mono text-muted-foreground">
                              · {a.buyerBehavior.phone}
                            </span>
                          )}
                        </div>
                        <p className="text-sm mt-1 break-words">{a.message}</p>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {timeAgo(a.createdAt)}
                          </span>
                          {a.buyerBehavior && (
                            <>
                              <span>· Riesgo: {a.buyerBehavior.riskLevel}</span>
                              <span>· Devoluciones: {a.buyerBehavior.totalReturns}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="size-4 text-emerald-600" />
            Acciones rápidas (agentes)
          </CardTitle>
          <CardDescription>
            Recalcula scores, dispara alertas y notifica clientes con los agentes especializados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <AgentButton
              label="customer_score"
              display="Recalcular score de clientes"
              icon={<ShieldCheck className="size-4" />}
              tenantId={tenantId!}
              onDone={load}
            />
            <AgentButton
              label="carrier_score"
              display="Recalcular score de transportadoras"
              icon={<Truck className="size-4" />}
              tenantId={tenantId!}
              onDone={load}
            />
            <AgentButton
              label="guide_alert"
              display="Disparar alertas de guías"
              icon={<AlertTriangle className="size-4" />}
              tenantId={tenantId!}
              onDone={load}
            />
            <AgentButton
              label="logistics_notifier"
              display="Notificar clientes logística"
              icon={<Send className="size-4" />}
              tenantId={tenantId!}
              onDone={load}
            />
          </div>
        </CardContent>
      </Card>
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
  tone: 'emerald' | 'amber' | 'rose' | 'slate'
}) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-600 ring-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-600 ring-rose-500/20',
    slate: 'bg-slate-500/10 text-slate-600 ring-slate-500/20',
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

function StuckGuideRow({
  guide, tenantId, onChanged,
}: {
  guide: GuideTracking
  tenantId: string
  onChanged: () => void
}) {
  const [loading, setLoading] = useState(false)
  const createNovedad = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/agents/guide_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          guideNumber: guide.guideNumber,
          carrierName: guide.carrierName,
          daysStuck: guide.daysStuck,
          trigger: 'stuck_manual',
        }),
      })
      if (!res.ok) throw new Error('agent failed')
      const json = await res.json()
      toast.success(`Novedad creada para ${guide.guideNumber}`, {
        description: json.reply?.slice(0, 120),
      })
      onChanged()
    } catch {
      toast.error(`No se pudo crear novedad para ${guide.guideNumber}`)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="p-4 flex items-center gap-3">
      <div className="size-9 rounded-lg bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 flex items-center justify-center shrink-0">
        <AlertTriangle className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-semibold truncate max-w-[180px]">
            {guide.guideNumber}
          </span>
          {guide.carrierName && (
            <Badge variant="outline" className="text-[10px] truncate max-w-[120px]">
              {guide.carrierName}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {guide.daysStuck}d stuck
          </Badge>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {guide.lastEventAt ? `Último evento: ${shortDate(guide.lastEventAt)}` : 'Sin eventos registrados'}
          {' · '}estado {guide.status}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={createNovedad} disabled={loading}>
        Crear novedad
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}

function AgentButton({
  label, display, icon, tenantId, onDone,
}: {
  label: string
  display: string
  icon: React.ReactNode
  tenantId: string
  onDone: () => void
}) {
  const [loading, setLoading] = useState(false)
  const run = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/agents/${label}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (!res.ok) throw new Error('agent failed')
      const json = await res.json()
      toast.success(display, {
        description: json.reply?.slice(0, 120) || 'Agente ejecutado',
      })
      onDone()
    } catch {
      toast.error(`No se pudo ejecutar ${label}`)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Button
      variant="outline"
      className="h-auto py-3 justify-start flex-col items-start gap-1 text-left"
      onClick={run}
      disabled={loading}
    >
      <span className="flex items-center gap-2 text-xs font-mono text-emerald-600 dark:text-emerald-400">
        {loading ? <RefreshCw className="size-3.5 animate-spin" /> : icon}
        {label}
      </span>
      <span className="text-sm font-medium text-foreground leading-tight">{display}</span>
    </Button>
  )
}
