'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { toast } from 'sonner'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
} from 'recharts'
import {
  RefreshCw, AlertCircle, DollarSign, Zap, Activity, Clock, Save,
} from 'lucide-react'
import { useTenantId } from '@/hooks/use-tenant'
import { t } from '@/lib/i18n'
import { timeAgo, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────────────────────────────────────────────────────
// SPRINT-FRONTEND-VIEWS-001 · §1 — Dashboard de costos de IA.
//
// Visualiza la actividad del LLM del tenant: KPIs globales (costo, tokens,
// llamadas, latencia), serie diaria (Recharts AreaChart), desglose por
// agente + por modelo, estado del presupuesto diario/mensual, y un form
// admin-only para actualizar el presupuesto (POST /api/llm/budget).
//
// Endpoints consumidos:
//   - GET /api/llm/costs           → total + byAgent + byModel + byDay
//   - GET /api/llm/costs/breakdown → byDay con avgLatencyMs por día +
//                                    byModel (desde Sprint 10C §3) +
//                                    byAgent + total
//   - GET /api/llm/budget          → presupuesto diario + mensual + spent
//   - POST /api/llm/budget         → admin-only, actualiza uno o ambos caps
//
// Notas:
//   - Los dos primeros endpoints se llaman en paralelo (Promise.all) —
//     `/costs` ya trae byDay pero `/breakdown` incluye avgLatencyMs por
//     día (útil para correlacionar picos de costo con latencia). El shape
//     final mergea ambos.
//   - SPRINT-AI-FRONTEND-001 §2 — `byModel` se prefiere del endpoint
//     `/breakdown` (que lo añadió en Sprint 10C §3) y cae a `/costs`
//     como fallback. Esto permite que un refactor futuro elimine la
//     llamada a `/costs` por completo y obtenga todo desde `/breakdown`.
//   - El form de presupuesto sólo se muestra a `admin` (rol del tenant).
//     La API hace `requireRole(['admin'])` igualmente, así que el gateo
//     en cliente es solo cosmético — la llamada fallará con 403 para
//     usuarios no-admin.
// ───────────────────────────────────────────────────────────────────────────

interface CostTotal {
  costUsd: number
  totalTokens: number
  promptTokens?: number
  completionTokens?: number
  callCount: number
  avgLatencyMs?: number
}

interface CostByAgent {
  agent: string
  costUsd: number
  totalTokens: number
  callCount: number
}

interface CostByModel {
  model: string
  costUsd: number
  totalTokens: number
  callCount: number
}

interface CostByDay {
  date: string
  costUsd: number
  totalTokens: number
  callCount: number
  avgLatencyMs?: number
}

interface CostData {
  total: CostTotal
  byAgent: CostByAgent[]
  byModel: CostByModel[]
  byDay: CostByDay[]
}

interface BudgetBucket {
  budget: number
  spent: number
  remaining: number
}

interface BudgetData {
  daily: BudgetBucket
  monthly: BudgetBucket
}

export function LLMCostsView() {
  const tenantId = useTenantId()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'admin'

  const [data, setData] = useState<CostData | null>(null)
  const [budget, setBudget] = useState<BudgetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async (showRefreshing = false) => {
    if (!tenantId) return
    // `setRefreshing(true)` is only synchronous when refreshing; on
    // initial mount (showRefreshing=false) no setState runs synchronously
    // inside the effect, so the `react-hooks/set-state-in-effect` rule
    // stays happy. All other setState calls happen after the await.
    if (showRefreshing) setRefreshing(true)
    try {
      const [costs, breakdown, budgetRes] = await Promise.all([
        fetch(`/api/llm/costs?tenantId=${tenantId}&days=30`).then(r => r.json()),
        fetch(`/api/llm/costs/breakdown?tenantId=${tenantId}&days=30`).then(r => r.json()),
        fetch(`/api/llm/budget?tenantId=${tenantId}`).then(r => r.json()),
      ])
      // Merge: `/costs` trae byModel + avgLatencyMs total. `/breakdown`
      // trae byDay con avgLatencyMs por día (más rico para el chart).
      // SPRINT-AI-FRONTEND-001 §2 — `byModel` se prefiere del endpoint
      // `/breakdown` (que lo añadió en Sprint 10C §3); cae a `/costs`
      // como fallback para compatibilidad con deployments que no hayan
      // aplicado ese cambio. Misma lógica que `byDay` (que ya prefería
      // `/breakdown`).
      setData({
        total: costs.total ?? { costUsd: 0, totalTokens: 0, callCount: 0 },
        byAgent: costs.byAgent ?? [],
        byModel: breakdown.byModel ?? costs.byModel ?? [],
        byDay: breakdown.byDay ?? costs.byDay ?? [],
      })
      // `/budget` devuelve top-level (daily) + nested `monthly`. Lo
      // normalizamos al shape `BudgetData` que usa el componente.
      setBudget({
        daily: {
          budget: budgetRes.budget ?? 0,
          spent: budgetRes.spent ?? 0,
          remaining: budgetRes.remaining ?? 0,
        },
        monthly: {
          budget: budgetRes.monthly?.budget ?? 0,
          spent: budgetRes.monthly?.spent ?? 0,
          remaining: budgetRes.monthly?.remaining ?? 0,
        },
      })
      setError(null)
      setLastUpdated(new Date())
    } catch {
      setError('No se pudo cargar la información de costos de IA. Verifica tu conexión o intenta de nuevo.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    void load()
  }, [load, tenantId])

  if (error && !data) {
    return (
      <section aria-label="Costos de IA">
        <Alert variant="destructive" className="animate-fade-in-up">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar costos de IA</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => load(true)} className="gap-1.5">
              <RefreshCw className="size-3.5" /> {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  if (loading || !data) {
    return (
      <section aria-label="Costos de IA" className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-56 rounded-md" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </section>
    )
  }

  const formatUsd = (n: number) => `$${(n ?? 0).toFixed(4)}`
  const formatNum = (n: number) => (n ?? 0).toLocaleString('es-CO')
  const hasData = data.total.callCount > 0 || data.byDay.length > 0

  return (
    <section aria-label="Costos de IA" className="space-y-6 animate-fade-in-up">
      {/* Header: last-updated + refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Costos de IA</h2>
          <p className="text-sm text-muted-foreground">
            Uso y costos de LLM por agente, modelo y día · últimos 30 días
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {t('common.last_updated').replace('{time}', timeAgo(lastUpdated.toISOString()))}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5 h-9 px-3">
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            {refreshing ? t('common.refreshing') : t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Budget status — daily + monthly */}
      {budget && (
        <div className="grid gap-4 md:grid-cols-2">
          <BudgetCard title="Presupuesto diario" bucket={budget.daily} resetLabel="reinicia a medianoche" />
          <BudgetCard title="Presupuesto mensual" bucket={budget.monthly} resetLabel="reinicia el 1° del mes" />
        </div>
      )}

      {/* KPI cards — total 30d */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={DollarSign} accent="bg-emerald-500/10 text-emerald-600 ring-emerald-500/20" label="Costo total (30d)" value={formatUsd(data.total.costUsd)} />
        <KpiCard icon={Zap} accent="bg-sky-500/10 text-sky-600 ring-sky-500/20" label="Tokens totales" value={formatNum(data.total.totalTokens)} />
        <KpiCard icon={Activity} accent="bg-violet-500/10 text-violet-600 ring-violet-500/20" label="Llamadas totales" value={formatNum(data.total.callCount)} />
        <KpiCard icon={Clock} accent="bg-amber-500/10 text-amber-600 ring-amber-500/20" label="Latencia promedio" value={`${Math.round(data.total.avgLatencyMs ?? 0)}ms`} />
      </div>

      {/* Empty state — tenant sin actividad LLM todavía */}
      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 px-4">
            <div className="size-16 rounded-2xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center mb-4">
              <Zap className="size-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Sin actividad de IA todavía</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-2">
              Cuando los agentes del orquestador ejecuten llamadas LLM (chat, checkout, objeción, etc.),
              los costos y tokens consumidos aparecerán aquí automáticamente.
            </p>
            <Button variant="outline" size="sm" className="mt-5 gap-1.5" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} /> {t('common.refresh')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Daily cost chart */}
          {data.byDay.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Costo diario</CardTitle>
                <CardDescription>Últimos 30 días · USD</CardDescription>
              </CardHeader>
              <CardContent>
                <figure role="img" aria-label="Costo diario de LLM en los últimos 30 días en USD">
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={data.byDay} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                      <defs>
                        <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <YAxis tickFormatter={(v) => `$${Number(v).toFixed(2)}`} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <RTooltip
                        contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                        formatter={(v: number) => [`$${Number(v).toFixed(4)}`, 'Costo']}
                        labelFormatter={(l) => shortDate(l as string)}
                      />
                      <Area type="monotone" dataKey="costUsd" stroke="#10b981" strokeWidth={2} fill="url(#costGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </figure>
              </CardContent>
            </Card>
          )}

          {/* Breakdown tables — agent + model side-by-side on xl */}
          <div className="grid gap-4 xl:grid-cols-2">
            {/* Per-agent breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Desglose por agente</CardTitle>
                <CardDescription>{data.byAgent.length} agentes · ordenados por costo</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto scroll-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agente</TableHead>
                        <TableHead className="text-right">Llamadas</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Costo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byAgent.map((a) => (
                        <TableRow key={a.agent}>
                          <TableCell className="font-medium">{a.agent}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNum(a.callCount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNum(a.totalTokens)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatUsd(a.costUsd)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Per-model breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Desglose por modelo</CardTitle>
                <CardDescription>{data.byModel.length} modelos · ordenados por costo</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.byModel.length === 0 ? (
                  <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                    No hay datos por modelo todavía.
                  </div>
                ) : (
                  <div className="overflow-x-auto scroll-thin">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Modelo</TableHead>
                          <TableHead className="text-right">Llamadas</TableHead>
                          <TableHead className="text-right">Tokens</TableHead>
                          <TableHead className="text-right">Costo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.byModel.map((m) => (
                          <TableRow key={m.model}>
                            <TableCell className="font-mono text-xs">{m.model}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatNum(m.callCount)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatNum(m.totalTokens)}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{formatUsd(m.costUsd)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Budget configuration form — admin only */}
      {isAdmin && tenantId && (
        <BudgetConfigForm
          tenantId={tenantId}
          current={budget}
          onSaved={(updated) => {
            setBudget(updated)
            // Refresca todo (spent cambia al cambiar budget; cache invalidado en backend).
            load(true)
          }}
        />
      )}
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ───────────────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, accent, label, value }: {
  icon: typeof DollarSign
  accent: string
  label: string
  value: string
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('size-10 rounded-xl flex items-center justify-center ring-1', accent)}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium truncate">{label}</div>
          <div className="text-xl font-bold tabular-nums truncate">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function BudgetCard({ title, bucket, resetLabel }: {
  title: string
  bucket: BudgetBucket
  resetLabel: string
}) {
  const pct = bucket.budget > 0 ? (bucket.spent / bucket.budget) * 100 : 0
  const isWarning = pct > 80 && pct <= 95
  const isCritical = pct > 95
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span>{title}</span>
          {isCritical ? (
            <Badge variant="destructive" className="text-[10px]">Crítico</Badge>
          ) : isWarning ? (
            <Badge variant="secondary" className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300">Advertencia</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Saludable</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className={cn(
            'text-2xl font-bold tabular-nums',
            isCritical ? 'text-rose-600 dark:text-rose-400' : isWarning ? 'text-amber-600 dark:text-amber-400' : '',
          )}>
            ${bucket.spent.toFixed(4)}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">/ ${bucket.budget.toFixed(2)}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              isCritical ? 'bg-rose-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500',
            )}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {bucket.remaining > 0
              ? t('budget.daily_remaining').replace('${remaining}', `$${bucket.remaining.toFixed(4)}`)
              : 'Presupuesto excedido'}
          </span>
          <span>{resetLabel}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function BudgetConfigForm({ tenantId, current, onSaved }: {
  tenantId: string
  current: BudgetData | null
  onSaved: (updated: BudgetData) => void
}) {
  const [daily, setDaily] = useState('')
  const [monthly, setMonthly] = useState('')
  const [saving, setSaving] = useState(false)

  // Inicializa los inputs cuando llega el budget actual.
  useEffect(() => {
    if (current) {
      setDaily(current.daily.budget > 0 ? String(current.daily.budget) : '')
      setMonthly(current.monthly.budget > 0 ? String(current.monthly.budget) : '')
    }
  }, [current])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const dailyNum = daily.trim() === '' ? undefined : Number(daily)
    const monthlyNum = monthly.trim() === '' ? undefined : Number(monthly)
    if (dailyNum === undefined && monthlyNum === undefined) {
      toast.error('Ingresa al menos un presupuesto (diario o mensual)')
      return
    }
    if (dailyNum !== undefined && (Number.isNaN(dailyNum) || dailyNum <= 0)) {
      toast.error('El presupuesto diario debe ser un número positivo')
      return
    }
    if (monthlyNum !== undefined && (Number.isNaN(monthlyNum) || monthlyNum <= 0)) {
      toast.error('El presupuesto mensual debe ser un número positivo')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/llm/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          ...(dailyNum !== undefined ? { budgetUsd: dailyNum } : {}),
          ...(monthlyNum !== undefined ? { monthlyBudgetUsd: monthlyNum } : {}),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const j = await res.json()
      const updated: BudgetData = {
        daily: { budget: j.budget, spent: j.spent, remaining: j.remaining },
        monthly: {
          budget: j.monthly?.budget ?? 0,
          spent: j.monthly?.spent ?? 0,
          remaining: j.monthly?.remaining ?? 0,
        },
      }
      onSaved(updated)
      toast.success('Presupuesto actualizado')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al actualizar el presupuesto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="size-4 text-primary" />
          Configuración de presupuesto
        </CardTitle>
        <CardDescription>
          Solo admin · ajusta los caps diario y mensual de LLM en USD. El cache se invalida inmediatamente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="llm-budget-daily">Presupuesto diario (USD)</Label>
            <Input
              id="llm-budget-daily"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="10.00"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              disabled={saving}
            />
            {current && (
              <p className="text-[11px] text-muted-foreground">
                Actual: ${current.daily.budget.toFixed(2)} · gastado ${current.daily.spent.toFixed(4)}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="llm-budget-monthly">Presupuesto mensual (USD)</Label>
            <Input
              id="llm-budget-monthly"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="300.00"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              disabled={saving}
            />
            {current && (
              <p className="text-[11px] text-muted-foreground">
                Actual: ${current.monthly.budget.toFixed(2)} · gastado ${current.monthly.spent.toFixed(4)}
              </p>
            )}
          </div>
          <Button type="submit" disabled={saving} className="gap-1.5 w-full md:w-auto">
            <Save className="size-3.5" />
            {saving ? t('common.saving_data') : t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
