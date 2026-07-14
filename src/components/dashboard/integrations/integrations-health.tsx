// ZIAY — Integrations health table (the /api/health endpoint snapshot).
// Split out from integrations-view.tsx in SPRINT8-VIEWS-SPLIT-001.

import { Database } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

import { cn } from '@/lib/utils'

import { type HealthCheck, statusMeta } from './integrations-shared'

// ───────────────────────────────────────────────────────────────────────────
// IntegrationsHealthTable — full /api/health table card
// ───────────────────────────────────────────────────────────────────────────

export function IntegrationsHealthTable({
  checks, checksLoading,
}: {
  checks: HealthCheck[]
  checksLoading: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" /> Estado completo del endpoint /api/health
        </CardTitle>
        <CardDescription>Lecturas reales por integración · refresh para revalidar</CardDescription>
      </CardHeader>
      <CardContent>
        {checksLoading ? (
          <div className="space-y-1.5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {checks.map(c => {
              const meta = statusMeta(c.status)
              const Icon = meta.icon
              return (
                <div key={c.name} className="flex items-center gap-2 p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                  <Icon className={cn('size-3.5 shrink-0', meta.iconCls)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium font-mono truncate">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{c.detail}</div>
                  </div>
                  <Badge variant="outline" className={cn('text-[9px] h-4 px-1 shrink-0', meta.badge)}>{meta.label}</Badge>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
