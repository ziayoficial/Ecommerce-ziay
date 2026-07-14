'use client'
import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/hooks/use-tenant'
import { toast } from 'sonner'
import { timeAgo } from '@/lib/format'
import {
  ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS, ORCHESTRATOR_ACCENT,
  OrchestratorStepId, ScenarioId,
} from '@/lib/orchestrator/constants'
import {
  Play, ChevronRight, Loader2, RotateCcw, CheckCircle2, Sparkles, Bot, RefreshCw, AlertCircle,
} from 'lucide-react'

type TimelineEntry = {
  step: OrchestratorStepId
  index: number
  label: string
  emoji: string
  agent: string
  agentLabel: string
  reply: string
  error?: string
}

type StepReply = {
  id: OrchestratorStepId
  label: string
  emoji: string
  agent: string
  reply: string
  error?: string
}

export function OrchestratorView() {
  const tenantId = useTenantId()
  const [scenarioId, setScenarioId] = useState<ScenarioId>('mayorista_familia')
  const [running, setRunning] = useState<'full' | 'step' | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [stepReplies, setStepReplies] = useState<Partial<Record<OrchestratorStepId, StepReply>>>({})
  const [currentStep, setCurrentStep] = useState<OrchestratorStepId>('profile')
  const [completedSteps, setCompletedSteps] = useState<Set<OrchestratorStepId>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const scenario = ORCHESTRATOR_SCENARIOS.find(s => s.id === scenarioId)!

  // Reset state when scenario changes
  useEffect(() => {
    setTimeline([])
    setStepReplies({})
    setCompletedSteps(new Set())
    setCurrentStep('profile')
    setError(null)
  }, [scenarioId])

  const runFull = useCallback(async () => {
    if (!tenantId) return
    setRunning('full')
    setError(null)
    setTimeline([])
    setCompletedSteps(new Set())
    try {
      const res = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'full', scenarioId }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Error desconocido')
      setTimeline(data.timeline || [])
      setCompletedSteps(new Set((data.timeline || []).map((t: TimelineEntry) => t.step)))
      const stepMap: Partial<Record<OrchestratorStepId, StepReply>> = {}
      for (const t of (data.timeline || []) as TimelineEntry[]) {
        stepMap[t.step] = { id: t.step, label: t.label, emoji: t.emoji, agent: t.agent, reply: t.reply, error: t.error }
      }
      setStepReplies(stepMap)
      const lastStep = ORCHESTRATOR_STEPS[ORCHESTRATOR_STEPS.length - 1]
      setCurrentStep(lastStep.id)
      const errs = (data.timeline || []).filter((t: TimelineEntry) => t.error).length
      toast.success(`Pipeline completado (${data.timeline.length} agentes${errs > 0 ? `, ${errs} con fallback` : ''})`)
      setLastUpdated(new Date())
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setError(msg)
      toast.error('No se pudo ejecutar el pipeline', { description: msg })
    } finally {
      setRunning(null)
    }
  }, [tenantId, scenarioId])

  const runStep = useCallback(async () => {
    if (!tenantId) return
    setRunning('step')
    setError(null)
    try {
      const res = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'step', scenarioId, currentStep }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Error desconocido')
      const step = data.currentStep
      const reply: StepReply = {
        id: step.id, label: step.label, emoji: step.emoji, agent: step.agent,
        reply: data.reply, error: data.error,
      }
      setStepReplies(prev => ({ ...prev, [step.id]: reply }))
      setCompletedSteps(prev => new Set(prev).add(step.id))
      // Also push into timeline (for the visual log)
      setTimeline(prev => {
        const filtered = prev.filter(t => t.step !== step.id)
        return [...filtered, {
          step: step.id, index: step.index, label: step.label, emoji: step.emoji,
          agent: step.agent, agentLabel: step.agent || step.label,
          reply: data.reply, error: data.error,
        }].sort((a, b) => a.index - b.index)
      })
      if (data.nextStep) {
        setCurrentStep(data.nextStep)
        toast.success(`Agente "${step.label}" respondió`, { description: 'Avanzando al siguiente paso' })
      } else {
        toast.success('Pipeline completado', { description: 'Último paso ejecutado' })
      }
      setLastUpdated(new Date())
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setError(msg)
      toast.error('No se pudo ejecutar el paso', { description: msg })
    } finally {
      setRunning(null)
    }
  }, [tenantId, scenarioId, currentStep])

  const reset = () => {
    setTimeline([])
    setStepReplies({})
    setCompletedSteps(new Set())
    setCurrentStep('profile')
    setError(null)
  }

  if (!tenantId) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Selecciona un tenant para usar el orquestador</div>
  }

  const currentIndex = ORCHESTRATOR_STEPS.findIndex(s => s.id === currentStep)
  const progressPct = Math.round((completedSteps.size / ORCHESTRATOR_STEPS.length) * 100)

  return (
    <section aria-label="Orquestador" className="space-y-6 animate-fade-in-up">
      {/* Header: last-updated + refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] sm:text-xs text-muted-foreground truncate">
          {lastUpdated ? (
            <span>Última ejecución hace <strong className="text-foreground tabular-nums">{timeAgo(lastUpdated.toISOString())}</strong></span>
          ) : (
            <span>Sin ejecuciones en esta sesión</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={runFull} disabled={running !== null} className="gap-1.5 h-9 px-3" aria-label="Refrescar">
          <RefreshCw className={cn('size-3.5', running === 'full' && 'animate-spin')} />
          {running === 'full' ? 'Ejecutando…' : 'Refrescar'}
        </Button>
      </div>

      {/* Scenario selector + controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="size-4 text-primary" /> Orquestador de agentes
            <Badge variant="outline" className="text-[10px] h-5">9 pasos · 10 agentes · §12</Badge>
          </CardTitle>
          <CardDescription>
            Elige un escenario y ejecuta el pipeline completo o paso a paso. Cada paso invoca un agente del catálogo §6.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="orchestrator-scenario" className="text-xs font-medium text-muted-foreground">Escenario</Label>
              <Select value={scenarioId} onValueChange={(v) => setScenarioId(v as ScenarioId)}>
                <SelectTrigger id="orchestrator-scenario" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORCHESTRATOR_SCENARIOS.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span>{s.emoji}</span>
                        <span className="font-medium">{s.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={runFull} disabled={running !== null} className="gap-1.5 flex-1">
                {running === 'full' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Ejecutar todo
              </Button>
              <Button onClick={runStep} disabled={running !== null} variant="outline" className="gap-1.5 flex-1">
                {running === 'step' ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className="size-3.5" />}
                Siguiente paso
              </Button>
              {(timeline.length > 0 || completedSteps.size > 0) && (
                <Button onClick={reset} variant="ghost" size="icon" aria-label="Reiniciar">
                  <RotateCcw className="size-3.5" />
                </Button>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg border bg-muted/30 text-sm">
            <div className="flex items-start gap-2">
              <span className="text-base leading-none mt-0.5">{scenario.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{scenario.label}</div>
                <p className="text-xs text-muted-foreground mt-0.5 whitespace-normal break-words">{scenario.description}</p>
                <div className="mt-2 text-xs">
                  <span className="text-muted-foreground">Mensaje semilla:</span>
                  <code className="ml-1.5 text-[11px] bg-background px-1.5 py-0.5 rounded border">{scenario.seedMessage}</code>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertCircle className="size-4" />
              <AlertTitle>Error en la ejecución</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
                <span>{error}</span>
                <Button size="sm" variant="outline" onClick={runFull} disabled={running !== null} className="gap-1.5">
                  <RefreshCw className="size-3.5" /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {completedSteps.size > 0 && (
            <div className="flex items-center gap-3">
              <div
                className="flex-1 h-2 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuenow={completedSteps.size}
                aria-valuemin={0}
                aria-valuemax={ORCHESTRATOR_STEPS.length}
                aria-label={`Progreso del pipeline: ${completedSteps.size} de ${ORCHESTRATOR_STEPS.length} pasos`}
              >
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{completedSteps.size}/{ORCHESTRATOR_STEPS.length}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 9-step visual stepper */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pipeline · 9 pasos</CardTitle>
          <CardDescription>Cada paso invoca un agente (§6) y muestra su respuesta en el timeline de abajo</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="flex flex-col sm:flex-row items-stretch gap-3 sm:gap-2 overflow-x-auto sm:overflow-x-visible sm:min-w-max pb-1">
            {ORCHESTRATOR_STEPS.map((step, i) => {
              const accent = ORCHESTRATOR_ACCENT[step.accent]
              const isCompleted = completedSteps.has(step.id)
              const isCurrent = currentStep === step.id && !isCompleted
              const isLast = i === ORCHESTRATOR_STEPS.length - 1
              return (
                <div key={step.id} className="flex flex-col sm:flex-row items-stretch gap-2">
                  <div
                    aria-current={isCurrent ? 'step' : undefined}
                    className={cn(
                      'rounded-xl border p-2.5 w-full sm:w-[180px] shrink-0 transition-all',
                      isCompleted && 'border-emerald-500/40 bg-emerald-500/5',
                      isCurrent && 'border-primary ring-2 ring-primary/20 bg-primary/5',
                      !isCompleted && !isCurrent && 'border-border bg-card'
                    )}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base leading-none">{step.emoji}</span>
                      <Badge variant="outline" className={cn('text-[9px] h-4 px-1 tabular-nums', accent.chip)}>
                        {step.index}
                      </Badge>
                      {isCompleted && <CheckCircle2 className="size-3.5 text-emerald-600 ml-auto" />}
                    </div>
                    <div className={cn('text-xs font-semibold mt-1.5 leading-tight', isCurrent && 'text-primary')}>
                      {step.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-3 whitespace-normal break-words">{step.description}</div>
                  </div>
                  {!isLast && (
                    <div className={cn(
                      'hidden sm:flex items-center justify-center w-4 shrink-0',
                      isCompleted ? 'text-emerald-500' : 'text-muted-foreground/30'
                    )}>
                      <ChevronRight className="size-4" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Timeline / replies */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Timeline de respuestas
          </CardTitle>
          <CardDescription>
            {timeline.length === 0 ? 'Ejecuta el pipeline para ver las respuestas de cada agente aquí.'
              : `${timeline.length} respuestas · último: ${timeline[timeline.length - 1].label}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {running === 'full' && timeline.length === 0 ? (
            <div className="space-y-3" aria-busy="true" aria-label="Cargando respuestas del pipeline">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3 rounded-lg border p-3">
                  <Skeleton className="size-9 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3 text-muted-foreground">
              <Bot className="size-12 opacity-30" />
              <p className="text-sm">Sin ejecuciones todavía</p>
              <p className="text-xs max-w-sm">
                Selecciona un escenario y haz clic en <strong className="text-foreground">Ejecutar todo</strong> para correr los 9 agentes en secuencia,
                o <strong className="text-foreground">Siguiente paso</strong> para invocarlos uno a la vez.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {timeline.map((t) => {
                const stepMeta = ORCHESTRATOR_STEPS.find(s => s.id === t.step)!
                const accent = ORCHESTRATOR_ACCENT[stepMeta.accent]
                return (
                  <div key={t.step} className="flex gap-3 rounded-lg border p-3 hover:bg-muted/20 transition-colors">
                    <div className={cn('size-9 rounded-lg flex items-center justify-center shrink-0 ring-1 text-base', accent.chip, accent.ring)}>
                      {t.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('text-[9px] h-4 tabular-nums', accent.chip)}>Paso {t.index}</Badge>
                        <span className="font-semibold text-sm">{t.label}</span>
                        <span className="text-[10px] text-muted-foreground">· {t.agentLabel}</span>
                        {t.error && <Badge variant="outline" className="text-[9px] h-4 text-amber-600 border-amber-500/30 bg-amber-500/5">fallback</Badge>}
                      </div>
                      <p className="text-sm mt-1.5 whitespace-pre-wrap text-foreground/90 leading-relaxed">{t.reply}</p>
                      {t.error && <p className="text-[10px] text-amber-600 mt-1">Agente no disponible — se usó respuesta determinística de respaldo.</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
