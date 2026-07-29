// ZIAY — Marketplace referrals sent/received tab.
// Split out from marketplace-view.tsx in AUDIT-FINAL-SPLIT-001.

'use client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import { ArrowDownLeft, ArrowUpRight, Clock } from 'lucide-react'
import { referralStatusMeta, type LeadReferral } from './marketplace-shared'

/**
 * Referrals tab — two side-by-side columns: sent (left) and received (right).
 */
export function ReferralsTab({
  sent, received,
}: {
  sent: LeadReferral[]
  received: LeadReferral[]
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ReferralColumn
        title="Enviados"
        icon={<ArrowUpRight className="size-4 text-emerald-600" />}
        referrals={sent}
        direction="sent"
        empty="No has enviado referrals todavía"
      />
      <ReferralColumn
        title="Recibidos"
        icon={<ArrowDownLeft className="size-4 text-violet-600" />}
        referrals={received}
        direction="received"
        empty="No has recibido referrals todavía"
      />
    </div>
  )
}

function ReferralColumn({
  title, icon, referrals, direction, empty,
}: {
  title: string
  icon: React.ReactNode
  referrals: LeadReferral[]
  direction: 'sent' | 'received'
  empty: string
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="secondary" className="text-[10px] ml-1">{referrals.length}</Badge>
        </CardTitle>
        <CardDescription>
          {direction === 'sent' ? 'Leads que enviaste a otras marcas' : 'Leads que otras marcas te enviaron'}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {referrals.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="divide-y">
              {referrals.map((r) => {
                const meta = referralStatusMeta(r.status)
                return (
                  <div key={r.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold truncate max-w-[160px]">
                            {r.customerPhone}
                          </span>
                          {r.customerName && (
                            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                              · {r.customerName}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 break-words line-clamp-2" title={r.reason}>
                          {r.reason}
                        </p>
                      </div>
                      <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 whitespace-nowrap shrink-0', meta.cls)}>
                        {meta.icon}
                        {meta.label}
                      </span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {timeAgo(r.createdAt)}
                      </span>
                      <span className="tabular-nums">
                        Comisión: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{r.commission}%</span>
                      </span>
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
