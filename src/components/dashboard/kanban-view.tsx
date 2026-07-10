'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { useTenantId } from '@/hooks/use-tenant'
import { toast } from 'sonner'
import {
  KANBAN_STAGES, KANBAN_ACCENT, KanbanStageId,
} from '@/lib/orchestrator/constants'
import {
  RefreshCw, GripVertical, CreditCard, Truck, MapPin, AlertTriangle, Sparkles,
} from 'lucide-react'

type Order = {
  id: string; number: string; status: string; paymentMode: string; paymentStatus: string
  total: number; currency: string; country?: string | null; city?: string | null
  customer: { id: string; name: string; phone?: string; country?: string }
  items: { name: string; quantity: number; unitPrice: number }[]
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

function KanbanCard({ order, isDragging }: { order: Order; isDragging?: boolean }) {
  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0)
  const isAdvance = order.paymentMode === 'advance'
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-2.5 shadow-sm transition-all',
        isDragging ? 'opacity-40 ring-2 ring-primary/40 shadow-md scale-[0.98]' : 'hover:shadow-md hover:border-primary/30'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] font-semibold text-primary truncate">{order.number}</div>
          <div className="text-sm font-medium leading-tight mt-0.5 truncate" title={order.customer.name}>
            {order.customer.name}
          </div>
        </div>
        <GripVertical className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
      </div>
      <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
        <MapPin className="size-3 shrink-0" />
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

function DroppableColumn({ stage, orders }: { stage: typeof KANBAN_STAGES[number]; orders: Order[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const accent = KANBAN_ACCENT[stage.accent]
  return (
    <div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
      <div className={cn('rounded-t-lg border-b bg-muted/40 px-3 py-2.5', isOver && 'bg-primary/5')}>
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{stage.emoji}</span>
          <h3 className={cn('text-sm font-semibold leading-tight flex-1 min-w-0', accent.header)}>{stage.label}</h3>
          <Badge variant="outline" className={cn('text-[10px] h-5 tabular-nums', accent.chip)}>{orders.length}</Badge>
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full" aria-hidden />
          <span className="tabular-nums">Histórico §15.1: {stage.historicalPct}%</span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 rounded-b-lg border-x border-b bg-muted/20 p-2 space-y-2 min-h-[120px] transition-colors overflow-y-auto',
          isOver && 'bg-primary/5 border-primary/30'
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
  const [activeId, setActiveId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  const loadOrders = useCallback(async () => {
    if (!tenantId) return
    setRefreshing(true)
    try {
      const res = await fetch(`/api/orders?tenantId=${tenantId}`)
      const data = await res.json()
      setOrders(data.orders || [])
    } catch { /* ignore */ } finally {
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
            Refrescar
          </Button>
        </div>
      </div>

      {/* Board */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
            <div className="flex gap-3 overflow-x-auto scroll-thin p-3 bg-muted/10" style={{ minHeight: 'calc(100vh - 16rem)' }}>
              {KANBAN_STAGES.map(stage => (
                <DroppableColumn key={stage.id} stage={stage} orders={grouped[stage.id]} />
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
