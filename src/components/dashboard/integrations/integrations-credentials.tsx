// ZIAY — Integrations credential panel (CredentialPanel + CredentialCard).
// Split out from integrations-view.tsx in SPRINT8-VIEWS-SPLIT-001.
//
// CredentialPanel is self-contained: it manages its own creds/drafts/
// visible/busy state and takes no props. CredentialCard is a private
// child component (not exported).

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  Key, Database, Loader2, Eye, EyeOff, Save, Trash2,
  CheckCircle2, AlertCircle, ChevronDown,
} from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'

import { cn } from '@/lib/utils'

import {
  type CredentialState, type CredentialsResponse,
  type IntegrationConfig,
  INTEGRATION_REGISTRY, CATEGORY_META, CATEGORY_ORDER, getIntegrationsByCategory,
} from './integrations-shared'

// ───────────────────────────────────────────────────────────────────────────
// CredentialPanel — full credential management UI.
//
// Loads the masked state from /api/integrations/credentials on mount, groups
// the integrations by category, and renders one expandable card per
// integration. Each card has show/hide password toggles, a Guardar button
// (POST) and an Eliminar button (DELETE).
//
// Local draft state: `drafts[integrationId][fieldKey] = string`. When the
// user expands a card, the draft is seeded from the masked server value
// (i.e. `••••abcd`); when the user starts typing, the draft is replaced.
// On save we send the whole draft — fields still showing the mask are sent
// as the mask literal, but the API merges with existing values, so any
// unchanged masked field is overwritten with the mask string. To avoid
// this footgun, we skip sending fields whose draft value still equals the
// masked server value.
// ───────────────────────────────────────────────────────────────────────────

export function CredentialPanel() {
  const [creds, setCreds] = useState<Record<string, CredentialState>>({})
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Per-integration draft fields (raw user input).
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  // Per-field password visibility toggle. Keyed by `${integrationId}.${fieldKey}`.
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  // Per-integration in-flight save/delete state (for button spinners).
  const [busy, setBusy] = useState<Record<string, 'save' | 'delete' | undefined>>({})

  const loadCredentials = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrations/credentials')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as CredentialsResponse
      setCreds(data.integrations || {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      toast.error('No se pudieron cargar las credenciales', { description: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCredentials()
  }, [loadCredentials])

  const grouped = getIntegrationsByCategory()

  const toggleExpand = (integrationId: string) => {
    setExpandedId((prev) => (prev === integrationId ? null : integrationId))
    // Seed the draft from the masked server value when first expanding.
    setDrafts((prev) => {
      if (prev[integrationId]) return prev
      const server = creds[integrationId]?.fields || {}
      return { ...prev, [integrationId]: { ...server } }
    })
  }

  const updateDraft = (integrationId: string, fieldKey: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [integrationId]: {
        ...(prev[integrationId] || {}),
        [fieldKey]: value,
      },
    }))
  }

  const toggleVisible = (integrationId: string, fieldKey: string) => {
    const k = `${integrationId}.${fieldKey}`
    setVisible((prev) => ({ ...prev, [k]: !prev[k] }))
  }

  // Strip fields whose draft still equals the masked server value so we
  // don't overwrite the stored secret with the mask literal.
  const buildSavePayload = (integration: IntegrationConfig): Record<string, string> => {
    const draft = drafts[integration.id] || {}
    const server = creds[integration.id]?.fields || {}
    const payload: Record<string, string> = {}
    for (const field of integration.fields) {
      const v = draft[field.key] ?? ''
      if (v && v === server[field.key]) continue // unchanged mask
      payload[field.key] = v
    }
    return payload
  }

  const handleSave = async (integration: IntegrationConfig) => {
    const payload = buildSavePayload(integration)
    setBusy((b) => ({ ...b, [integration.id]: 'save' }))
    try {
      const res = await fetch('/api/integrations/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration: integration.id, fields: payload }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as CredentialState & { integration: string }
      setCreds((prev) => ({
        ...prev,
        [integration.id]: { configured: data.configured, fields: data.fields },
      }))
      // Re-seed the draft from the freshly masked server state so the
      // inputs show the updated mask right away.
      setDrafts((prev) => ({
        ...prev,
        [integration.id]: { ...data.fields },
      }))
      toast.success(`${integration.name}: credenciales guardadas`, {
        description: data.configured ? 'Integración lista para usar' : 'Faltan campos requeridos',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      toast.error(`No se pudieron guardar las credenciales de ${integration.name}`, { description: msg })
    } finally {
      setBusy((b) => ({ ...b, [integration.id]: undefined }))
    }
  }

  const handleDelete = async (integration: IntegrationConfig) => {
    setBusy((b) => ({ ...b, [integration.id]: 'delete' }))
    try {
      const res = await fetch('/api/integrations/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration: integration.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      setCreds((prev) => {
        const next = { ...prev }
        delete next[integration.id]
        return next
      })
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[integration.id]
        return next
      })
      setExpandedId((prev) => (prev === integration.id ? null : prev))
      toast.success(`${integration.name}: credenciales eliminadas`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      toast.error(`No se pudieron eliminar las credenciales de ${integration.name}`, { description: msg })
    } finally {
      setBusy((b) => ({ ...b, [integration.id]: undefined }))
    }
  }

  const totalConfigured = Object.values(creds).filter((c) => c.configured).length
  const totalIntegrations = INTEGRATION_REGISTRY.length

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="size-4 text-primary" /> Configuración de Credenciales
            </CardTitle>
            <CardDescription>
              {totalConfigured} de {totalIntegrations} integraciones configuradas · las credenciales se guardan cifradas y nunca se muestran completas
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadCredentials()} disabled={loading} className="gap-1.5 self-start">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
            Recargar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat]
            const integrations = grouped[cat]
            if (integrations.length === 0) return null
            const configuredInCat = integrations.filter((i) => creds[i.id]?.configured).length
            return (
              <section key={cat} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{meta.emoji}</span>
                  <h3 className="text-sm font-semibold">{meta.label}</h3>
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                    {configuredInCat}/{integrations.length}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground truncate">· {meta.description}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {integrations.map((integration) => (
                    <CredentialCard
                      key={integration.id}
                      integration={integration}
                      state={creds[integration.id]}
                      expanded={expandedId === integration.id}
                      draft={drafts[integration.id] || {}}
                      visible={visible}
                      busy={busy[integration.id]}
                      onToggleExpand={() => toggleExpand(integration.id)}
                      onUpdateDraft={(fieldKey, value) => updateDraft(integration.id, fieldKey, value)}
                      onToggleVisible={(fieldKey) => toggleVisible(integration.id, fieldKey)}
                      onSave={() => void handleSave(integration)}
                      onDelete={() => void handleDelete(integration)}
                    />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CredentialCard — single integration card.
// ───────────────────────────────────────────────────────────────────────────

type CredentialCardProps = {
  integration: IntegrationConfig
  state: CredentialState | undefined
  expanded: boolean
  draft: Record<string, string>
  visible: Record<string, boolean>
  busy: 'save' | 'delete' | undefined
  onToggleExpand: () => void
  onUpdateDraft: (fieldKey: string, value: string) => void
  onToggleVisible: (fieldKey: string) => void
  onSave: () => void
  onDelete: () => void
}

function CredentialCard({
  integration,
  state,
  expanded,
  draft,
  visible,
  busy,
  onToggleExpand,
  onUpdateDraft,
  onToggleVisible,
  onSave,
  onDelete,
}: CredentialCardProps) {
  const configured = state?.configured ?? false
  const serverFields = state?.fields ?? {}
  const requiredKeys = integration.fields.filter((f) => f.required).map((f) => f.key)
  const missingRequired = requiredKeys.filter((k) => !serverFields[k])

  return (
    <Collapsible
      open={expanded}
      onOpenChange={() => onToggleExpand()}
      className={cn(
        'rounded-xl border transition-all',
        configured ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card',
      )}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full text-left p-3 flex items-start gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          aria-expanded={expanded}
          aria-controls={`cred-content-${integration.id}`}
        >
          <span className="text-xl leading-none mt-0.5">{integration.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm truncate">{integration.name}</span>
              {configured ? (
                <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shrink-0">
                  <CheckCircle2 className="size-2.5" /> Configurado
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 shrink-0">
                  <AlertCircle className="size-2.5" /> Pendiente
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{integration.description}</div>
          </div>
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent id={`cred-content-${integration.id}`} className="px-3 pb-3 pt-0 space-y-3">
        <Separator />

        {/* Status hint */}
        {configured ? (
          <div className="flex items-start gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
            <span>Integración configurada. Los campos se muestran enmascarados por seguridad.</span>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span>
              {missingRequired.length > 0
                ? `Faltan ${missingRequired.length} campo(s) requerido(s): ${missingRequired.join(', ')}`
                : 'Ingresa las credenciales para activar esta integración.'}
            </span>
          </div>
        )}

        {/* Fields */}
        <div className="space-y-2.5">
          {integration.fields.map((field) => {
            const isPassword = field.type === 'password'
            const isVisible = visible[`${integration.id}.${field.key}`] ?? false
            const draftValue = draft[field.key] ?? ''
            const serverValue = serverFields[field.key] ?? ''
            // Show placeholder mask in the input if no draft has been entered.
            const displayValue = draftValue || (serverValue ? serverValue : '')
            const inputId = `cred-${integration.id}-${field.key}`
            return (
              <div key={field.key} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={inputId} className="text-xs font-medium">
                    {field.label}
                    {field.required && <span className="text-rose-500 ml-0.5">*</span>}
                  </Label>
                  {field.helpText && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[10px] text-muted-foreground cursor-help">ⓘ</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-56">{field.helpText}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id={inputId}
                    type={isPassword && !isVisible ? 'password' : 'text'}
                    value={displayValue}
                    onChange={(e) => onUpdateDraft(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                      'h-9 text-xs',
                      isPassword && 'pr-9',
                    )}
                    aria-label={`${field.label} para ${integration.name}`}
                  />
                  {isPassword && (
                    <button
                      type="button"
                      onClick={() => onToggleVisible(field.key)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      aria-label={isVisible ? 'Ocultar valor' : 'Mostrar valor'}
                      tabIndex={-1}
                    >
                      {isVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  )}
                </div>
                {field.helpText && (
                  <p className="text-[10px] text-muted-foreground">{field.helpText}</p>
                )}
              </div>
            )
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={onSave} disabled={busy === 'save'} className="gap-1.5 flex-1">
            {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Guardar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDelete}
            disabled={busy === 'delete' || (!configured && !state)}
            className="gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
            aria-label={`Eliminar credenciales de ${integration.name}`}
          >
            {busy === 'delete' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Eliminar
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
