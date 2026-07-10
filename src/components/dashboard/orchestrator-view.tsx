'use client'
import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/hooks/use-tenant'
import { toast } from 'sonner'
import {
  ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS, ORCHESTRATOR_ACCENT,
  OrchestratorStepId, ScenarioId,
} from '@/lib/orchestrator/constants'
import {
  Play, ChevronRight, Loader2, RotateCcw, CheckCircle2, AlertTriangle, Sparkles, Bot,
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
    <div className="space-y-6 animate-fade-in-up">
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
              <label className="text-xs font-medium text-muted-foreground">Escenario</label>
              <Select value={scenarioId} onValueChange={(v) => setScenarioId(v as ScenarioId)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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
                <p className="text-xs text-muted-foreground mt-0.5">{scenario.description}</p>
                <div className="mt-2 text-xs">
                  <span className="text-muted-foreground">Mensaje semilla:</span>
                  <code className="ml-1.5 text-[11px] bg-background px-1.5 py-0.5 rounded border">{scenario.seedMessage}</code>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/20 flex items-start gap-2 text-sm">
              <AlertTriangle className="size-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-rose-700 dark:text-rose-300">Error en la ejecución</div>
                <div className="text-xs text-muted-foreground mt-0.5">{error}</div>
              </div>
            </div>
          )}

          {completedSteps.size > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
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
          <div className="flex items-stretch gap-2 min-w-max pb-1">
            {ORCHESTRATOR_STEPS.map((step, i) => {
              const accent = ORCHESTRATOR_ACCENT[step.accent]
              const isCompleted = completedSteps.has(step.id)
              const isCurrent = currentStep === step.id && !isCompleted
              const isLast = i === ORCHESTRATOR_STEPS.length - 1
              return (
                <div key={step.id} className="flex items-stretch gap-2">
                  <div className={cn(
                    'rounded-xl border p-2.5 w-[150px] shrink-0 transition-all',
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
                    <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{step.description}</div>
                  </div>
                  {!isLast && (
                    <div className={cn(
                      'flex items-center justify-center w-4 shrink-0',
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
          {timeline.length === 0 ? (
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
    </div>
  )
}
