// ZIAY — Novedades list + filters (left panel of the cases tab).
// Split out from novedades-view.tsx in SPRINT3-REFACTOR-001.

'use client'

import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ChevronRight, Inbox, Package, Plus, Search } from 'lucide-react'

import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  CASE_TYPE_META, caseStatusMeta, type CaseRow,
} from './shared'

export function NovedadesList({
  cases, selectedId, setSelectedId,
  q, setQ, statusFilter, setStatusFilter,
  typeFilter, setTypeFilter, carrierFilter, setCarrierFilter,
  onCreateOpen,
}: {
  cases: CaseRow[]
  selectedId: string | null
  setSelectedId: (id: string) => void
  q: string
  setQ: (v: string) => void
  statusFilter: string
  setStatusFilter: (v: string) => void
  typeFilter: string
  setTypeFilter: (v: string) => void
  carrierFilter: string
  setCarrierFilter: (v: string) => void
  onCreateOpen: () => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Casos de novedad</CardTitle>
          <Button size="sm" onClick={onCreateOpen}>
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
            <div className="flex flex-col items-center justify-center text-center py-12 px-4">
              <div className="mb-4 rounded-full bg-muted p-3">
                <Inbox className="size-6 text-muted-foreground" aria-hidden />
              </div>
              <p className="text-sm font-medium text-foreground">Sin casos para estos filtros</p>
              <p className="mt-1 text-xs text-foreground/70 max-w-sm">
                Prueba cambiando los filtros de estado, tipo o carrier, o crea un caso nuevo manualmente.
              </p>
              <Button size="sm" onClick={onCreateOpen} className="mt-4 gap-1.5">
                <Plus className="size-4" /> Crear caso
              </Button>
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
                    aria-current={isSelected ? 'true' : undefined}
                    className={cn(
                      'w-full text-left p-3 hover:bg-muted/50 transition-colors flex gap-3',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected && 'bg-muted',
                    )}
                  >
                    {c.thumbnail ? (
                      <Image src={c.thumbnail} alt={`Miniatura del caso ${c.caseNumber}`} width={48} height={48} unoptimized className="size-12 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="size-12 rounded-lg bg-muted flex items-center justify-center shrink-0" aria-hidden>
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
  )
}
