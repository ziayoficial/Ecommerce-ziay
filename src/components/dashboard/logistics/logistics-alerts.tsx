// ZIAY — Logistics behavior-alerts section.
// Split out from logistics-intelligence-view.tsx in AUDIT-FINAL-SPLIT-001.

'use client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import { Bell, Clock } from 'lucide-react'
import {
  alertSeverity, severityMeta, type BehaviorAlert,
} from './logistics-shared'

export function BehaviorAlertsCard({ alerts }: { alerts: BehaviorAlert[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="size-4 text-rose-500" />
          Alertas de comportamiento
        </CardTitle>
        <CardDescription>
          {alerts.length} alertas activas · generadas por BuyerBehavior + BehaviorAlert
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {alerts.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Sin alertas — comportamiento de clientes normal
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="divide-y">
              {alerts.map((a) => {
                const sev = alertSeverity(a.alertType)
                const meta = severityMeta(sev)
                return (
                  <div key={a.id} className="p-4 flex items-start gap-3">
                    <span className={cn('size-2 rounded-full mt-1.5 shrink-0', meta.dot)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('text-[10px]', meta.cls)}>
                          {meta.label}
                        </Badge>
                        <span className="text-xs font-mono text-muted-foreground">
                          {a.alertType}
                        </span>
                        {a.buyerBehavior && (
                          <span className="text-xs font-mono text-muted-foreground">
                            · {a.buyerBehavior.phone}
                          </span>
                        )}
                      </div>
                      <p className="text-sm mt-1 break-words">{a.message}</p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {timeAgo(a.createdAt)}
                        </span>
                        {a.buyerBehavior && (
                          <>
                            <span>· Riesgo: {a.buyerBehavior.riskLevel}</span>
                            <span>· Devoluciones: {a.buyerBehavior.totalReturns}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
