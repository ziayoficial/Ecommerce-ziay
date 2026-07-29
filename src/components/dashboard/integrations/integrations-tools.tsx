// ZIAY — Integrations tools (freight quote tester + VLM identifier).
// Split out from integrations-view.tsx in SPRINT8-VIEWS-SPLIT-001.
//
// All state stays in index.tsx; this is a presentational component that
// receives the freight + vision state and callbacks as props.

import {
  Calculator, Eye, Sparkles, Loader2, Send, XCircle,
} from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

import { formatCurrency } from '@/lib/format'

import { type FreightQuoteResult, type VisionResult } from './integrations-shared'

// ───────────────────────────────────────────────────────────────────────────
// IntegrationsTools — two-column grid with freight quote tester + VLM identifier
// ───────────────────────────────────────────────────────────────────────────

export function IntegrationsTools({
  tenantId,
  fqCity, setFqCity, fqCountry, setFqCountry, fqUnits, setFqUnits,
  fqLoading, fqResult, onRunFreightQuote,
  viUrl, setViUrl, viLoading, viResult, onRunVision,
}: {
  tenantId: string | undefined
  fqCity: string
  setFqCity: (v: string) => void
  fqCountry: string
  setFqCountry: (v: string) => void
  fqUnits: string
  setFqUnits: (v: string) => void
  fqLoading: boolean
  fqResult: FreightQuoteResult | null
  onRunFreightQuote: () => void
  viUrl: string
  setViUrl: (v: string) => void
  viLoading: boolean
  viResult: VisionResult | null
  onRunVision: () => void
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Freight quote tester */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="size-4 text-amber-600" /> Cotizador de flete
          </CardTitle>
          <CardDescription>Saramantha §6.8, §8.6 · usa el LogisticsAdapter activo del tenant</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="fq-city" className="text-xs text-muted-foreground">Ciudad destino</Label>
              <Input id="fq-city" value={fqCity} onChange={(e) => setFqCity(e.target.value)} placeholder="Bogotá" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fq-country" className="text-xs text-muted-foreground">País</Label>
              <Input id="fq-country" value={fqCountry} onChange={(e) => setFqCountry(e.target.value.toUpperCase())} placeholder="CO" maxLength={3} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fq-units" className="text-xs text-muted-foreground">Unidades</Label>
              <Input id="fq-units" type="number" min={1} value={fqUnits} onChange={(e) => setFqUnits(e.target.value)} />
            </div>
          </div>
          <Button onClick={onRunFreightQuote} disabled={fqLoading || !tenantId} className="w-full gap-1.5">
            {fqLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Cotizar flete
          </Button>
          {fqResult && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm">
              {'error' in fqResult ? (
                <div className="flex items-center gap-2 text-rose-600">
                  <XCircle className="size-4 shrink-0" />
                  <span className="text-xs">{fqResult.error}</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Tarifa</span>
                    <span className="font-semibold tabular-nums">{formatCurrency(fqResult.quote.tarifa, fqResult.pais === 'CO' ? 'COP' : 'USD')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Tiempo estimado</span>
                    <span className="font-medium tabular-nums">{fqResult.quote.tiempo_estimado_dias} días</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Transportadora</span>
                    <Badge variant="outline" className="text-[10px]">{fqResult.quote.transportadora}</Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{fqResult.ciudad}, {fqResult.pais}</span>
                    <span>{fqResult.cantidad_unidades} und</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vision identifier */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="size-4 text-violet-600" /> Identificador visual (VLM)
          </CardTitle>
          <CardDescription>Saramantha §6.9 · agent "vision" · lee la franja de metadata de la imagen y devuelve el SKU</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="vi-url" className="text-xs text-muted-foreground">URL de la imagen del cliente</Label>
            <Input id="vi-url" value={viUrl} onChange={(e) => setViUrl(e.target.value)} placeholder="https://.../producto.jpg" />
            <p className="text-[10px] text-muted-foreground mt-1">El agente prioriza la franja de metadata (OCR). Si está recortada, compara visualmente contra el catálogo.</p>
          </div>
          <Button onClick={onRunVision} disabled={viLoading || !tenantId || !viUrl.trim()} variant="outline" className="w-full gap-1.5">
            {viLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Identificar producto
          </Button>
          {viResult && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300">agente {viResult.agent}</Badge>
                {viResult.error
                  ? <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300">fallback</Badge>
                  : <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">confianza {(viResult.confidence * 100).toFixed(0)}%</Badge>}
              </div>
              <pre className="text-[11px] whitespace-pre-wrap break-words text-foreground/90 font-mono bg-background p-2 rounded border">{viResult.reply || '—'}</pre>
              {viResult.error && <p className="text-[10px] text-amber-600">IA no disponible — fallback determinístico.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
