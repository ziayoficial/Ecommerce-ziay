'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertTriangle, AlertCircle, CheckCircle2, Clock, Plus, Search, Send, FileImage,
  MessageSquare, Package, MapPin, Phone, User, Truck, ArrowRight, Loader2, XCircle,
  RefreshCw, Calendar, ChevronRight, History, FileText, Image as ImageIcon, Video,
} from 'lucide-react'

import { useTenantId } from '@/hooks/use-tenant'
import { formatCurrency, shortDate, shortTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

type CaseRow = {
  id: string
  caseNumber: string
  orderId: string | null
  phone: string
  customerName: string
  guideNumber: string | null
  carrierName: string | null
  type: string
  status: string
  priority: string
  description: string
  resolution: string | null
  assignedTo: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  evidenceCount: number
  messageCount: number
  thumbnail: string | null
}

type Evidence = {
  id: string; url: string; type: string; uploadedBy: string | null; createdAt: string
}

type Message = {
  id: string; authorName: string; authorRole: string; body: string; createdAt: string
}

type CaseDetail = {
  case: Omit<CaseRow, 'evidenceCount' | 'messageCount' | 'thumbnail'> & {
    tenantId: string
  }
  evidence: Evidence[]
  messages: Message[]
}

type RedeliveryAttempt = {
  id: string
  attemptNumber: number
  status: string
  carrierResponse: string | null
  agentNote: string | null
  attemptedAt: string
}

type RedeliveryRequest = {
  id: string
  guideNumber: string
  customerPhone: string
  customerName: string
  originalAddress: string
  newAddress: string | null
  reason: string
  status: string
  attemptNumber: number
  scheduledAt: string | null
  completedAt: string | null
  createdAt: string
  attempts: RedeliveryAttempt[]
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const CASE_TYPE_META: Record<string, { label: string; cls: string }> = {
  paquete_perdido: { label: 'Paquete perdido', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  producto_danado: { label: 'Producto dañado', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  direccion_incorrecta: { label: 'Dirección incorrecta', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  retraso: { label: 'Retraso', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  otro: { label: 'Otro', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' },
}

function caseStatusMeta(s: string) {
  switch (s) {
    case 'open': return { label: 'Abierto', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20' }
    case 'assigned': return { label: 'Asignado', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'resolved': return { label: 'Resuelto', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' }
    case 'escalated': return { label: 'Escalado', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20' }
    case 'closed': return { label: 'Cerrado', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

function redeliveryStatusMeta(s: string) {
  switch (s) {
    case 'pending': return { label: 'Pendiente', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20' }
    case 'scheduled': return { label: 'Programado', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'completed': return { label: 'Completado', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' }
    case 'cancelled': return { label: 'Cancelado', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

function attemptStatusMeta(s: string) {
  switch (s) {
    case 'success': return { label: 'Éxito', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }
    case 'failed': return { label: 'Fallido', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' }
    case 'pending': return { label: 'Pendiente', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

function evidenceTypeMeta(t: string) {
  switch (t) {
    case 'image': return { label: 'Imagen', icon: ImageIcon }
    case 'document': return { label: 'Documento', icon: FileText }
    case 'video': return { label: 'Video', icon: Video }
    default: return { label: t, icon: FileImage }
  }
}

function messageRoleMeta(r: string) {
  switch (r) {
    case 'agent': return { cls: 'bg-primary/10 text-primary', label: 'Agente' }
    case 'carrier': return { cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', label: 'Transportista' }
    case 'customer': return { cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', label: 'Cliente' }
    case 'system': return { cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300', label: 'Sistema' }
    default: return { cls: 'bg-muted text-muted-foreground', label: r }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// View
// ───────────────────────────────────────────────────────────────────────────

export function NovedadesView() {
  const tenantId = useTenantId()
  const [tab, setTab] = useState('cases')

  // ── Cases list state ─────────────────────────────────────────────────
  const [cases, setCases] = useState<CaseRow[]>([])
  const [stats, setStats] = useState({ total: 0, open: 0, assigned: 0, resolved: 0, escalated: 0, closed: 0 })
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [carrierFilter, setCarrierFilter] = useState('all')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)

  const loadCases = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
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
    } catch {
      toast.error('Error al cargar novedades')
    } finally {
      setLoading(false)
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
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
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
              <Card>
                <CardHeader className="pb-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">Casos de novedad</CardTitle>
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus className="size-4" /> Nuevo
                    </Button>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      value={q}
                      onChange={e => setQ(e.target.value)}
                      placeholder="Buscar por caso, cliente, guía, teléfono…"
                      className="pl-8"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="open">Abierto</SelectItem>
                        <SelectItem value="assigned">Asignado</SelectItem>
                        <SelectItem value="resolved">Resuelto</SelectItem>
                        <SelectItem value="escalated">Escalado</SelectItem>
                        <SelectItem value="closed">Cerrado</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="paquete_perdido">Paquete perdido</SelectItem>
                        <SelectItem value="producto_danado">Producto dañado</SelectItem>
                        <SelectItem value="direccion_incorrecta">Dirección incorrecta</SelectItem>
                        <SelectItem value="retraso">Retraso</SelectItem>
                        <SelectItem value="otro">Otro</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Carrier" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="Servientrega">Servientrega</SelectItem>
                        <SelectItem value="Coordinadora">Coordinadora</SelectItem>
                        <SelectItem value="Envia">Envia</SelectItem>
                        <SelectItem value="TCC">TCC</SelectItem>
                        <SelectItem value="DHL">DHL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[60vh]">
                    {cases.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        <Package className="size-8 mx-auto mb-2 text-muted-foreground/50" />
                        Sin casos para estos filtros.
                      </div>
                    ) : (
                      <div className="divide-y">
                        {cases.map(c => {
                          const sm = caseStatusMeta(c.status)
                          const tm = CASE_TYPE_META[c.type] || CASE_TYPE_META.otro
                          const isSelected = c.id === selectedId
                          return (
                            <button
                              key={c.id}
                              onClick={() => setSelectedId(c.id)}
                              className={cn(
                                'w-full text-left p-3 hover:bg-muted/50 transition-colors flex gap-3',
                                isSelected && 'bg-muted',
                              )}
                            >
                              {c.thumbnail ? (
                                <img src={c.thumbnail} alt="" className="size-12 rounded-lg object-cover shrink-0" />
                              ) : (
                                <div className="size-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                  <Package className="size-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center justify-between gap-2 min-w-0">
                                  <div className="font-mono text-xs text-primary truncate">{c.caseNumber}</div>
                                  <Badge variant="outline" className={cn('text-[10px] shrink-0', sm.cls)}>{sm.label}</Badge>
                                </div>
                                <div className="font-medium text-sm truncate" title={c.customerName}>{c.customerName}</div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                                  <Badge variant="outline" className={cn('text-[9px] px-1.5', tm.cls)}>{tm.label}</Badge>
                                  <span className="truncate">{c.guideNumber || '—'}</span>
                                </div>
                                <div className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</div>
                              </div>
                              <ChevronRight className={cn('size-4 self-center text-muted-foreground shrink-0 transition-transform', isSelected && 'translate-x-0.5')} />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
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
        <TabsContent value="redelivery" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={rdStatus} onValueChange={setRdStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendiente</SelectItem>
                <SelectItem value="scheduled">Programado</SelectItem>
                <SelectItem value="completed">Completado</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setRdCreateOpen(true)}>
              <Plus className="size-4" /> Nuevo reintento
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void loadRedelivery()}>
              <RefreshCw className={cn('size-4', rdLoading && 'animate-spin')} /> Actualizar
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Badge variant="outline" className="text-[10px]">Total: {rdStats.total}</Badge>
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300">Pendientes: {rdStats.pending}</Badge>
              <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-300">Programados: {rdStats.scheduled}</Badge>
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Completados: {rdStats.completed}</Badge>
            </div>
          </div>

          {rdLoading && rdRequests.length === 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
          ) : rdRequests.length === 0 ? (
            <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">
              <Truck className="size-10 mx-auto mb-2 text-muted-foreground/50" />
              No hay reintentos de entrega.
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {rdRequests.map(r => (
                <RedeliveryCard key={r.id} request={r} onAction={loadRedelivery} tenantId={tenantId!} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── History tab ───────────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="size-4" /> Historial de casos resueltos / cerrados
                  </CardTitle>
                  <CardDescription className="truncate">{historyCases.length} casos en el rango seleccionado (solo lectura).</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Calendar className="size-4 text-muted-foreground" />
                    <Input type="date" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} className="h-8 w-36 text-xs" />
                  </div>
                  <span className="text-muted-foreground text-xs">→</span>
                  <Input type="date" value={historyTo} onChange={e => setHistoryTo(e.target.value)} className="h-8 w-36 text-xs" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {historyCases.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">Sin casos resueltos en el rango.</div>
              ) : (
                <div className="overflow-x-auto scroll-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[140px]">Caso</TableHead>
                        <TableHead className="min-w-[160px]">Cliente</TableHead>
                        <TableHead className="min-w-[120px]">Tipo</TableHead>
                        <TableHead className="min-w-[120px]">Estado</TableHead>
                        <TableHead className="min-w-[140px]">Guía</TableHead>
                        <TableHead className="min-w-[140px]">Resuelto</TableHead>
                        <TableHead className="min-w-[200px]">Resolución</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyCases.map(c => {
                        const sm = caseStatusMeta(c.status)
                        const tm = CASE_TYPE_META[c.type] || CASE_TYPE_META.otro
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="font-mono text-xs whitespace-nowrap">{c.caseNumber}</TableCell>
                            <TableCell className="min-w-0">
                              <div className="text-sm truncate" title={c.customerName}>{c.customerName}</div>
                              <div className="text-[10px] text-muted-foreground truncate">{c.phone}</div>
                            </TableCell>
                            <TableCell><Badge variant="outline" className={cn('text-[9px]', tm.cls)}>{tm.label}</Badge></TableCell>
                            <TableCell><Badge variant="outline" className={cn('text-[10px]', sm.cls)}>{sm.label}</Badge></TableCell>
                            <TableCell className="font-mono text-xs truncate">{c.guideNumber || '—'}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {c.resolvedAt ? shortDate(c.resolvedAt) : shortDate(c.updatedAt)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                              <div className="truncate" title={c.resolution || ''}>{c.resolution || '—'}</div>
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
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CaseDetailPanel — right-side detail
// ───────────────────────────────────────────────────────────────────────────

function CaseDetailPanel({
  detail, loading, selectedId, onReload, onListReload,
}: {
  detail: CaseDetail | null
  loading: boolean
  selectedId: string | null
  onReload: () => void
  onListReload: () => void
}) {
  const [assignTo, setAssignTo] = useState('')
  const [resolution, setResolution] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  if (!selectedId) {
    return (
      <Card className="h-full min-h-[60vh]">
        <CardContent className="p-12 text-center text-sm text-muted-foreground h-full flex flex-col items-center justify-center">
          <MessageSquare className="size-10 mx-auto mb-3 text-muted-foreground/50" />
          <div>Selecciona un caso para ver el detalle</div>
        </CardContent>
      </Card>
    )
  }

  if (loading || !detail) {
    return (
      <Card className="h-full min-h-[60vh]">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    )
  }

  const c = detail.case
  const sm = caseStatusMeta(c.status)
  const tm = CASE_TYPE_META[c.type] || CASE_TYPE_META.otro

  const patch = async (body: any, successMsg: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/novedades?tenantId=${c.tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      toast.success(successMsg)
      onReload()
      onListReload()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  const doAssign = () => {
    if (!assignTo.trim()) { toast.error('Ingresa el nombre del responsable'); return }
    void patch({ action: 'assign', caseId: c.id, assignedTo: assignTo.trim() }, `Asignado a ${assignTo.trim()}`)
    setAssignTo('')
  }
  const doResolve = () => {
    if (!resolution.trim()) { toast.error('Ingresa la resolución'); return }
    void patch({ action: 'resolve', caseId: c.id, resolution: resolution.trim() }, 'Caso resuelto')
    setResolution('')
  }
  const doEscalate = () => void patch({ action: 'escalate', caseId: c.id }, 'Caso escalado')
  const doClose = () => void patch({ action: 'close', caseId: c.id }, 'Caso cerrado')
  const doMessage = async () => {
    if (!newMessage.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/novedades?tenantId=${c.tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_message', caseId: c.id, body: newMessage.trim(), authorRole: 'agent' }),
      })
      if (!res.ok) throw new Error('Failed')
      setNewMessage('')
      onReload()
    } catch {
      toast.error('Error al enviar mensaje')
    } finally {
      setBusy(false)
    }
  }
  const doAddEvidence = async () => {
    if (!evidenceUrl.trim()) { toast.error('Ingresa la URL'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/novedades?tenantId=${c.tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_evidence', caseId: c.id, url: evidenceUrl.trim(), type: 'image' }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Evidencia agregada')
      setEvidenceUrl('')
      setEvidenceOpen(false)
      onReload()
    } catch {
      toast.error('Error al agregar evidencia')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base font-mono">{c.caseNumber}</CardTitle>
              <Badge variant="outline" className={cn('text-[10px]', sm.cls)}>{sm.label}</Badge>
              <Badge variant="outline" className={cn('text-[9px]', tm.cls)}>{tm.label}</Badge>
              {c.priority === 'high' && (
                <Badge variant="outline" className="text-[9px] bg-rose-500/10 text-rose-700 dark:text-rose-300">Alta prioridad</Badge>
              )}
            </div>
            <CardDescription className="truncate mt-1">Creado {timeAgo(c.createdAt)} · actualizado {timeAgo(c.updatedAt)}</CardDescription>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <User className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate" title={c.customerName}>{c.customerName}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Phone className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate font-mono">{c.phone}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Truck className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{c.carrierName || '—'}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Package className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate font-mono">{c.guideNumber || '—'}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 max-h-[70vh] overflow-y-auto scroll-thin">
        {/* Description */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Descripción</div>
          <p className="text-sm break-words whitespace-pre-wrap">{c.description}</p>
        </div>

        {/* Resolution (if any) */}
        {c.resolution && (
          <Alert className="border-emerald-500/30 bg-emerald-500/5">
            <CheckCircle2 className="size-4 text-emerald-600" />
            <AlertTitle className="text-emerald-700 dark:text-emerald-300">Resolución</AlertTitle>
            <AlertDescription className="text-muted-foreground break-words">{c.resolution}</AlertDescription>
          </Alert>
        )}

        {/* Evidence */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Evidencia ({detail.evidence.length})</div>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEvidenceOpen(true)}>
              <Plus className="size-3" /> Agregar
            </Button>
          </div>
          {detail.evidence.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">Sin evidencia.</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {detail.evidence.map(ev => {
                const em = evidenceTypeMeta(ev.type)
                const Icon = em.icon
                return (
                  <a
                    key={ev.id}
                    href={ev.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative aspect-square rounded-lg border overflow-hidden bg-muted hover:ring-2 ring-primary/40"
                  >
                    {ev.type === 'image' ? (
                      <img src={ev.url} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="size-full flex flex-col items-center justify-center gap-1 p-2">
                        <Icon className="size-8 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground truncate">{em.label}</span>
                      </div>
                    )}
                  </a>
                )
              })}
            </div>
          )}
        </div>

        {/* Messages */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Mensajes ({detail.messages.length})</div>
          <div className="space-y-2 max-h-64 overflow-y-auto scroll-thin pr-1">
            {detail.messages.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">Sin mensajes.</div>
            ) : (
              detail.messages.map(m => {
                const rm = messageRoleMeta(m.authorRole)
                return (
                  <div key={m.id} className={cn('flex flex-col gap-1', m.authorRole === 'agent' && 'items-end')}>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className={cn('text-[9px] px-1.5', rm.cls)}>{rm.label}</Badge>
                      <span className="font-medium">{m.authorName}</span>
                      <span>· {timeAgo(m.createdAt)}</span>
                    </div>
                    <div className={cn(
                      'rounded-lg px-3 py-2 text-sm max-w-[85%] break-words',
                      m.authorRole === 'agent' ? 'bg-primary text-primary-foreground' :
                      m.authorRole === 'system' ? 'bg-muted text-muted-foreground italic' :
                      'bg-muted',
                    )}>
                      {m.body}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              placeholder="Escribe un mensaje…"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void doMessage() } }}
            />
            <Button size="sm" onClick={doMessage} disabled={busy || !newMessage.trim()}>
              <Send className="size-4" />
            </Button>
          </div>
        </div>

        <Separator />

        {/* Resolution form / actions */}
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Acciones</div>
          {!['resolved', 'closed'].includes(c.status) && (
            <>
              <div className="flex gap-2">
                <Input
                  value={assignTo}
                  onChange={e => setAssignTo(e.target.value)}
                  placeholder="Asignar a (nombre)"
                />
                <Button size="sm" variant="outline" onClick={doAssign} disabled={busy}>
                  <User className="size-4" /> Asignar
                </Button>
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  placeholder="Resolución del caso…"
                  rows={2}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={doResolve} disabled={busy || !resolution.trim()}>
                  <CheckCircle2 className="size-4" /> Resolver
                </Button>
                <Button size="sm" variant="outline" onClick={doEscalate} disabled={busy}>
                  <AlertTriangle className="size-4 text-rose-500" /> Escalar
                </Button>
                <Button size="sm" variant="ghost" onClick={doClose} disabled={busy}>
                  <XCircle className="size-4" /> Cerrar
                </Button>
              </div>
            </>
          )}
          {['resolved', 'closed'].includes(c.status) && (
            <div className="text-xs text-muted-foreground italic">
              Este caso está {c.status === 'closed' ? 'cerrado' : 'resuelto'} — sin acciones disponibles.
            </div>
          )}
        </div>
      </CardContent>

      {/* Inline evidence dialog */}
      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileImage className="size-5" /> Agregar evidencia</DialogTitle>
            <DialogDescription>Pega la URL de una imagen, documento o video.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>URL del archivo</Label>
              <Input value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvidenceOpen(false)}>Cancelar</Button>
            <Button onClick={doAddEvidence} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin mr-1" />}
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// RedeliveryCard
// ───────────────────────────────────────────────────────────────────────────

function RedeliveryCard({ request, onAction, tenantId }: {
  request: RedeliveryRequest
  onAction: () => void
  tenantId: string
}) {
  const [busy, setBusy] = useState(false)
  const [newAddr, setNewAddr] = useState(request.newAddress || '')
  const [agentNote, setAgentNote] = useState('')
  const [showAddrForm, setShowAddrForm] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)

  const sm = redeliveryStatusMeta(request.status)

  const patch = async (body: any, msg: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/redelivery?tenantId=${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, redeliveryId: request.id }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      toast.success(msg)
      onAction()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  const isTerminal = ['completed', 'cancelled'].includes(request.status)

  return (
    <Card>
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <CardTitle className="text-sm font-mono truncate">{request.guideNumber}</CardTitle>
          <Badge variant="outline" className={cn('text-[10px] shrink-0', sm.cls)}>{sm.label}</Badge>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="flex items-center gap-1"><User className="size-3" /> <span className="truncate">{request.customerName}</span></span>
          <span className="flex items-center gap-1"><Phone className="size-3" /> <span className="truncate font-mono">{request.customerPhone}</span></span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 text-xs">
          <div className="flex items-start gap-2 min-w-0">
            <MapPin className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-muted-foreground">Dirección original</div>
              <div className="break-words">{request.originalAddress}</div>
            </div>
          </div>
          {request.newAddress && (
            <div className="flex items-start gap-2 min-w-0">
              <MapPin className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-muted-foreground">Nueva dirección</div>
                <div className="break-words">{request.newAddress}</div>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2 min-w-0">
            <FileText className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-muted-foreground">Motivo</div>
              <div className="break-words">{request.reason}</div>
            </div>
          </div>
        </div>

        {/* Attempts timeline */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Intentos ({request.attempts.length})
          </div>
          <div className="space-y-1">
            {request.attempts.map(a => {
              const am = attemptStatusMeta(a.status)
              return (
                <div key={a.id} className="flex items-center gap-2 text-xs p-2 rounded-md bg-muted/50 min-w-0">
                  <Badge variant="outline" className={cn('text-[9px] px-1.5 shrink-0', am.cls)}>#{a.attemptNumber}</Badge>
                  <span className="text-muted-foreground shrink-0">{shortDate(a.attemptedAt)} {shortTime(a.attemptedAt)}</span>
                  <Badge variant="outline" className={cn('text-[9px] px-1.5 shrink-0', am.cls)}>{am.label}</Badge>
                  <span className="text-muted-foreground truncate" title={a.agentNote || a.carrierResponse || ''}>
                    {a.agentNote || a.carrierResponse || '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Action buttons */}
        {!isTerminal && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddrForm(v => !v)}>
              <MapPin className="size-3" /> Confirmar dirección
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch({ action: 'schedule' }, 'Reintento programado')}>
              <Calendar className="size-3" /> Programar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNoteForm(v => !v)}>
              <MessageSquare className="size-3" /> Asignar humano
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600" onClick={() => patch({ action: 'complete' }, 'Reintento completado')}>
              <CheckCircle2 className="size-3" /> Completar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={() => patch({ action: 'cancel' }, 'Reintento cancelado')}>
              <XCircle className="size-3" /> Cancelar
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => patch({ action: 'add_attempt' }, 'Nuevo intento agregado')}>
              <Plus className="size-3" /> Agregar intento
            </Button>
          </div>
        )}

        {showAddrForm && (
          <div className="flex gap-2">
            <Input value={newAddr} onChange={e => setNewAddr(e.target.value)} placeholder="Nueva dirección confirmada" />
            <Button
              size="sm"
              onClick={() => {
                void patch({ action: 'confirm_address', newAddress: newAddr }, 'Dirección confirmada')
                setShowAddrForm(false)
              }}
              disabled={busy || !newAddr.trim()}
            >
              Guardar
            </Button>
          </div>
        )}

        {showNoteForm && (
          <div className="flex gap-2">
            <Input value={agentNote} onChange={e => setAgentNote(e.target.value)} placeholder="Nota del agente" />
            <Button
              size="sm"
              onClick={() => {
                void patch({ action: 'assign_human', agentNote }, 'Nota guardada')
                setAgentNote(''); setShowNoteForm(false)
              }}
              disabled={busy || !agentNote.trim()}
            >
              Guardar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CreateCaseDialog
// ───────────────────────────────────────────────────────────────────────────

function CreateCaseDialog({ open, onOpenChange, tenantId, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tenantId: string | undefined
  onCreated: () => void
}) {
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [guideNumber, setGuideNumber] = useState('')
  const [carrierName, setCarrierName] = useState('Servientrega')
  const [type, setType] = useState('paquete_perdido')
  const [priority, setPriority] = useState('normal')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!tenantId) { toast.error('Sin tenant activo'); return }
    if (!customerName || !phone || !description) { toast.error('Cliente, teléfono y descripción son obligatorios'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/novedades?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName, phone, guideNumber: guideNumber || undefined,
          carrierName: carrierName || undefined, type, priority, description,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'No se pudo crear')
      }
      toast.success('Caso creado')
      onOpenChange(false)
      setCustomerName(''); setPhone(''); setGuideNumber(''); setDescription('')
      onCreated()
    } catch (e: any) {
      toast.error(e?.message || 'Error al crear caso')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-emerald-600" /> Nuevo caso de novedad</DialogTitle>
          <DialogDescription>Registra un incidente logístico o de producto.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Nombre del cliente *</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Teléfono *</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Número de guía</Label>
              <Input value={guideNumber} onChange={e => setGuideNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Transportista</Label>
              <Select value={carrierName} onValueChange={setCarrierName}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Servientrega">Servientrega</SelectItem>
                  <SelectItem value="Coordinadora">Coordinadora</SelectItem>
                  <SelectItem value="Envia">Envia</SelectItem>
                  <SelectItem value="TCC">TCC</SelectItem>
                  <SelectItem value="DHL">DHL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paquete_perdido">Paquete perdido</SelectItem>
                  <SelectItem value="producto_danado">Producto dañado</SelectItem>
                  <SelectItem value="direccion_incorrecta">Dirección incorrecta</SelectItem>
                  <SelectItem value="retraso">Retraso</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Descripción *</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin mr-1" />}
            Crear caso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CreateRedeliveryDialog
// ───────────────────────────────────────────────────────────────────────────

function CreateRedeliveryDialog({ open, onOpenChange, tenantId, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tenantId: string | undefined
  onCreated: () => void
}) {
  const [guideNumber, setGuideNumber] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [originalAddress, setOriginalAddress] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!tenantId) { toast.error('Sin tenant activo'); return }
    if (!guideNumber || !customerName || !customerPhone || !originalAddress || !reason) {
      toast.error('Completa todos los campos obligatorios')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/redelivery?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guideNumber, customerName, customerPhone, originalAddress,
          newAddress: newAddress || undefined, reason,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'No se pudo crear')
      }
      toast.success('Reintento creado')
      onOpenChange(false)
      setGuideNumber(''); setCustomerName(''); setCustomerPhone('')
      setOriginalAddress(''); setNewAddress(''); setReason('')
      onCreated()
    } catch (e: any) {
      toast.error(e?.message || 'Error al crear reintento')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-emerald-600" /> Nuevo reintento de entrega</DialogTitle>
          <DialogDescription>Programa un nuevo intento de entrega para una guía fallida.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Número de guía *</Label>
            <Input value={guideNumber} onChange={e => setGuideNumber(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Cliente *</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Teléfono *</Label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Dirección original *</Label>
            <Textarea value={originalAddress} onChange={e => setOriginalAddress(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <Label>Nueva dirección (opcional)</Label>
            <Textarea value={newAddress} onChange={e => setNewAddress(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <Label>Motivo *</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin mr-1" />}
            Crear reintento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// StatCard
// ───────────────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, accent,
}: {
  icon: typeof AlertCircle; label: string; value: string; accent: string
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3 min-w-0">
        <div className={cn('size-10 rounded-xl flex items-center justify-center ring-1 shrink-0', accent)}>
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
