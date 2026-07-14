// ZIAY — Logistics "Guías estancadas" tab + per-row action.
// Split out from logistics-intelligence-view.tsx in AUDIT-FINAL-SPLIT-001.

'use client'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { shortDate } from '@/lib/format'
import { toast } from 'sonner'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { type GuideTracking } from './logistics-shared'

export function StuckGuidesTab({
  guides, tenantId, onChanged,
}: {
  guides: GuideTracking[]
  tenantId: string
  onChanged: () => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-500" />
          Guías estancadas
        </CardTitle>
        <CardDescription>
          {guides.length} guías sin movimiento &gt; 3 días
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {guides.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No hay guías estancadas
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="divide-y">
              {guides.map((g) => (
                <StuckGuideRow key={g.id} guide={g} tenantId={tenantId} onChanged={onChanged} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

function StuckGuideRow({
  guide, tenantId, onChanged,
}: {
  guide: GuideTracking
  tenantId: string
  onChanged: () => void
}) {
  const [loading, setLoading] = useState(false)
  const createNovedad = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/agents/guide_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          guideNumber: guide.guideNumber,
          carrierName: guide.carrierName,
          daysStuck: guide.daysStuck,
          trigger: 'stuck_manual',
        }),
      })
      if (!res.ok) throw new Error('agent failed')
      const json = await res.json()
      toast.success(`Novedad creada para ${guide.guideNumber}`, {
        description: json.reply?.slice(0, 120),
      })
      onChanged()
    } catch {
      toast.error(`No se pudo crear novedad para ${guide.guideNumber}`)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="p-4 flex items-center gap-3">
      <div className="size-9 rounded-lg bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 flex items-center justify-center shrink-0">
        <AlertTriangle className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-semibold truncate max-w-[180px]">
            {guide.guideNumber}
          </span>
          {guide.carrierName && (
            <Badge variant="outline" className="text-[10px] truncate max-w-[120px]">
              {guide.carrierName}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {guide.daysStuck}d stuck
          </Badge>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {guide.lastEventAt ? `Último evento: ${shortDate(guide.lastEventAt)}` : 'Sin eventos registrados'}
          {' · '}estado {guide.status}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={createNovedad} disabled={loading}>
        Crear novedad
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}
