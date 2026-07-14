// ZIAY — Novedades case detail panel (right side of the cases tab).
// Holds the case header, description, evidence, messages, and the
// assign/resolve/escalate/close actions. Split out from
// novedades-view.tsx in SPRINT3-REFACTOR-001 — no UI changes.

'use client'

import { useState } from 'react'
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
  AlertTriangle, CheckCircle2, FileImage, Loader2, MessageSquare, Package, Phone,
  Plus, Send, Truck, User, XCircle,
} from 'lucide-react'

import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  CASE_TYPE_META, caseStatusMeta, evidenceTypeMeta, messageRoleMeta,
  type CaseDetail,
} from './shared'

export function CaseDetailPanel({
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

  const patch = async (body: Record<string, unknown>, successMsg: string) => {
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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
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
                    aria-label={`Abrir evidencia del caso ${c.caseNumber}`}
                    className="group relative aspect-square rounded-lg border overflow-hidden bg-muted hover:ring-2 ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {ev.type === 'image' ? (
                      <img src={ev.url} alt={`Evidencia del caso ${c.caseNumber}`} className="size-full object-cover" />
                    ) : (
                      <div className="size-full flex flex-col items-center justify-center gap-1 p-2">
                        <Icon className="size-8 text-muted-foreground" aria-hidden />
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
            <Button size="sm" onClick={doMessage} disabled={busy || !newMessage.trim()} aria-label="Enviar mensaje">
              <Send className="size-4" aria-hidden />
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
              <Label htmlFor="nd-evidence-url">URL del archivo</Label>
              <Input id="nd-evidence-url" value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)} placeholder="https://…" />
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
