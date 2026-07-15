'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  Card, CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import { toast } from 'sonner'
import {
  RefreshCw, AlertCircle, Shield, CheckCircle2, XCircle, Clock, Scale, UserCog,
} from 'lucide-react'
import { useTenantId } from '@/hooks/use-tenant'
import { t } from '@/lib/i18n'
import { timeAgo, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────────────────────────────────────────────────────
// SPRINT-FRONTEND-VIEWS-001 · §2 — Vista de Gobernanza.
//
// Documento §11 — pilares #2 (escalamiento a humano) y #4 (trazabilidad de
// decisiones del agente). El operador humano usa esta vista para:
//
//   1. Revisar sesiones de checkout UCP en `requires_escalation` y
//      aprobarlas (avanza a `ready_for_complete`) o rechazarlas (pasa a
//      `failed` + AuditLog). POST /api/governance/escalations.
//
//   2. Auditar el log de decisiones del agente (DecisionLog): agente,
//      confianza, input/output resumido, estado de revisión humana.
//      Opcionalmente marcar una decisión como revisada
//      (approved/rejected/modified). PATCH /api/governance/decisions/[id].
//
// El role gate (admin/finance/support) se hace en la API — el botón sólo
// se muestra a esos roles, pero la API rechazará con 403 si un usuario
// sin permisos intenta actuar.
// ───────────────────────────────────────────────────────────────────────────

interface Escalation {
  id: string
  sessionId: string
  tenantId: string | null
  intentMandateId: string | null
  cartMandateId: string | null
  paymentMandateId: string | null
  cart: unknown
  continuationUrl: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string | null
}

interface Decision {
  id: string
  tenantId: string
  agentName: string
  conversationId: string | null
  orderId: string | null
  mandateId: string | null
  input: unknown
  output: unknown
  reasoning: unknown
  confidence: number | null
  enforcementResult: unknown
  liabilityParty: string | null
  humanReviewed: boolean
  humanDecision: string | null
  humanReviewerId: string | null
  humanReviewedAt: string | null
  createdAt: string
}

// Roles que pueden decidir escalaciones / revisar decisiones (matches API).
const REVIEWER_ROLES = new Set(['admin', 'finance', 'support'])

export function GovernanceView() {
  const tenantId = useTenantId()
  const { data: session } = useSession()
  const userRole = session?.user?.role
  const canReview = !!userRole && REVIEWER_ROLES.has(userRole)

  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [tab, setTab] = useState<'escalations' | 'decisions'>('escalations')
  // Set de IDs en vuelo (approve/reject) — para deshabilitar el botón
  // mientras la petición está en curso.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  const load = useCallback(async (showRefreshing = false) => {
    if (!tenantId) return
    // Only call setState synchronously when refreshing; on initial mount
    // (showRefreshing=false) no setState runs synchronously in the effect,
    // satisfying `react-hooks/set-state-in-effect`.
    if (showRefreshing) setRefreshing(true)
    try {
      const [escRes, decRes] = await Promise.all([
        fetch(`/api/governance/escalations?tenantId=${tenantId}`).then(r => r.json()),
        fetch(`/api/governance/decisions?tenantId=${tenantId}`).then(r => r.json()),
      ])
      setEscalations(escRes.escalations ?? [])
      setDecisions(decRes.decisions ?? [])
      setError(null)
      setLastUpdated(new Date())
    } catch {
      setError('No se pudo cargar la información de gobernanza. Verifica tu conexión o intenta de nuevo.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    void load()
  }, [load, tenantId])

  const setPending = (id: string, value: boolean) => {
    setPendingIds(prev => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // ── Acción sobre escalación ───────────────────────────────────────────────
  const decideEscalation = async (sessionId: string, decision: 'approve' | 'reject') => {
    setPending(sessionId, true)
    try {
      const res = await fetch('/api/governance/escalations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, decision }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      // Remueve la escalación resuelta de la lista local (ya no está en
      // `requires_escalation`). El refresh traerá la lista oficial.
      setEscalations(prev => prev.filter(e => e.sessionId !== sessionId))
      toast.success(decision === 'approve'
        ? 'Escalación aprobada → ready_for_complete'
        : 'Escalación rechazada → failed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al procesar la escalación')
    } finally {
      setPending(sessionId, false)
    }
  }

  // ── Revisión humana de decisión ───────────────────────────────────────────
  const reviewDecision = async (id: string, humanDecision: 'approved' | 'rejected' | 'modified') => {
    setPending(id, true)
    try {
      const res = await fetch(`/api/governance/decisions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ humanDecision }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const j = await res.json()
      // Actualiza la decisión localmente con los campos revisados.
      setDecisions(prev => prev.map(d => d.id === id ? {
        ...d,
        humanReviewed: j.humanReviewed ?? true,
        humanDecision: j.humanDecision ?? humanDecision,
        humanReviewerId: j.humanReviewerId ?? d.humanReviewerId,
        humanReviewedAt: j.humanReviewedAt ?? new Date().toISOString(),
      } : d))
      toast.success(`Decisión marcada como "${humanDecision}"`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al revisar la decisión')
    } finally {
      setPending(id, false)
    }
  }

  if (error && escalations.length === 0 && decisions.length === 0) {
    return (
      <section aria-label="Gobernanza">
        <Alert variant="destructive" className="animate-fade-in-up" role="alert">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar gobernanza</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => load(true)} className="gap-1.5">
              <RefreshCw className="size-3.5" /> {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  if (loading) {
    return (
      <section aria-label="Gobernanza" className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-56 rounded-md" />
        <Skeleton className="h-10 w-80 rounded-md" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Gobernanza" className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="size-6 text-primary" />
            Gobernanza
          </h2>
          <p className="text-sm text-muted-foreground">
            Escalaciones pendientes + trazabilidad de decisiones del agente (§11)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {t('common.last_updated').replace('{time}', timeAgo(lastUpdated.toISOString()))}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5 h-9 px-3">
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            {refreshing ? t('common.refreshing') : t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Tabs: escalaciones + decisiones */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'escalations' | 'decisions')}>
        <TabsList>
          <TabsTrigger value="escalations" className="gap-1.5">
            <AlertCircle className="size-3.5" />
            Escalaciones pendientes
            {escalations.length > 0 && (
              <Badge variant="destructive" className="ml-1 text-[10px] h-4 px-1.5">{escalations.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="decisions" className="gap-1.5">
            <Scale className="size-3.5" />
            Decisiones recientes
            {decisions.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1.5">{decisions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Escalaciones pendientes ─────────────────────────────── */}
        <TabsContent value="escalations" className="space-y-3 mt-4">
          {escalations.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-7 text-emerald-500" />}
              title="Sin escalaciones pendientes"
              description="No hay sesiones de checkout en estado requires_escalation. Las escalaciones de age-gate, KYC o mandatos aparecerán aquí automáticamente."
            />
          ) : (
            escalations.map(esc => (
              <EscalationRow
                key={esc.id}
                escalation={esc}
                canReview={canReview}
                pending={pendingIds.has(esc.sessionId)}
                onApprove={() => decideEscalation(esc.sessionId, 'approve')}
                onReject={() => decideEscalation(esc.sessionId, 'reject')}
              />
            ))
          )}
        </TabsContent>

        {/* ── Tab 2: Decisiones recientes ────────────────────────────────── */}
        <TabsContent value="decisions" className="space-y-3 mt-4">
          {decisions.length === 0 ? (
            <EmptyState
              icon={<Scale className="size-7 text-muted-foreground" />}
              title="Sin decisiones registradas"
              description="Cuando los agentes del orquestador ejecuten (chat, checkout, objeción, etc.), cada decisión se registrará aquí con agente, confianza, input/output y estado de revisión humana."
            />
          ) : (
            decisions.map(d => (
              <DecisionRow
                key={d.id}
                decision={d}
                canReview={canReview}
                pending={pendingIds.has(d.id)}
                onReview={reviewDecision}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ───────────────────────────────────────────────────────────────────────────

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center text-center py-16 px-4">
        <div className="size-16 rounded-2xl bg-muted ring-1 ring-border flex items-center justify-center mb-4">
          {icon}
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mt-2">{description}</p>
      </CardContent>
    </Card>
  )
}

function EscalationRow({ escalation, canReview, pending, onApprove, onReject }: {
  escalation: Escalation
  canReview: boolean
  pending: boolean
  onApprove: () => void
  onReject: () => void
}) {
  // El cart puede ser un objeto complejo; extraemos un resumen legible.
  const cartSummary = summarizeCart(escalation.cart)
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground truncate">
                {escalation.sessionId}
              </span>
              <Badge variant="destructive" className="text-[10px]">
                <AlertCircle className="size-3 mr-0.5" /> requires_escalation
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="size-3" /> Creada {shortDate(escalation.createdAt)} · {timeAgo(escalation.createdAt)}
              </span>
              {escalation.expiresAt && (
                <span className="flex items-center gap-1">
                  <AlertCircle className="size-3" /> Expira {shortDate(escalation.expiresAt)}
                </span>
              )}
            </div>
          </div>
          {canReview && (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="default"
                onClick={onApprove}
                disabled={pending}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 className="size-3.5" />
                Aprobar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onReject}
                disabled={pending}
                className="gap-1.5 text-rose-600 border-rose-300 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950"
              >
                <XCircle className="size-3.5" />
                Rechazar
              </Button>
            </div>
          )}
        </div>

        {/* Detalles: mandatos + cart */}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 text-xs">
          <DetailItem label="Intent mandate" value={escalation.intentMandateId} />
          <DetailItem label="Cart mandate" value={escalation.cartMandateId} />
          <DetailItem label="Payment mandate" value={escalation.paymentMandateId} />
          <DetailItem label="Tenant" value={escalation.tenantId} />
        </div>

        {cartSummary && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Carrito</div>
            <div className="text-foreground whitespace-pre-wrap break-words">{cartSummary}</div>
          </div>
        )}

        {escalation.continuationUrl && (
          <div className="text-xs text-muted-foreground truncate">
            <span className="font-medium">Continuación:</span>{' '}
            <span className="font-mono">{escalation.continuationUrl}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DecisionRow({ decision, canReview, pending, onReview }: {
  decision: Decision
  canReview: boolean
  pending: boolean
  onReview: (id: string, humanDecision: 'approved' | 'rejected' | 'modified') => void
}) {
  const inputSummary = summarizeJson(decision.input, 200)
  const outputSummary = summarizeJson(decision.output, 200)
  const confidence = decision.confidence
  const confidencePct = confidence != null ? Math.round(confidence * 100) : null
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 space-y-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-[10px] capitalize">{decision.agentName}</Badge>
              {confidencePct != null && (
                <Badge
                  variant="secondary"
                  className={cn(
                    'text-[10px]',
                    confidencePct >= 80 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : confidencePct >= 50 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
                  )}
                >
                  Confianza {confidencePct}%
                </Badge>
              )}
              {decision.liabilityParty && (
                <Badge variant="outline" className="text-[10px] capitalize">
                  Responsable: {decision.liabilityParty}
                </Badge>
              )}
              {decision.humanReviewed ? (
                <Badge variant="secondary" className="text-[10px] bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  <UserCog className="size-3 mr-0.5" />
                  Revisada · {decision.humanDecision ?? '—'}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400 border-amber-400/50">
                  Pendiente de revisión
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="size-3" /> {shortDate(decision.createdAt)} · {timeAgo(decision.createdAt)}
              </span>
              {decision.orderId && <span>Pedido: <span className="font-mono">{decision.orderId}</span></span>}
              {decision.conversationId && <span>Conv: <span className="font-mono">{decision.conversationId}</span></span>}
              {decision.mandateId && <span>Mandato: <span className="font-mono">{decision.mandateId}</span></span>}
            </div>
          </div>

          {canReview && !decision.humanReviewed && (
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="default" disabled={pending} onClick={() => onReview(decision.id, 'approved')} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                <CheckCircle2 className="size-3.5" /> Aprobar
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onReview(decision.id, 'rejected')} className="gap-1.5 text-rose-600 border-rose-300 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950">
                <XCircle className="size-3.5" /> Rechazar
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onReview(decision.id, 'modified')} className="gap-1.5">
                Modificar
              </Button>
            </div>
          )}
        </div>

        {/* Input/Output resumen */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Input</div>
            <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-mono max-h-32 overflow-y-auto scroll-thin">{inputSummary}</pre>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Output</div>
            <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-mono max-h-32 overflow-y-auto scroll-thin">{outputSummary}</pre>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="font-mono text-xs truncate" title={value ?? undefined}>{value || '—'}</div>
    </div>
  )
}

// ── Helpers para resumir JSON/string legible ─────────────────────────────

function summarizeJson(value: unknown, maxLen = 200): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value.slice(0, maxLen) + (value.length > maxLen ? '…' : '')
  try {
    const str = JSON.stringify(value, null, 2)
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
  } catch {
    return String(value)
  }
}

function summarizeCart(cart: unknown): string {
  if (cart == null) return ''
  if (typeof cart === 'string') return cart
  if (typeof cart === 'object') {
    const c = cart as Record<string, unknown>
    const items = Array.isArray(c.items) ? c.items : Array.isArray(c.products) ? c.products : null
    if (items && Array.isArray(items)) {
      const lines = items.map((it: unknown, i: number) => {
        if (typeof it !== 'object' || it === null) return `${i + 1}. ${String(it)}`
        const o = it as Record<string, unknown>
        const name = o.name ?? o.productName ?? o.sku ?? 'item'
        const qty = o.quantity ?? o.qty ?? 1
        const price = o.price ?? o.unitPrice
        return `${i + 1}. ${name} × ${qty}${price != null ? ` — $${price}` : ''}`
      })
      const total = typeof c.total === 'number' ? c.total
        : typeof c.totalAmount === 'number' ? c.totalAmount
        : null
      const currency = typeof c.currency === 'string' ? c.currency : ''
      return lines.join('\n') + (total != null ? `\nTotal: ${currency} $${total}` : '')
    }
  }
  try {
    return JSON.stringify(cart, null, 2)
  } catch {
    return String(cart)
  }
}
