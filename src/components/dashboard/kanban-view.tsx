'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { useTenantId } from '@/hooks/use-tenant'
import { t } from '@/lib/i18n'
import { toast } from 'sonner'
import {
  KANBAN_STAGES, KANBAN_ACCENT, KanbanStageId,
} from '@/lib/orchestrator/constants'
import {
  RefreshCw, GripVertical, CreditCard, Truck, MapPin, AlertTriangle, Sparkles,
  ChevronLeft, Clock, AlertCircle, Inbox,
} from 'lucide-react'

// WIP limit per stage. If a column exceeds this many cards we surface a
// warning chip in its header (configurable per stage id).
const WIP_LIMITS: Partial<Record<KanbanStageId, number>> = {
  pending_confirmation: 25,
  intent_cancelacion: 8,
  datos_completados: 15,
  seguimiento: 12,
  oficina: 12,
  programado: 15,
  despachado: 30,
  pendiente_guia: 10,
}

// A card is "stuck" if it has been in its current stage for at least this
// many days (we approximate using the order's createdAt when the stage was
// last touched isn't available — see note inside KanbanCard).
const STUCK_DAYS = 3

type Order = {
  id: string; number: string; status: string; paymentMode: string; paymentStatus: string
  total: number; currency: string; country?: string | null; city?: string | null
  customer: { id: string; name: string; phone?: string; country?: string }
  items: { name: string; quantity: number; unitPrice: number }[]
  createdAt?: string
}

// Map any incoming order status (from §15.1 funnel or legacy statuses) →
// one of our 8 KanbanStageId values. Anything we don't recognize goes into
// "pending_confirmation" (the funnel entry).
function normalizeStage(rawStatus: string): KanbanStageId {
  const s = (rawStatus || '').toLowerCase()
  const map: Record<string, KanbanStageId> = {
    pending_confirmation: 'pending_confirmation',
    pendiente_confirmacion: 'pending_confirmation',
    'pendiente confirmación': 'pending_confirmation',
    new: 'pending_confirmation',
    intent_cancelacion: 'intent_cancelacion',
    intento_cancelacion: 'intent_cancelacion',
    'intento de cancelación': 'intent_cancelacion',
    cancelled: 'intent_cancelacion',
    datos_completados: 'datos_completados',
    'datos completados': 'datos_completados',
    paid: 'datos_completados',
    seguimiento: 'seguimiento',
    oficina: 'oficina',
    preparing: 'oficina',
    programado: 'programado',
    scheduled: 'programado',
    despachado: 'despachado',
    shipped: 'despachado',
    pendiente_guia: 'pendiente_guia',
    'pendiente guía': 'pendiente_guia',
    pending_payment: 'pendiente_guia',
    delivered: 'despachado',
    returned: 'intent_cancelacion',
  }
  return map[s] || 'pending_confirmation'
}

// Heuristic: if the order's createdAt is older than STUCK_DAYS and the
// status hasn't been touched, flag it as stuck. Real per-stage timestamps
// would come from the order event log (§10) but createdAt is a safe proxy.
function isStuck(createdAt: string | undefined): boolean {
  if (!createdAt) return false
  const ms = Date.now() - new Date(createdAt).getTime()
  return ms > STUCK_DAYS * 24 * 60 * 60 * 1000
}

function KanbanCard({ order, isDragging }: { order: Order; isDragging?: boolean }) {
  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0)
  const isAdvance = order.paymentMode === 'advance'
  const stuck = isStuck(order.createdAt)
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-2.5 transition-all',
        isDragging
          ? 'opacity-40 ring-2 ring-primary/50 shadow-xl scale-[0.97]'
          : 'shadow-sm hover:shadow-lg hover:border-primary/40 hover:-translate-y-0.5'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] font-semibold text-primary truncate">{order.number}</span>
            {stuck && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center justify-center size-4 rounded-full bg-amber-500/15 text-amber-600" aria-label="Pedido estancado">
                      <Clock className="size-2.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs max-w-56">Pedido estancado: lleva más de {STUCK_DAYS} días sin moverse de etapa. Considera escalarlo.</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <div className="text-sm font-medium leading-tight mt-0.5 truncate" title={order.customer.name}>
            {order.customer.name}
          </div>
        </div>
        <GripVertical className="size-3.5 text-muted-foreground shrink-0 mt-0.5 cursor-grab active:cursor-grabbing" aria-hidden />
      </div>
      <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
        <MapPin className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{order.city || '—'}{order.country ? `, ${order.country}` : ''}</span>
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs font-semibold tabular-nums">{formatCurrency(order.total, order.currency, { compact: true })}</span>
        <Badge
          variant="outline"
          className={cn(
            'text-[9px] h-4 px-1 gap-0.5',
            isAdvance ? 'border-primary/30 bg-primary/5 text-primary' : 'border-amber-500/30 bg-amber-500/5 text-amber-600'
          )}
        >
          {isAdvance ? <CreditCard className="size-2.5" /> : <Truck className="size-2.5" />}
          {isAdvance ? 'Antic.' : 'COD'}
        </Badge>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground truncate" title={order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}>
        {itemCount} und · {order.items.map(i => i.name).join(', ') || '—'}
      </div>
      {order.paymentStatus === 'paid' && (
        <div className="mt-1 text-[9px] text-emerald-600 font-medium">● Cobrado</div>
      )}
      {order.paymentStatus === 'cod_pending' && (
        <div className="mt-1 text-[9px] text-amber-600 font-medium">● Cobro pendiente</div>
      )}
    </div>
  )
}

function DraggableCard({ order }: { order: Order }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: order.id })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="touch-none">
      <KanbanCard order={order} isDragging={isDragging} />
    </div>
  )
}

function DroppableColumn({ stage, orders, collapsed, onToggleCollapse }: { stage: typeof KANBAN_STAGES[number]; orders: Order[]; collapsed: boolean; onToggleCollapse: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const accent = KANBAN_ACCENT[stage.accent]
  const wipLimit = WIP_LIMITS[stage.id]
  const overWip = wipLimit != null && orders.length > wipLimit
  const stuckCount = orders.filter(o => isStuck(o.createdAt)).length

  // Collapsed view: just the header + count, no list.
  if (collapsed) {
    return (
      <div className="flex flex-col min-w-[52px] w-[52px] shrink-0">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={`Expandir columna ${stage.label}`}
          aria-expanded={false}
          className={cn('rounded-lg border bg-muted/40 px-2 py-3 text-center hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
        >
          <div className="text-base leading-none rotate-180 [writing-mode:vertical-rl]" aria-hidden>{stage.emoji}</div>
          <div className={cn('text-[10px] font-semibold mt-2 [writing-mode:vertical-rl] rotate-180', accent.header)}>{stage.label}</div>
          <div className="text-[10px] text-muted-foreground mt-2 tabular-nums">{orders.length}</div>
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
      <div className={cn('rounded-t-lg border-b bg-muted/40 px-3 py-2.5', isOver && 'bg-primary/5')}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={`Contraer columna ${stage.label}`}
            aria-expanded={true}
            className="size-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="text-base leading-none" aria-hidden>{stage.emoji}</span>
          <h3 className={cn('text-sm font-semibold leading-tight flex-1 min-w-0', accent.header)}>{stage.label}</h3>
          <Badge variant="outline" className={cn('text-[10px] h-5 tabular-nums', accent.chip)}>{orders.length}</Badge>
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground flex-wrap">
          <span className="tabular-nums">§15.1: {stage.historicalPct}%</span>
          {wipLimit != null && (
            <span className={cn('tabular-nums', overWip ? 'text-rose-600 font-semibold' : '')}>
              · WIP {orders.length}/{wipLimit}
            </span>
          )}
          {stuckCount > 0 && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 text-amber-600 font-medium" aria-label={`${stuckCount} pedidos estancados`}>
                    · <Clock className="size-2.5" /> {stuckCount}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs max-w-56">{stuckCount} pedidos llevan más de {STUCK_DAYS} días en esta etapa sin moverse.</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {overWip && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 text-rose-600 font-semibold" aria-label={`WIP excedido: ${orders.length} de ${wipLimit}`}>
                    · <AlertTriangle className="size-2.5" /> sobre WIP
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs max-w-56">Esta columna excede su límite WIP de {wipLimit}. Procesa pedidos antes de añadir más.</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 rounded-b-lg border-x border-b bg-muted/20 p-2 space-y-2 min-h-[120px] transition-all overflow-y-auto',
          isOver && 'bg-primary/5 border-primary/30 ring-2 ring-primary/20'
        )}
        style={{ maxHeight: 'calc(100vh - 16rem)' }}
      >
        {orders.length === 0 ? (
          <div className="text-[11px] text-muted-foreground/70 text-center py-6">Soltar aquí</div>
        ) : (
          orders.map(o => <DraggableCard key={o.id} order={o} />)
        )}
      </div>
    </div>
  )
}

export function KanbanView() {
  const tenantId = useTenantId()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [collapsedCols, setCollapsedCols] = useState<Partial<Record<KanbanStageId, boolean>>>({})

  function toggleCollapse(id: KanbanStageId) {
    setCollapsedCols(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  const loadOrders = useCallback(async () => {
    if (!tenantId) return
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders?tenantId=${tenantId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (err) {
      console.error('Kanban fetch failed', err)
      setError('No se pudieron cargar los pedidos del tablero.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [tenantId])

  useEffect(() => { loadOrders() }, [loadOrders])

  // Group orders by stage — uses the SAME status field on the order, normalized
  // to one of our 8 §15.1 funnel stages. Existing legacy statuses map cleanly.
  const grouped = useMemo(() => {
    const g: Record<KanbanStageId, Order[]> = {
      pending_confirmation: [], intent_cancelacion: [], datos_completados: [],
      seguimiento: [], oficina: [], programado: [], despachado: [], pendiente_guia: [],
    }
    for (const o of orders) {
      g[normalizeStage(o.status)].push(o)
    }
    return g
  }, [orders])

  const activeOrder = useMemo(
    () => orders.find(o => o.id === activeId) || null,
    [orders, activeId]
  )

  const handleDragStart = (e: DragStartEvent) => { setActiveId(String(e.active.id)) }
  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const newStage = over.id as KanbanStageId
    const orderId = String(active.id)
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    const currentStage = normalizeStage(order.status)
    if (currentStage === newStage) return // no-op

    // Optimistic update
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStage } : o))

    // Persist via PATCH /api/orders/[id]
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStage, event: `kanban_move:${newStage}` }),
      })
      if (!res.ok) throw new Error('PATCH failed')
      const stageMeta = KANBAN_STAGES.find(s => s.id === newStage)
      toast.success(`Pedido ${order.number} → ${stageMeta?.label}`, {
        description: `Etapa §15.1 actualizada (${newStage})`,
      })
    } catch {
      // Revert on failure
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: currentStage } : o))
      toast.error('No se pudo mover el pedido')
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in-up">
        <Skeleton className="h-10 w-72" />
        <div className="flex gap-3 overflow-x-auto">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64 w-[260px] shrink-0" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive" className="animate-fade-in-up">
        <AlertCircle className="size-4" />
        <AlertTitle>Error al cargar el tablero</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => loadOrders()} className="gap-1.5">
            <RefreshCw className="size-3.5" /> Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-4 gap-3 animate-fade-in-up">
        <div className="size-16 rounded-2xl bg-muted/60 ring-1 ring-border flex items-center justify-center">
          <Inbox className="size-7 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">El tablero está vacío</h2>
          <p className="text-sm text-muted-foreground max-w-md mt-1">Cuando entren pedidos desde Mensajería aparecerán aquí, agrupados por etapa del embudo §15.1. Podrás arrastrarlos entre columnas para actualizar su estado.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadOrders()} disabled={refreshing} className="gap-1.5">
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} /> {t('common.refresh')}
        </Button>
      </div>
    )
  }

  const total = orders.length
  const stuck = grouped.pending_confirmation.length
  const stuckPct = total > 0 ? Math.round((stuck / total) * 100) : 0
  const shipped = grouped.despachado.length
  const shippedPct = total > 0 ? Math.round((shipped / total) * 100) : 0

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Header strip — funnel insight from §15.1 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            Tablero operativo
            <Badge variant="outline" className="text-[10px] h-5 tabular-nums">{total} pedidos</Badge>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Embudo Saramantha §15.1 · arrastra tarjetas entre columnas · PATCH /api/orders/[id]
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stuckPct > 50 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="size-3.5" />
                    <span className="font-medium tabular-nums">{stuckPct}%</span>
                    <span>en "Llamar para confirmar"</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs max-w-56">Cuello de botella §15.1 — automatiza la confirmación por WhatsApp (audio/voz) para pedidos de score alto.</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {shippedPct > 0 && (
            <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Sparkles className="size-3.5" />
              <span className="font-medium tabular-nums">{shippedPct}%</span>
              <span>despachado</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={loadOrders} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Board */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
            <div className="flex gap-3 overflow-x-auto scroll-thin p-3 bg-muted/10" style={{ minHeight: 'calc(100vh - 16rem)' }}>
              {KANBAN_STAGES.map(stage => (
                <DroppableColumn
                  key={stage.id}
                  stage={stage}
                  orders={grouped[stage.id]}
                  collapsed={!!collapsedCols[stage.id]}
                  onToggleCollapse={() => toggleCollapse(stage.id)}
                />
              ))}
            </div>
            <DragOverlay>
              {activeOrder ? (
                <div className="rotate-2 cursor-grabbing">
                  <KanbanCard order={activeOrder} isDragging />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </CardContent>
      </Card>
    </div>
  )
}
