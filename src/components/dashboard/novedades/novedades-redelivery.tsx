// ZIAY — Novedades redelivery tab. Contains the filter strip + cards grid
// + the RedeliveryCard sub-component that renders each request and its
// attempts. Split out from novedades-view.tsx in SPRINT3-REFACTOR-001 —
// no UI changes.

'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Calendar, CheckCircle2, FileText, MapPin, MessageSquare, Phone, Plus,
  RefreshCw, Truck, User, XCircle,
} from 'lucide-react'

import { shortDate, shortTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

import {
  attemptStatusMeta, redeliveryStatusMeta, type RedeliveryRequest,
} from './shared'

export function RedeliveryTab({
  rdStatus, setRdStatus, rdLoading, rdRequests, rdStats, loadRedelivery,
  onCreateOpen, tenantId,
}: {
  rdStatus: string
  setRdStatus: (v: string) => void
  rdLoading: boolean
  rdRequests: RedeliveryRequest[]
  rdStats: { total: number; pending: number; scheduled: number; completed: number; cancelled: number }
  loadRedelivery: () => void
  onCreateOpen: () => void
  tenantId: string
}) {
  return (
    <div className="mt-4 space-y-4">
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
        <Button size="sm" onClick={onCreateOpen}>
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
            <RedeliveryCard key={r.id} request={r} onAction={loadRedelivery} tenantId={tenantId} />
          ))}
        </div>
      )}
    </div>
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

  const patch = async (body: Record<string, unknown>, msg: string) => {
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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
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
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddrForm(v => !v)} aria-pressed={showAddrForm}>
              <MapPin className="size-3" /> Confirmar dirección
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch({ action: 'schedule' }, 'Reintento programado')}>
              <Calendar className="size-3" /> Programar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNoteForm(v => !v)} aria-pressed={showNoteForm}>
              <MessageSquare className="size-3" /> Asignar humano
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600" onClick={() => patch({ action: 'complete' }, 'Reintento completado')}>
              <CheckCircle2 className="size-3" /> Completar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={() => patch({ action: 'cancel' }, 'Reintento cancelado')}>
              <XCircle className="size-3" /> {t('common.cancel')}
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
              {t('common.save')}
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
              {t('common.save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
