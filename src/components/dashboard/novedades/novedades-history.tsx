// ZIAY — Novedades history tab (read-only table of resolved/closed cases).
// Split out from novedades-view.tsx in SPRINT3-REFACTOR-001 — no UI changes.

'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Calendar, History } from 'lucide-react'

import { shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { CASE_TYPE_META, caseStatusMeta, type CaseRow } from './shared'

export function HistoryTab({
  historyCases, historyFrom, setHistoryFrom, historyTo, setHistoryTo,
}: {
  historyCases: CaseRow[]
  historyFrom: string
  setHistoryFrom: (v: string) => void
  historyTo: string
  setHistoryTo: (v: string) => void
}) {
  return (
    <div className="mt-4">
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
    </div>
  )
}
