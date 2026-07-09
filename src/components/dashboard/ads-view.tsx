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
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { formatCurrency, formatNumber, formatPercent, formatMultiplier, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTenantId } from '@/hooks/use-tenant'
import {
  Target, TrendingUp, TrendingDown, DollarSign, Percent, Flame, Skull, Pause,
  Play, Rocket, Eye, AlertTriangle, Search, Gauge,
} from 'lucide-react'

type AdRow = {
  id: string; externalId: string; name: string; creative?: string; status: string; autoKill: boolean; killReason?: string
  campaign: { id: string; name: string }
  platform: { id: string; name: string; displayName: string }
  metrics: {
    spend: number; impressions: number; clicks: number; ctr: number; cpc: number
    convReported: number; orderCount: number; units: number
    revenue: number; paidRevenue: number; aov: number; cogs: number
    grossProfit: number; netProfit: number
    cpa: number | null; cpl: number; cvr: number; roas: number; roi: number
  }
  verdict: 'scale' | 'optimize' | 'watch' | 'pause' | 'kill' | 'cannibalize'
  cannibalizing: boolean
  flags: { burning: boolean; underRoas: boolean; platformGap: number; scalesWell: boolean }
}

type AdsData = {
  range: { days: number }
  thresholds: { roasKill: number; cpaTarget: number }
  totals: { spend: number; revenue: number; paidRevenue: number; orders: number; units: number; netProfit: number; roas: number; roi: number; cpa: number }
  series: { date: string; spend: number }[]
  rows: AdRow[]
}

const verdictMeta = (v: AdRow['verdict']) => {
  switch (v) {
    case 'scale': return { label: 'Escalar', cls: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20', icon: Rocket, desc: 'ROAS ≥ 2x y volumen — subir presupuesto' }
    case 'optimize': return { label: 'Optimizar', cls: 'bg-sky-500/10 text-sky-600 ring-sky-500/20', icon: Gauge, desc: 'ROAS 1-2x — probar variantes creativas' }
    case 'watch': return { label: 'Vigilar', cls: 'bg-slate-500/10 text-slate-600 ring-slate-500/20', icon: Eye, desc: 'Bajo volumen — esperar más data' }
    case 'pause': return { label: 'Pausar', cls: 'bg-amber-500/10 text-amber-600 ring-amber-500/20', icon: Pause, desc: 'ROAS bajo + gasto material — pausar' }
    case 'kill': return { label: 'Apagar', cls: 'bg-rose-500/10 text-rose-600 ring-rose-500/20', icon: Skull, desc: 'Quema presupuesto sin ventas' }
    case 'cannibalize': return { label: 'Canibaliza', cls: 'bg-violet-500/10 text-violet-600 ring-violet-500/20', icon: Flame, desc: 'Atribuye conversiones falsas — apagar YA' }
    default: return { label: v, cls: 'bg-slate-500/10 text-slate-600', icon: Eye, desc: '' }
  }
}

const platformMeta = (name: string) => {
  switch (name) {
    case 'meta': return { label: 'Meta', cls: 'bg-sky-500/10 text-sky-600' }
    case 'google': return { label: 'Google', cls: 'bg-amber-500/10 text-amber-600' }
    case 'tiktok': return { label: 'TikTok', cls: 'bg-slate-900/10 text-slate-700 dark:text-slate-300' }
    default: return { label: name, cls: 'bg-slate-500/10 text-slate-600' }
  }
}

function TotalsKpi({ icon: Icon, label, value, sub, accent }: {
  icon: typeof DollarSign; label: string; value: string; sub?: string; accent: string
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('size-10 rounded-xl flex items-center justify-center ring-1', accent)}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</div>
          <div className="text-xl font-bold tabular-nums">{value}</div>
          {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

export function AdsView() {
  const tenantId = useTenantId()
  const [data, setData] = useState<AdsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    fetch(`/api/ads?days=14&platform=${platform}&tenantId=${tenantId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [platform, tenantId])

  const doAction = async (id: string, action: 'pause' | 'kill' | 'resume' | 'scale', reason?: string) => {
    await fetch(`/api/ads/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    })
    setData(prev => prev ? {
      ...prev,
      rows: prev.rows.map(r => r.id === id ? { ...r, status: action === 'resume' || action === 'scale' ? 'active' : action === 'kill' ? 'killed' : 'paused', autoKill: action === 'kill' } : r),
    } : prev)
    toast.success(`Anuncio ${action === 'kill' ? 'apagado' : action === 'pause' ? 'pausado' : action === 'scale' ? 'marcado para escalar' : 'reanudado'}`)
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  const t = data.totals
  const filteredRows = data.rows.filter(r =>
    (platform === 'all' || r.platform.name === platform) &&
    (q === '' || r.name.toLowerCase().includes(q.toLowerCase()) || r.externalId.toLowerCase().includes(q.toLowerCase()))
  )
  const killCount = filteredRows.filter(r => r.verdict === 'kill' || r.verdict === 'cannibalize').length
  const scaleCount = filteredRows.filter(r => r.verdict === 'scale').length
  const wastedSpend = filteredRows.filter(r => r.metrics.orderCount === 0).reduce((s, r) => s + r.metrics.spend, 0)

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Totals KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <TotalsKpi icon={DollarSign} label="Inversión pauta (14d)" value={formatCurrency(t.spend, 'COP', { compact: true })} sub={`${data.rows.length} anuncios activos`} accent="bg-rose-500/10 text-rose-600 ring-rose-500/20" />
        <TotalsKpi icon={Target} label="ROAS consolidado" value={formatMultiplier(t.roas)} sub={`CPA ${formatCurrency(t.cpa)}`} accent="bg-primary/10 text-primary ring-primary/20" />
        <TotalsKpi icon={TrendingUp} label="Ventas atribuidas" value={formatNumber(t.orders)} sub={`${formatCurrency(t.paidRevenue, 'COP', { compact: true })} cobrados`} accent="bg-emerald-500/10 text-emerald-600 ring-emerald-500/20" />
        <TotalsKpi icon={Percent} label="Utilidad neta" value={formatCurrency(t.netProfit, 'COP', { compact: true })} sub={`ROI ${formatMultiplier(t.roi)}`} accent={t.netProfit >= 0 ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20' : 'bg-rose-500/10 text-rose-600 ring-rose-500/20'} />
      </div>

      {/* Alerts + spend trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500" /> Alertas del trafficker</CardTitle>
            <CardDescription>Umbrales: ROAS kill &lt; {data.thresholds.roasKill}x · CPA objetivo {formatCurrency(data.thresholds.cpaTarget)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/20 flex items-start gap-3">
              <Skull className="size-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-rose-700 dark:text-rose-400">{killCount} anuncios para apagar</div>
                <div className="text-xs text-muted-foreground mt-0.5">Queman {formatCurrency(wastedSpend, 'COP', { compact: true })} sin generar ventas reales</div>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 flex items-start gap-3">
              <Rocket className="size-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{scaleCount} anuncios para escalar</div>
                <div className="text-xs text-muted-foreground mt-0.5">ROAS ≥ 2x con volumen — subir presupuesto</div>
              </div>
            </div>
            <Button variant="default" size="sm" className="w-full gap-1.5" onClick={() => toast.success('Acción masiva ejecutada (demo)')}>
              <Flame className="size-3.5" /> Apagar todos los canibalizadores
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Inversión diaria en pauta</CardTitle>
            <CardDescription>Últimos 14 días · COP</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.series} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={(v) => formatCurrency(v, 'COP', { compact: true })} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <RTooltip contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [formatCurrency(v), 'Inversión']} labelFormatter={(l) => shortDate(l as string)} />
                <Area type="monotone" dataKey="spend" stroke="#f43f5e" strokeWidth={2} fill="url(#spendG)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Ads table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="text-base">Rendimiento por anuncio</CardTitle>
              <CardDescription>Identificador de anuncio · ventas en cantidad y valor · CPA, ROAS, ROI · detección de canibalización</CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ad ID o nombre..." className="pl-8 h-9 w-52" />
              </div>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las plataformas</SelectItem>
                  <SelectItem value="meta">Meta Ads</SelectItem>
                  <SelectItem value="google">Google Ads</SelectItem>
                  <SelectItem value="tiktok">TikTok Ads</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Anuncio (ID plataforma)</TableHead>
                  <TableHead className="w-28">Plataforma</TableHead>
                  <TableHead className="text-right w-28">Inversión</TableHead>
                  <TableHead className="text-right w-24">CTR/CPC</TableHead>
                  <TableHead className="text-right w-24">Conv. rep.</TableHead>
                  <TableHead className="text-right w-28">Ventas reales</TableHead>
                  <TableHead className="text-right w-28">Ingresos</TableHead>
                  <TableHead className="text-right w-24">CPA</TableHead>
                  <TableHead className="text-right w-24">ROAS</TableHead>
                  <TableHead className="text-right w-24">ROI</TableHead>
                  <TableHead className="w-32">Veredicto</TableHead>
                  <TableHead className="w-40 text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => {
                  const vm = verdictMeta(r.verdict)
                  const VIcon = vm.icon
                  const pm = platformMeta(r.platform.name)
                  return (
                    <TableRow key={r.id} className={cn('hover:bg-muted/40', r.cannibalizing && 'bg-violet-500/5', r.verdict === 'kill' && 'bg-rose-500/5')}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {r.cannibalizing && <Flame className="size-3.5 text-violet-600 shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate max-w-52">{r.name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono truncate max-w-52" title={r.externalId}>{r.externalId}</div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-52">{r.campaign.name}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><span className={cn('text-[10px] px-1.5 py-0.5 rounded', pm.cls)}>{pm.label}</span></TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatCurrency(r.metrics.spend, 'COP', { compact: true })}</TableCell>
                      <TableCell className="text-right">
                        <div className="text-xs tabular-nums">{formatPercent(r.metrics.ctr)}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(r.metrics.cpc)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={cn(r.flags.platformGap > 0 && 'text-violet-600 font-medium')} title="Conversiones reportadas por la plataforma vs ventas reales">
                          {r.metrics.convReported}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className={cn('font-medium', r.metrics.orderCount === 0 ? 'text-rose-600' : 'text-emerald-600')}>{r.metrics.orderCount}</div>
                        <div className="text-[10px] text-muted-foreground">{r.metrics.units} und</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className="font-medium text-sm">{formatCurrency(r.metrics.paidRevenue, 'COP', { compact: true })}</div>
                        <div className="text-[10px] text-muted-foreground">AOV {formatCurrency(r.metrics.aov)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.metrics.cpa === null ? <span className="text-rose-600 text-xs">∞</span> : (
                          <span className={cn('text-xs', (r.metrics.cpa || 0) > data.thresholds.cpaTarget ? 'text-rose-600' : 'text-muted-foreground')}>
                            {formatCurrency(r.metrics.cpa)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn(
                                'inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded',
                                r.metrics.roas >= 2 ? 'bg-emerald-500/10 text-emerald-600'
                                  : r.metrics.roas >= 1 ? 'bg-sky-500/10 text-sky-600'
                                  : r.metrics.roas > 0 ? 'bg-rose-500/10 text-rose-600'
                                  : 'bg-slate-500/10 text-slate-600'
                              )}>
                                {r.metrics.roas > 0 ? formatMultiplier(r.metrics.roas) : '—'}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs space-y-0.5">
                                <div>Ganancia bruta: {formatCurrency(r.metrics.grossProfit, 'COP', { compact: true })}</div>
                                <div>Utilidad neta: {formatCurrency(r.metrics.netProfit, 'COP', { compact: true })}</div>
                                <div>CVR: {formatPercent(r.metrics.cvr)}</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={cn('text-xs font-medium', r.metrics.roi >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {formatMultiplier(r.metrics.roi)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ring-1 cursor-help', vm.cls)}>
                                <VIcon className="size-3" /> {vm.label}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs max-w-48">{vm.desc}</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(r.verdict === 'kill' || r.verdict === 'cannibalize') && (
                            <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => doAction(r.id, 'kill', r.cannibalizing ? 'Canibaliza atribución' : 'Sin ventas')}>
                              <Skull className="size-3" /> Apagar
                            </Button>
                          )}
                          {r.verdict === 'pause' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => doAction(r.id, 'pause')}>
                              <Pause className="size-3" /> Pausar
                            </Button>
                          )}
                          {r.verdict === 'scale' && (
                            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => doAction(r.id, 'scale')}>
                              <Rocket className="size-3" /> Escalar
                            </Button>
                          )}
                          {(r.verdict === 'optimize' || r.verdict === 'watch') && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => toast.info('Marcado para vigilar')}>
                              <Eye className="size-3" /> Vigilar
                            </Button>
                          )}
                          {r.status === 'paused' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => doAction(r.id, 'resume')}>
                              <Play className="size-3" /> Reanudar
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Methodology explainer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">¿Cómo se calcula? (Pensamiento ágil para el trafficker)</CardTitle>
          <CardDescription>Métricas clave y lógica de detección de canibalización</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <div className="flex justify-between"><span className="text-muted-foreground">CPA</span><code className="text-xs">inversión ÷ pedidos reales</code></div>
            <div className="flex justify-between"><span className="text-muted-foreground">ROAS</span><code className="text-xs">ingresos cobrados ÷ inversión</code></div>
            <div className="flex justify-between"><span className="text-muted-foreground">ROI</span><code className="text-xs">(utilidad neta) ÷ inversión</code></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CPL</span><code className="text-xs">inversión ÷ conversiones reportadas</code></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CVR</span><code className="text-xs">pedidos ÷ clicks</code></div>
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p><strong className="text-foreground">Canibalización</strong>: la plataforma reporta conversiones pero no llegan pedidos reales (gap &gt; 0). El anuncio "roba" crédito de ventas que vienen por otro canal.</p>
            <p><strong className="text-foreground">Apagar (kill)</strong>: gasto &gt; CPA objetivo y cero ventas reales.</p>
            <p><strong className="text-foreground">Pausar</strong>: ROAS &lt; {data.thresholds.roasKill}x y gasto material (&gt; 2x CPA objetivo).</p>
            <p><strong className="text-foreground">Escalar</strong>: ROAS ≥ 2x con ≥ 2 pedidos.</p>
            <p className="text-primary"><strong>Atribución</strong>: last-click por defecto (configurable a first-touch, lineal o time-decay). El <code>click_id</code> (fbclid/gclid/ttclid) se captura al aterrizar y se pega al pedido.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
