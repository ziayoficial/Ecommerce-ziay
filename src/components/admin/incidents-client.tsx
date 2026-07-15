'use client'
// SPRINT-SSR-SHELL-001 §2 — admin incident management UI (client island).
//
// Moved here from `src/app/admin/incidents/page.tsx` so that the route
// itself can be a Server Component that runs the admin guard
// server-side (see `src/app/admin/incidents/page.tsx`). The server
// component calls `getServerSession(authOptions)`, redirects
// unauthenticated users to `/login?callbackUrl=/admin/incidents`, and
// redirects non-admins to `/` BEFORE any HTML is sent — eliminating the
// redirect flash that the previous client-side `useSession()` +`
// window.location.href = '/'` path produced.
//
// This client island therefore assumes the session is already verified
// admin-side and no longer needs to:
//   - call `useSession()` (the server component already gated on
//     `session.user.role === 'admin'`)
//   - render a "session loading" skeleton branch (the server component
//     waits for the session before rendering anything)
//   - hard-redirect non-admins (the server component already returned a
//     308 to `/` before this island could mount)
//
// It DOES still need a loading skeleton for the incidents data fetch
// (the `/api/status/incidents` GET is client-side), and that's retained
// as the `loading` state branch below.
//
// Backend contract (see `src/app/api/status/incidents/route.ts`):
//   - GET    /api/status/incidents                          → { incidents: [...] }
//   - POST   /api/status/incidents                          → body: { title, description, severity, status? }
//   - PATCH  /api/status/incidents?id=INC_ID                → body: { status, message?, endTime? }
//
// The `updates` field on each incident is a JSON-encoded array of
// `{ time, message, status }` entries — we parse it client-side to render
// the per-incident timeline. Malformed JSON degrades to an empty timeline.
//
// Auth defense-in-depth: the route handler
// (`/api/status/incidents` POST + PATCH) ALSO runs `requireRole`
// server-side, so even if the client guard is bypassed the mutations
// are still rejected.

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import {
  RefreshCw,
  AlertCircle,
  Plus,
  Clock,
  CheckCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { t } from '@/lib/i18n'

interface Incident {
  id: string
  title: string
  description: string
  severity: string
  status: string
  startTime: string
  endTime: string | null
  updates: string | null
  createdAt: string
}

interface TimelineEntry {
  time: string
  message: string
  status: string
}

const severityConfig = {
  minor: {
    label: 'Menor',
    color: 'text-blue-600',
    badge: 'bg-blue-500/10 text-blue-700',
  },
  major: {
    label: 'Mayor',
    color: 'text-amber-600',
    badge: 'bg-amber-500/10 text-amber-700',
  },
  critical: {
    label: 'Crítico',
    color: 'text-rose-600',
    badge: 'bg-rose-500/10 text-rose-700',
  },
  maintenance: {
    label: 'Mantenimiento',
    color: 'text-purple-600',
    badge: 'bg-purple-500/10 text-purple-700',
  },
} as const

const statusConfig = {
  investigating: {
    label: 'Investigando',
    icon: AlertCircle,
    color: 'text-amber-600',
  },
  identified: {
    label: 'Identificado',
    icon: AlertTriangle,
    color: 'text-orange-600',
  },
  monitoring: {
    label: 'Monitoreando',
    icon: Clock,
    color: 'text-blue-600',
  },
  resolved: {
    label: 'Resuelto',
    icon: CheckCircle,
    color: 'text-emerald-600',
  },
} as const

/**
 * Parse the JSON-encoded `updates` field on an incident into a typed
 * timeline array. Returns `[]` on missing / malformed JSON so the UI can
 * render an empty timeline without crashing.
 */
function parseTimeline(updates: string | null): TimelineEntry[] {
  if (!updates) return []
  try {
    const parsed = JSON.parse(updates)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is TimelineEntry =>
        e &&
        typeof e.time === 'string' &&
        typeof e.message === 'string' &&
        typeof e.status === 'string',
    )
  } catch {
    return []
  }
}

export function AdminIncidentsClient() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [newIncident, setNewIncident] = useState({
    title: '',
    description: '',
    severity: 'minor' as keyof typeof severityConfig,
  })

  // Per-incident "add timeline update" form state. Keyed by incident id so
  // multiple cards can have an open form simultaneously without cross-talk.
  const [timelineForms, setTimelineForms] = useState<
    Record<string, { status: string; message: string }>
  >({})
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/status/incidents')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { incidents?: Incident[] }
      setIncidents(data.incidents || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar incidentes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const createIncident = async () => {
    if (!newIncident.title.trim() || !newIncident.description.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/status/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newIncident),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setCreateOpen(false)
      setNewIncident({ title: '', description: '', severity: 'minor' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al crear incidente')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * PATCH an incident's status. The id travels as a query param
   * (`?id=INC_ID`) per the route handler contract; the body carries the
   * new `status` and an optional `message` that gets appended to the
   * timeline.
   */
  const updateStatus = async (
    id: string,
    status: string,
    message?: string,
  ) => {
    setUpdatingId(id)
    setError(null)
    try {
      const url = new URL('/api/status/incidents', window.location.origin)
      url.searchParams.set('id', id)
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, message }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setTimelineForms((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al actualizar')
    } finally {
      setUpdatingId(null)
    }
  }

  // Initial incidents fetch in flight → show skeletons. (No session
  // skeleton branch anymore — the server component already verified the
  // session + admin role before this island mounted.)
  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Gestión de Incidentes</h1>
            <p className="text-sm text-muted-foreground">
              Administra incidentes de la página de estado
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="size-4 mr-2" />
              {t('common.refresh')}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="size-4 mr-2" />
                  Nuevo incidente
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Crear incidente</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="incident-title">Título</Label>
                    <Input
                      id="incident-title"
                      value={newIncident.title}
                      onChange={(e) =>
                        setNewIncident({ ...newIncident, title: e.target.value })
                      }
                      placeholder="Ej: Caída de base de datos"
                    />
                  </div>
                  <div>
                    <Label htmlFor="incident-desc">Descripción</Label>
                    <Textarea
                      id="incident-desc"
                      value={newIncident.description}
                      onChange={(e) =>
                        setNewIncident({
                          ...newIncident,
                          description: e.target.value,
                        })
                      }
                      placeholder="Describe el incidente..."
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label>Severidad</Label>
                    <Select
                      value={newIncident.severity}
                      onValueChange={(v) =>
                        setNewIncident({
                          ...newIncident,
                          severity: v as keyof typeof severityConfig,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minor">Menor</SelectItem>
                        <SelectItem value="major">Mayor</SelectItem>
                        <SelectItem value="critical">Crítico</SelectItem>
                        <SelectItem value="maintenance">Mantenimiento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancelar</Button>
                  </DialogClose>
                  <Button
                    onClick={createIncident}
                    disabled={
                      submitting ||
                      !newIncident.title.trim() ||
                      !newIncident.description.trim()
                    }
                  >
                    {submitting && (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    )}
                    Crear
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {incidents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No hay incidentes. Todo funciona correctamente.
              </CardContent>
            </Card>
          ) : (
            incidents.map((incident) => {
              const sev =
                severityConfig[
                  incident.severity as keyof typeof severityConfig
                ] || severityConfig.minor
              const stat =
                statusConfig[
                  incident.status as keyof typeof statusConfig
                ] || statusConfig.investigating
              const StatusIcon = stat.icon
              const timeline = parseTimeline(incident.updates)
              const form = timelineForms[incident.id] || {
                status: incident.status,
                message: '',
              }
              const isUpdating = updatingId === incident.id
              return (
                <Card key={incident.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{incident.title}</h3>
                          <Badge className={sev.badge}>{sev.label}</Badge>
                          <span
                            className={`flex items-center gap-1 text-sm ${stat.color}`}
                          >
                            <StatusIcon className="size-3.5" />
                            {stat.label}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {incident.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Inicio:{' '}
                          {new Date(incident.startTime).toLocaleString('es-CO')}
                          {incident.endTime &&
                            ` · Fin: ${new Date(incident.endTime).toLocaleString('es-CO')}`}
                        </p>
                      </div>
                      {incident.status !== 'resolved' && (
                        <Select
                          value={form.status}
                          onValueChange={(v) =>
                            setTimelineForms((prev) => ({
                              ...prev,
                              [incident.id]: { ...form, status: v },
                            }))
                          }
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="Actualizar..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="investigating">
                              Investigando
                            </SelectItem>
                            <SelectItem value="identified">Identificado</SelectItem>
                            <SelectItem value="monitoring">Monitoreando</SelectItem>
                            <SelectItem value="resolved">Resuelto</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    {/* Timeline update form — only for unresolved incidents. */}
                    {incident.status !== 'resolved' && (
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <Input
                          placeholder="Mensaje de la actualización (opcional)..."
                          value={form.message}
                          onChange={(e) =>
                            setTimelineForms((prev) => ({
                              ...prev,
                              [incident.id]: { ...form, message: e.target.value },
                            }))
                          }
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          onClick={() =>
                            updateStatus(
                              incident.id,
                              form.status,
                              form.message.trim() || undefined,
                            )
                          }
                          disabled={isUpdating}
                        >
                          {isUpdating && (
                            <Loader2 className="size-4 mr-2 animate-spin" />
                          )}
                          Guardar actualización
                        </Button>
                      </div>
                    )}

                    {/* Incident history — rendered from the `updates` JSON
                        column. Hidden when empty so resolved-without-history
                        incidents stay compact. */}
                    {timeline.length > 0 && (
                      <ol className="mt-4 space-y-2 border-l-2 border-muted pl-4">
                        {timeline.map((entry, i) => {
                          const entryStat =
                            statusConfig[
                              entry.status as keyof typeof statusConfig
                            ] || statusConfig.investigating
                          const EntryIcon = entryStat.icon
                          return (
                            <li key={i} className="text-sm">
                              <div className="flex items-center gap-2">
                                <EntryIcon
                                  className={`size-3.5 ${entryStat.color}`}
                                />
                                <span className="font-medium">
                                  {entryStat.label}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(entry.time).toLocaleString('es-CO')}
                                </span>
                              </div>
                              <p className="ml-5 text-muted-foreground">
                                {entry.message}
                              </p>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
