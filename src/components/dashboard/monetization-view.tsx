'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { formatCurrency, formatPercent, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/hooks/use-tenant'
import {
  DollarSign, TrendingUp, Wallet, Receipt, Clock, AlertTriangle, CheckCircle2,
} from 'lucide-react'

type MonetizationData = {
  tenant: { slug: string; nombreNegocio: string; planMonetizacion: string }
  periodo: string
  gmv: number; gmvPaid: number; ordenes: number
  tramo: string; comisionPct: number
  comisionCalculada: number; comisionReconocida: number; comisionPendiente: number
  feeBaseMensual: number; totalEstimado: number
  invoice: { id: string; estado: string; total: number; emitidaAt: string | null } | null
  embudo: { pendiente_confirmacion: number; datos_completados: number; despachado: number; intento_cancelacion: number }
}

type CommissionEntry = {
  id: string; orderId: string; orderNumber: string; orderStatus: string
  gmv: number; comisionPct: number; comisionTotal: number
  reconocidaPct: number; reconocidaMonto: number
  etapaReconocimiento: string | null; reconocidaAt: string | null; createdAt: string
}

export function MonetizationView() {
  const tenantId = useTenantId()
  const [data, setData] = useState<MonetizationData | null>(null)
  const [entries, setEntries] = useState<CommissionEntry[]>([])
  const [totals, setTotals] = useState<{ gmv: number; comisionTotal: number; reconocida: number; pendiente: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    Promise.all([
      fetch(`/api/monetization/gmv?tenantId=${tenantId}`).then(r => r.json()),
      fetch(`/api/monetization/commission?tenantId=${tenantId}`).then(r => r.json()),
    ]).then(([d, c]) => {
      if (cancelled) return
      setData(d)
      setEntries(c.entries || [])
      setTotals(c.totals || null)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tenantId])

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 flex items-center justify-center"><DollarSign className="size-5" /></div>
            <div>
              <div className="text-lg font-bold tabular-nums">{formatCurrency(data.gmv, 'COP', { compact: true })}</div>
              <div className="text-xs text-muted-foreground">GMV ({data.periodo})</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 flex items-center justify-center"><TrendingUp className="size-5" /></div>
            <div>
              <div className="text-lg font-bold tabular-nums">{formatCurrency(data.comisionReconocida, 'COP', { compact: true })}</div>
              <div className="text-xs text-muted-foreground">Comisión reconocida</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 flex items-center justify-center"><Clock className="size-5" /></div>
            <div>
              <div className="text-lg font-bold tabular-nums">{formatCurrency(data.comisionPendiente, 'COP', { compact: true })}</div>
              <div className="text-xs text-muted-foreground">Pendiente de reconocimiento</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20 flex items-center justify-center"><Receipt className="size-5" /></div>
            <div>
              <div className="text-lg font-bold tabular-nums">{formatCurrency(data.totalEstimado, 'COP', { compact: true })}</div>
              <div className="text-xs text-muted-foreground">Total estimado (fee + comisión)</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tramo + recognition model */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tramo de comisión</CardTitle>
            <CardDescription>Comisión escalonada decreciente sobre GMV (Saramantha §17.3)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: '0 – $10M', pct: 4.5, active: data.tramo === '0-10M' },
              { label: '$10M – $40M', pct: 3, active: data.tramo === '10-40M' },
              { label: '$40M+', pct: 1.75, active: data.tramo === '40M+' },
            ].map((t) => (
              <div key={t.label} className={cn('flex items-center justify-between p-3 rounded-lg border', t.active ? 'border-primary bg-primary/5' : '')}>
                <span className="text-sm font-medium">{t.label} COP/mes</span>
                <span className={cn('text-sm font-bold tabular-nums', t.active ? 'text-primary' : '')}>{t.pct}%</span>
                {t.active && <Badge variant="default" className="text-[10px]">actual</Badge>}
              </div>
            ))}
            <Separator />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Plan</span>
              <Badge variant="outline" className="capitalize">{data.tenant.planMonetizacion}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Fee base mensual</span>
              <span className="font-medium tabular-nums">{formatCurrency(data.feeBaseMensual)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Embudo — Saramantha §15.1 critical */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500" /> Embudo de pedidos (cuello de botella §15.1)</CardTitle>
            <CardDescription>Reconocimiento de comisión en 2 momentos — 50% en "Datos completados", 100% en "Despachado"</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { label: 'Llamar para confirmar', count: data.embudo.pendiente_confirmacion, pct: data.ordenes > 0 ? (data.embudo.pendiente_confirmacion / data.ordenes) * 100 : 0, color: 'bg-rose-500', recon: '0%' },
                { label: 'Datos completados (50% comisión)', count: data.embudo.datos_completados, pct: data.ordenes > 0 ? (data.embudo.datos_completados / data.ordenes) * 100 : 0, color: 'bg-amber-500', recon: '50%' },
                { label: 'Despachado (100% comisión)', count: data.embudo.despachado, pct: data.ordenes > 0 ? (data.embudo.despachado / data.ordenes) * 100 : 0, color: 'bg-emerald-500', recon: '100%' },
                { label: 'Intento cancelación', count: data.embudo.intento_cancelacion, pct: data.ordenes > 0 ? (data.embudo.intento_cancelacion / data.ordenes) * 100 : 0, color: 'bg-slate-500', recon: '0%' },
              ].map((e) => (
                <div key={e.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-medium">{e.label}
                      <Badge variant="outline" className="text-[9px] h-4">reconoce {e.recon}</Badge>
                    </span>
                    <span className="text-muted-foreground tabular-nums">{e.count} · {formatPercent(e.pct, 0)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn('h-full rounded-full', e.color)} style={{ width: `${Math.max(e.pct, 2)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex gap-2 text-xs">
              <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                <strong className="text-foreground">Hallazgo §15.1:</strong> solo {formatPercent(data.ordenes > 0 ? (data.embudo.despachado / data.ordenes) * 100 : 0, 1)} llega a "Despachado". El reconocimiento en 2 momentos evita que el 98% del GMV quede sin facturar.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Commission entries table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entradas de comisión</CardTitle>
          <CardDescription>{entries.length} entradas · {data.ordenes} pedidos con origen agente_whatsapp</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Sin comisiones reconocidas todavía</div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">Pedido</TableHead>
                    <TableHead className="w-32">Estado</TableHead>
                    <TableHead className="text-right w-36">GMV</TableHead>
                    <TableHead className="text-right w-20">%</TableHead>
                    <TableHead className="text-right w-40">Comisión total</TableHead>
                    <TableHead className="text-right w-28">Recon. %</TableHead>
                    <TableHead className="text-right w-40">Reconocida</TableHead>
                    <TableHead className="min-w-[160px]">Etapa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{e.orderNumber}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{e.orderStatus}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">{formatCurrency(e.gmv, 'COP', { compact: true })}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">{e.comisionPct}%</TableCell>
                      <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">{formatCurrency(e.comisionTotal, 'COP', { compact: true })}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded inline-block',
                          e.reconocidaPct === 100 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                          e.reconocidaPct === 50 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
                          'bg-slate-500/10 text-slate-700 dark:text-slate-300'
                        )}>{e.reconocidaPct}%</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">{formatCurrency(e.reconocidaMonto, 'COP', { compact: true })}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.etapaReconocimiento || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoice */}
      {data.invoice && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500" /> Factura del período {data.periodo}</CardTitle>
            <CardDescription>Plan {data.tenant.planMonetizacion} · tramo {data.tramo}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><div className="text-xs text-muted-foreground">GMV facturado</div><div className="font-semibold tabular-nums">{formatCurrency(data.gmv, 'COP', { compact: true })}</div></div>
              <div><div className="text-xs text-muted-foreground">Fee base</div><div className="font-semibold tabular-nums">{formatCurrency(data.feeBaseMensual)}</div></div>
              <div><div className="text-xs text-muted-foreground">Comisión</div><div className="font-semibold tabular-nums">{formatCurrency(data.comisionCalculada, 'COP', { compact: true })}</div></div>
              <div><div className="text-xs text-muted-foreground">Total</div><div className="font-bold tabular-nums text-primary">{formatCurrency(data.invoice.total, 'COP', { compact: true })}</div></div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Badge variant={data.invoice.estado === 'pagada' ? 'default' : 'secondary'}>{data.invoice.estado}</Badge>
              {data.invoice.emitidaAt && <span className="text-xs text-muted-foreground">Emitida {shortDate(data.invoice.emitidaAt)}</span>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
