// ZIAY — Logistics intelligence dashboard view (main composition).
// Split out from logistics-intelligence-view.tsx in AUDIT-FINAL-SPLIT-001 —
// owns the state (load / refresh / search / category filter) and composes
// the three tab sub-components (CustomerScoresTab / CarrierScoresTab /
// StuckGuidesTab) plus the alerts card and quick-actions panel.

'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/hooks/use-tenant'
import { toast } from 'sonner'
import {
  ShieldCheck, ShieldAlert, RotateCcw, Truck, Sparkles, Send,
  AlertTriangle, RefreshCw,
} from 'lucide-react'
import { type LogisticsData } from './logistics-shared'
import { CustomerScoresTab, CarrierScoresTab } from './logistics-scores'
import { StuckGuidesTab } from './logistics-guides'
import { BehaviorAlertsCard } from './logistics-alerts'

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
          <CustomerScoresTab
            customers={data.customerScores}
            filteredCustomers={filteredCustomers}
            searchPhone={searchPhone}
            categoryFilter={categoryFilter}
            onSearchPhoneChange={setSearchPhone}
            onCategoryFilterChange={setCategoryFilter}
          />
        </TabsContent>

        {/* Scores de Transportadoras */}
        <TabsContent value="carriers" className="mt-4">
          <CarrierScoresTab
            carriers={data.carrierScores}
            chartData={carrierChartData}
          />
        </TabsContent>

        {/* Guías Stuck */}
        <TabsContent value="stuck" className="mt-4">
          <StuckGuidesTab
            guides={data.stuckGuides}
            tenantId={tenantId!}
            onChanged={load}
          />
        </TabsContent>
      </Tabs>

      {/* Alerts section */}
      <BehaviorAlertsCard alerts={data.alerts} />

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
// Internal sub-components (only used in the main view)
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
