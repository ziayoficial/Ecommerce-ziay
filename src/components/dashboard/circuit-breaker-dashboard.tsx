'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, RefreshCw, Shield, Zap, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

/**
 * CircuitBreakerDashboard — shows the health of all agent circuit breakers.
 *
 * GAP-FIX-2: the circuit breaker API existed but had no UI. An ops team
 * member at 2am couldn't see which agents were tripped without curl.
 * This component fetches GET /api/agents/circuit-breaker and renders:
 *   - A summary (healthy/tripped count)
 *   - A list of open circuits (red) with manual reset buttons
 *   - A list of closed circuits (green)
 *
 * Mounted in the governance view or as a standalone admin panel.
 */

type CircuitState = {
  key: string
  state: 'closed' | 'open' | 'half-open'
  failures: number
  successes: number
  lastFailureAt?: number
  lastSuccessAt?: number
}

type BreakerData = {
  summary: {
    total: number
    open: number
    halfOpen: number
    closed: number
    healthy: boolean
  }
  circuits: CircuitState[]
  openCircuits: Array<{ key: string; failures: number; lastFailureAt?: number }>
}

export function CircuitBreakerDashboard() {
  const [data, setData] = useState<BreakerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState<string | null>(null)

  const fetchBreakers = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/circuit-breaker')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch {
      // Silent fail — this is an admin panel, not customer-facing
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBreakers()
    // Refresh every 30s so the dashboard stays current
    const interval = setInterval(fetchBreakers, 30_000)
    return () => clearInterval(interval)
  }, [fetchBreakers])

  async function resetCircuit(key: string) {
    setResetting(key)
    try {
      const res = await fetch('/api/agents/circuit-breaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', circuitKey: key }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(`Circuito ${key} reiniciado`)
      await fetchBreakers()
    } catch {
      toast.error('Error al reiniciar el circuito')
    } finally {
      setResetting(null)
    }
  }

  async function resetAll() {
    setResetting('all')
    try {
      const res = await fetch('/api/agents/circuit-breaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resetAll' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('Todos los circuitos reiniciados')
      await fetchBreakers()
    } catch {
      toast.error('Error al reiniciar todos los circuitos')
    } finally {
      setResetting(null)
    }
  }

  if (loading) {
    return (
      <Card className="p-6 space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
    )
  }

  if (!data) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        <AlertCircle className="size-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No se pudo cargar el estado de los circuit breakers</p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchBreakers}
          className="mt-3 gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Reintentar carga de circuit breakers"
        >
          <RefreshCw className="size-3.5" /> Reintentar
        </Button>
      </Card>
    )
  }

  const { summary, circuits } = data

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          <h3 className="font-semibold text-sm sm:text-base">Circuit Breakers</h3>
          {summary.healthy ? (
            <Badge variant="default" className="gap-1 text-xs bg-emerald-600">
              <CheckCircle2 className="size-3" /> Saludable
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1 text-xs">
              <AlertTriangle className="size-3" /> {summary.open} tripeado(s)
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchBreakers} className="gap-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring" aria-label="Actualizar circuit breakers">
            <RefreshCw className="size-3" /> Actualizar
          </Button>
          {summary.open > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetAll}
              disabled={resetting === 'all'}
              className="gap-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Reiniciar todos los circuit breakers abiertos"
            >
              <Zap className="size-3" /> Reiniciar todos
            </Button>
          )}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{summary.closed}</div>
          <div className="text-[10px] text-muted-foreground">Cerrados</div>
        </div>
        <div className="rounded-lg bg-amber-500/10 p-2">
          <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{summary.halfOpen}</div>
          <div className="text-[10px] text-muted-foreground">Half-open</div>
        </div>
        <div className="rounded-lg bg-rose-500/10 p-2">
          <div className="text-lg font-bold text-rose-600 dark:text-rose-400">{summary.open}</div>
          <div className="text-[10px] text-muted-foreground">Abiertos</div>
        </div>
      </div>

      {/* Open circuits (priority) */}
      {summary.open > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-red-600">Circuitos abiertos (agentes caídos)</h4>
          {circuits
            .filter((c) => c.state === 'open')
            .map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs truncate">{c.key}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.failures} fallos consecutivos
                    {c.lastFailureAt && ` · último: ${new Date(c.lastFailureAt).toLocaleTimeString('es-CO')}`}
                  </div>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => resetCircuit(c.key)}
                  disabled={resetting === c.key}
                  className="gap-1 text-xs shrink-0 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Reiniciar circuito ${c.key}`}
                >
                  <Zap className="size-3" /> Reiniciar
                </Button>
              </div>
            ))}
        </div>
      )}

      {/* Half-open circuits */}
      {summary.halfOpen > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-amber-600">Half-open (recuperándose)</h4>
          {circuits
            .filter((c) => c.state === 'half-open')
            .map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs truncate">{c.key}</div>
                  <div className="text-[10px] text-muted-foreground">Probando si el agente recuperó</div>
                </div>
                <Badge variant="outline" className="text-amber-600 text-xs shrink-0">
                  Esperando
                </Badge>
              </div>
            ))}
        </div>
      )}

      {/* Closed circuits (normal) */}
      {summary.closed > 0 && summary.open === 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">Todos los agentes operacionales</h4>
          <div className="text-[11px] text-muted-foreground">
            {summary.closed} circuito(s) cerrado(s) — los agentes están funcionando normalmente.
          </div>
        </div>
      )}

      {summary.total === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Sin actividad todavía — los circuit breakers se crean cuando un agente falla.
        </p>
      )}
    </Card>
  )
}
