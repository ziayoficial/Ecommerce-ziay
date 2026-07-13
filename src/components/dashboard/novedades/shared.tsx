// ZIAY — Shared types, helpers, and small presentational primitives
// for the novedades dashboard view. Split out from novedades-view.tsx in
// SPRINT3-REFACTOR-001 — no behavior changes, just file layout.

import {
  AlertCircle, FileImage, FileText, Image as ImageIcon, Video,
} from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type CaseRow = {
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

export type Evidence = {
  id: string; url: string; type: string; uploadedBy: string | null; createdAt: string
}

export type Message = {
  id: string; authorName: string; authorRole: string; body: string; createdAt: string
}

export type CaseDetail = {
  case: Omit<CaseRow, 'evidenceCount' | 'messageCount' | 'thumbnail'> & {
    tenantId: string
  }
  evidence: Evidence[]
  messages: Message[]
}

export type RedeliveryAttempt = {
  id: string
  attemptNumber: number
  status: string
  carrierResponse: string | null
  agentNote: string | null
  attemptedAt: string
}

export type RedeliveryRequest = {
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

export const CASE_TYPE_META: Record<string, { label: string; cls: string }> = {
  paquete_perdido: { label: 'Paquete perdido', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  producto_danado: { label: 'Producto dañado', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  direccion_incorrecta: { label: 'Dirección incorrecta', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  retraso: { label: 'Retraso', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  otro: { label: 'Otro', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' },
}

export function caseStatusMeta(s: string) {
  switch (s) {
    case 'open': return { label: 'Abierto', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20' }
    case 'assigned': return { label: 'Asignado', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'resolved': return { label: 'Resuelto', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' }
    case 'escalated': return { label: 'Escalado', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20' }
    case 'closed': return { label: 'Cerrado', cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

export function redeliveryStatusMeta(s: string) {
  switch (s) {
    case 'pending': return { label: 'Pendiente', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20' }
    case 'scheduled': return { label: 'Programado', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20' }
    case 'completed': return { label: 'Completado', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' }
    case 'cancelled': return { label: 'Cancelado', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

export function attemptStatusMeta(s: string) {
  switch (s) {
    case 'success': return { label: 'Éxito', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }
    case 'failed': return { label: 'Fallido', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' }
    case 'pending': return { label: 'Pendiente', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
  }
}

export function evidenceTypeMeta(t: string) {
  switch (t) {
    case 'image': return { label: 'Imagen', icon: ImageIcon }
    case 'document': return { label: 'Documento', icon: FileText }
    case 'video': return { label: 'Video', icon: Video }
    default: return { label: t, icon: FileImage }
  }
}

export function messageRoleMeta(r: string) {
  switch (r) {
    case 'agent': return { cls: 'bg-primary/10 text-primary', label: 'Agente' }
    case 'carrier': return { cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', label: 'Transportista' }
    case 'customer': return { cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', label: 'Cliente' }
    case 'system': return { cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300', label: 'Sistema' }
    default: return { cls: 'bg-muted text-muted-foreground', label: r }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// StatCard
// ───────────────────────────────────────────────────────────────────────────

export function StatCard({
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
