// ZIAY — NovedadesView (main composition).
//
// SPRINT3-REFACTOR-001 split the original 1296-line novedades-view.tsx
// into focused sub-modules under this directory:
//   - shared.tsx              — types, helpers, StatCard
//   - novedades-list.tsx      — left filter + cases list
//   - novedades-detail.tsx    — right case detail panel
//   - novedades-redelivery.tsx — redelivery tab + RedeliveryCard
//   - novedades-history.tsx   — history tab (read-only table)
//   - novedades-dialogs.tsx   — CreateCaseDialog + CreateRedeliveryDialog
//
// This file owns the state machine (cases, filters, detail, redelivery,
// history) and composes the sub-modules. UI is byte-for-byte identical to
// the original.

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs'
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, RefreshCw,
} from 'lucide-react'

import { useTenantId } from '@/hooks/use-tenant'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import { t } from '@/lib/i18n'

import {
  type CaseRow, type CaseDetail, type RedeliveryRequest, StatCard,
} from './shared'
import { NovedadesList } from './novedades-list'
import { CaseDetailPanel } from './novedades-detail'
import { RedeliveryTab } from './novedades-redelivery'
import { HistoryTab } from './novedades-history'
import { CreateCaseDialog, CreateRedeliveryDialog } from './novedades-dialogs'

export function NovedadesView() {
  const tenantId = useTenantId()
  const [tab, setTab] = useState('cases')

  // ── Cases list state ─────────────────────────────────────────────────
  const [cases, setCases] = useState<CaseRow[]>([])
  const [stats, setStats] = useState({ total: 0, open: 0, assigned: 0, resolved: 0, escalated: 0, closed: 0 })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [carrierFilter, setCarrierFilter] = useState('all')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)

  const loadCases = useCallback(async (showRefreshing = false) => {
    if (!tenantId) return
    setLoading(true)
    if (showRefreshing) setRefreshing(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        tenantId,
        status: statusFilter,
        type: typeFilter,
        carrier: carrierFilter,
        q,
      })
      const res = await fetch(`/api/novedades?${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load cases')
      const j = await res.json()
      setCases(j.cases || [])
      setStats(j.stats || stats)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Novedades loadCases failed', err)
      setError('No pudimos cargar las novedades. Verifica tu conexión o intenta de nuevo.')
      toast.error('Error al cargar novedades')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [tenantId, statusFilter, typeFilter, carrierFilter, q])

  useEffect(() => { void loadCases() }, [loadCases])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/novedades/${id}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load case detail')
      const j = await res.json()
      setDetail(j)
    } catch {
      toast.error('Error al cargar el detalle')
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  // ── Redelivery state ─────────────────────────────────────────────────
  const [rdStatus, setRdStatus] = useState('all')
  const [rdRequests, setRdRequests] = useState<RedeliveryRequest[]>([])
  const [rdStats, setRdStats] = useState({ total: 0, pending: 0, scheduled: 0, completed: 0, cancelled: 0 })
  const [rdLoading, setRdLoading] = useState(false)
  const [rdCreateOpen, setRdCreateOpen] = useState(false)

  const loadRedelivery = useCallback(async () => {
    if (!tenantId) return
    setRdLoading(true)
    try {
      const params = new URLSearchParams({ tenantId, status: rdStatus })
      const res = await fetch(`/api/redelivery?${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load redelivery')
      const j = await res.json()
      setRdRequests(j.requests || [])
      setRdStats(j.stats || rdStats)
    } catch {
      toast.error('Error al cargar reintentos')
    } finally {
      setRdLoading(false)
    }
  }, [tenantId, rdStatus])

  useEffect(() => {
    if (tab === 'redelivery') void loadRedelivery()
  }, [tab, loadRedelivery])

  // ── History state (resolved/closed only) ─────────────────────────────
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')
  const historyCases = useMemo(() => {
    return cases
      .filter(c => ['resolved', 'closed'].includes(c.status))
      .filter(c => {
        if (historyFrom && new Date(c.createdAt) < new Date(historyFrom)) return false
        if (historyTo && new Date(c.createdAt) > new Date(historyTo + 'T23:59:59')) return false
        return true
      })
  }, [cases, historyFrom, historyTo])

  // ── Loading skeleton ─────────────────────────────────────────────────
  if (loading && tab === 'cases' && cases.length === 0) {
    return (
      <section aria-label="Novedades" className="space-y-4" aria-busy="true" role="status">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
        </div>
      </section>
    )
  }

  // ── Error state (only when initial load failed and there is no data) ──
  if (error && cases.length === 0 && tab === 'cases') {
    return (
      <section aria-label="Novedades">
        <Alert variant="destructive" className="animate-fade-in-up">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar las novedades</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void loadCases(true)} className="gap-1.5">
              <RefreshCw className="size-3.5" /> Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  return (
    <section aria-label="Novedades" className="space-y-6 animate-fade-in-up">
      {/* ── Header: last-updated + refresh ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] sm:text-xs text-muted-foreground truncate">
          {lastUpdated ? (
            <span>Actualizado hace <strong className="text-foreground tabular-nums">{timeAgo(lastUpdated)}</strong></span>
          ) : (
            <span>Datos de muestra</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadCases(true)} disabled={refreshing} className="gap-1.5 h-9 px-3">
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          {refreshing ? t('common.refreshing') : t('common.refresh')}
        </Button>
      </div>

      {/* ── Stat strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={AlertCircle} label="Total" value={String(stats.total)} accent="bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20" />
        <StatCard icon={Clock} label="Abiertos" value={String(stats.open + stats.assigned)} accent="bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20" />
        <StatCard icon={AlertTriangle} label="Escalados" value={String(stats.escalated)} accent="bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20" />
        <StatCard icon={CheckCircle2} label="Resueltos" value={String(stats.resolved + stats.closed)} accent="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="cases">Casos</TabsTrigger>
          <TabsTrigger value="redelivery">Reintentos</TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>

        {/* ── Cases tab ─────────────────────────────────────────────── */}
        <TabsContent value="cases" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Left: filter + list */}
            <div className="lg:col-span-2 space-y-3">
              <NovedadesList
                cases={cases}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                q={q}
                setQ={setQ}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                typeFilter={typeFilter}
                setTypeFilter={setTypeFilter}
                carrierFilter={carrierFilter}
                setCarrierFilter={setCarrierFilter}
                onCreateOpen={() => setCreateOpen(true)}
              />
            </div>

            {/* Right: case detail */}
            <div className="lg:col-span-3">
              <CaseDetailPanel
                detail={detail}
                loading={detailLoading}
                selectedId={selectedId}
                onReload={() => selectedId && loadDetail(selectedId)}
                onListReload={loadCases}
              />
            </div>
          </div>
        </TabsContent>

        {/* ── Redelivery tab ────────────────────────────────────────── */}
        <TabsContent value="redelivery">
          <RedeliveryTab
            rdStatus={rdStatus}
            setRdStatus={setRdStatus}
            rdLoading={rdLoading}
            rdRequests={rdRequests}
            rdStats={rdStats}
            loadRedelivery={loadRedelivery}
            onCreateOpen={() => setRdCreateOpen(true)}
            tenantId={tenantId!}
          />
        </TabsContent>

        {/* ── History tab ───────────────────────────────────────────── */}
        <TabsContent value="history">
          <HistoryTab
            historyCases={historyCases}
            historyFrom={historyFrom}
            setHistoryFrom={setHistoryFrom}
            historyTo={historyTo}
            setHistoryTo={setHistoryTo}
          />
        </TabsContent>
      </Tabs>

      {/* ── Create Case Dialog ─────────────────────────────────────────── */}
      <CreateCaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenantId={tenantId}
        onCreated={() => { void loadCases() }}
      />

      {/* ── Create Redelivery Dialog ───────────────────────────────────── */}
      <CreateRedeliveryDialog
        open={rdCreateOpen}
        onOpenChange={setRdCreateOpen}
        tenantId={tenantId}
        onCreated={() => { void loadRedelivery() }}
      />
    </section>
  )
}
