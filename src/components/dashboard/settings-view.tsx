'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatCurrency, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { t } from '@/lib/i18n'
import { ChannelsManager } from './channels-manager'
import {
  CreditCard, Truck, Percent, Save, Shield, Zap, Globe, KeyRound, Bot,
  AlertCircle, RefreshCw, Inbox,
} from 'lucide-react'

type ChannelCfg = {
  id: string; type: string; name: string; displayName: string; country?: string | null
  paymentStrategy: string; requirePrepayMin?: number | null
  prepayDiscountPct?: number | null; codFee?: number | null
}

type GlobalCfg = Record<string, string>

const channelMeta = (type: string) => {
  switch (type) {
    case 'whatsapp': return { color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30', label: 'WhatsApp', icon: '💬', border: 'border-l-emerald-500' }
    case 'messenger': return { color: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/30', label: 'Messenger', icon: '📩', border: 'border-l-sky-500' }
    case 'instagram': return { color: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 ring-fuchsia-500/30', label: 'Instagram', icon: '📷', border: 'border-l-fuchsia-500' }
    case 'telegram': return { color: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 ring-cyan-500/30', label: 'Telegram', icon: '✈️', border: 'border-l-cyan-500' }
    default: return { color: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/30', label: type, icon: '🔌', border: 'border-l-slate-500' }
  }
}

const strategyMeta = (s: string) => {
  switch (s) {
    case 'advance': return { label: 'Anticipado', icon: CreditCard, cls: 'bg-primary/10 text-primary ring-primary/30' }
    case 'cod': return { label: 'Contra entrega', icon: Truck, cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30' }
    case 'hybrid': return { label: 'Híbrido', icon: Percent, cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/30' }
    default: return { label: s, icon: CreditCard, cls: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/30' }
  }
}

export function SettingsView() {
  const [channels, setChannels] = useState<ChannelCfg[]>([])
  const [global, setGlobal] = useState<GlobalCfg>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [autoKill, setAutoKill] = useState(true)
  const [aiReplies, setAiReplies] = useState(true)

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/payments/config')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setChannels(d.channels || [])
      setGlobal(d.global || {})
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Settings fetch failed', err)
      setError('No pudimos cargar la configuración. Verifica tu conexión o intenta de nuevo.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const updateChannel = (id: string, field: keyof ChannelCfg, value: string | number) => {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  const saveChannel = async (id: string) => {
    setSaving(id)
    const ch = channels.find(c => c.id === id)
    if (!ch) return
    await fetch('/api/payments/config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: id,
        paymentStrategy: ch.paymentStrategy,
        requirePrepayMin: ch.requirePrepayMin,
        prepayDiscountPct: ch.prepayDiscountPct,
        codFee: ch.codFee,
      }),
    })
    setSaving(null)
    toast.success(`Configuración de ${ch.displayName} guardada`)
  }

  const saveGlobal = async () => {
    setSaving('global')
    await fetch('/api/payments/config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: 'global', global }),
    })
    setSaving(null)
    toast.success('Umbrales globales guardados')
  }

  if (loading) return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
    </div>
  )

  if (error) {
    return (
      <Alert variant="destructive" className="animate-fade-in-up">
        <AlertCircle className="size-4" />
        <AlertTitle>Error al cargar la configuración</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => loadData(true)} className="gap-1.5">
            <RefreshCw className="size-3.5" /> Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  // ── Empty state: no channels and no global config yet ──
  const isEmpty = channels.length === 0 && Object.keys(global).length === 0
  if (isEmpty) {
    return (
      <section aria-label="Configuración" className="flex flex-col items-center justify-center text-center py-16 px-4 animate-fade-in-up">
        <div className="size-20 rounded-2xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center mb-5">
          <Inbox className="size-9 text-primary" />
        </div>
        <h2 className="text-lg font-semibold">Aún no hay configuración</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-2">
          Cuando conectes canales en Mensajería y configures estrategias de pago y umbrales del trafficker,
          verás aquí todas las opciones. Empieza agregando un canal.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          <Button variant="outline" size="sm" onClick={() => loadData(true)} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} /> {t('common.refresh')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Configuración" className="space-y-6 animate-fade-in-up">
      {/* ── Header: last-updated + refresh ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] sm:text-xs text-muted-foreground truncate">
          {lastUpdated ? (
            <span>Actualizado hace <strong className="text-foreground tabular-nums">{timeAgo(lastUpdated)}</strong></span>
          ) : (
            <span>Datos de muestra</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => loadData(true)} disabled={refreshing} className="gap-1.5 h-9 px-3">
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          {refreshing ? t('common.refreshing') : t('common.refresh')}
        </Button>
      </div>

      {/* Channels manager — multi-line WhatsApp, Messenger, IG with credentials */}
      <ChannelsManager />

      {/* Channel payment strategy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><CreditCard className="size-4 text-primary" /> Estrategia de pago por canal</CardTitle>
          <CardDescription>Define anticipado, contra entrega o híbrido para cada canal y país</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {channels.map((ch) => {
            const cm = channelMeta(ch.type)
            const sm = strategyMeta(ch.paymentStrategy)
            const StratIcon = sm.icon
            return (
              <div key={ch.id} className={cn('p-4 rounded-xl border border-l-4 space-y-3 transition-all hover:shadow-sm', cm.border)}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={cn('size-11 rounded-xl flex items-center justify-center ring-1 text-lg shrink-0', cm.color)} aria-hidden>
                      {cm.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                        <span className="truncate">{ch.displayName}</span>
                        <Badge variant="outline" className={cn('text-[9px] h-4 px-1 shrink-0', cm.color)}>{cm.label}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate" title={`${ch.name} · ${ch.country || 'Internacional'}`}>{ch.name} · {ch.country || 'Internacional'}</div>
                    </div>
                  </div>
                  <Select value={ch.paymentStrategy} onValueChange={(v) => updateChannel(ch.id, 'paymentStrategy', v)}>
                    <SelectTrigger className="w-44 h-9 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="advance"><span className="flex items-center gap-2"><CreditCard className="size-3.5" /> Anticipado</span></SelectItem>
                      <SelectItem value="cod"><span className="flex items-center gap-2"><Truck className="size-3.5" /> Contra entrega</span></SelectItem>
                      <SelectItem value="hybrid"><span className="flex items-center gap-2"><Percent className="size-3.5" /> Híbrido</span></SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Active strategy badge — visual differentiation per channel type */}
                <div className={cn('inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full ring-1', sm.cls)}>
                  <StratIcon className="size-3" />
                  <span className="font-medium">{sm.label}</span>
                </div>

                <form
                  className="space-y-3"
                  onSubmit={(e) => { e.preventDefault(); void saveChannel(ch.id) }}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`ch-${ch.id}-prepaymin`} className="text-xs text-muted-foreground">Mín. para prepago (híbrido)</Label>
                      <Input
                        id={`ch-${ch.id}-prepaymin`}
                        type="number"
                        className="tabular-nums"
                        value={ch.requirePrepayMin ?? ''}
                        onChange={(e) => updateChannel(ch.id, 'requirePrepayMin', Number(e.target.value))}
                        placeholder="Ej. 250000"
                        disabled={ch.paymentStrategy !== 'hybrid'}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`ch-${ch.id}-disc`} className="text-xs text-muted-foreground">% descuento prepago</Label>
                      <Input
                        id={`ch-${ch.id}-disc`}
                        type="number" step="0.5"
                        className="tabular-nums"
                        value={ch.prepayDiscountPct ?? ''}
                        onChange={(e) => updateChannel(ch.id, 'prepayDiscountPct', Number(e.target.value))}
                        placeholder="Ej. 5"
                        disabled={ch.paymentStrategy === 'cod'}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`ch-${ch.id}-codfee`} className="text-xs text-muted-foreground">Recargo envío COD</Label>
                      <Input
                        id={`ch-${ch.id}-codfee`}
                        type="number"
                        className="tabular-nums"
                        value={ch.codFee ?? ''}
                        onChange={(e) => updateChannel(ch.id, 'codFee', Number(e.target.value))}
                        placeholder="Ej. 8000"
                        disabled={ch.paymentStrategy === 'advance'}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {ch.paymentStrategy === 'advance' && '🔒 Solo pago anticipado vía carrito. Mejor flujo de caja.'}
                      {ch.paymentStrategy === 'cod' && '🚚 Solo contra entrega. Mayor aceptación, ~15% rechazo.'}
                      {ch.paymentStrategy === 'hybrid' && `⚖️ Híbrido: > ${formatCurrency(ch.requirePrepayMin || 0)} sugiere prepago con ${ch.prepayDiscountPct || 0}% off.`}
                    </p>
                    <Button type="submit" size="sm" variant="outline" disabled={saving === ch.id} className="gap-1.5">
                      <Save className="size-3.5" /> {saving === ch.id ? t('common.saving_data') : t('common.save')}
                    </Button>
                  </div>
                </form>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Global thresholds + automation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Shield className="size-4 text-amber-500" /> Umbrales del trafficker</CardTitle>
            <CardDescription>Reglas de auto-pausa y escalado de anuncios</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void saveGlobal() }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cfg-roas-kill" className="text-xs text-muted-foreground">ROAS mínimo (auto-pausa)</Label>
                  <Input id="cfg-roas-kill" type="number" step="0.1" className="tabular-nums" value={global.roas_kill_threshold || ''} onChange={(e) => setGlobal({ ...global, roas_kill_threshold: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cfg-cpa-target" className="text-xs text-muted-foreground">CPA objetivo (COP)</Label>
                  <Input id="cfg-cpa-target" type="number" className="tabular-nums" value={global.cpa_target || ''} onChange={(e) => setGlobal({ ...global, cpa_target: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cfg-cod-max" className="text-xs text-muted-foreground">Valor máx. para COD (COP)</Label>
                  <Input id="cfg-cod-max" type="number" className="tabular-nums" value={global.cod_max_order_value || ''} onChange={(e) => setGlobal({ ...global, cod_max_order_value: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cfg-currency" className="text-xs text-muted-foreground">Moneda por defecto</Label>
                  <Select value={global.default_currency || 'COP'} onValueChange={(v) => setGlobal({ ...global, default_currency: v })}>
                    <SelectTrigger id="cfg-currency" className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="COP">COP · Peso colombiano</SelectItem>
                      <SelectItem value="MXN">MXN · Peso mexicano</SelectItem>
                      <SelectItem value="USD">USD · Dólar</SelectItem>
                      <SelectItem value="EUR">EUR · Euro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-primary" />
                  <div>
                    <div className="text-sm font-medium">Auto-pausar anuncios canibalizadores</div>
                    <div className="text-xs text-muted-foreground">Apaga automáticamente anuncios con ROAS &lt; umbral y cero ventas</div>
                  </div>
                </div>
                <Switch checked={autoKill} onCheckedChange={setAutoKill} />
              </div>
              <Button type="submit" disabled={saving === 'global'} className="gap-1.5">
                <Save className="size-3.5" /> {saving === 'global' ? t('common.saving_data') : `${t('common.save')} umbrales`}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Globe className="size-4 text-violet-500" /> Integraciones (estado real)</CardTitle>
            <CardDescription>Estado real de cada integracion — lee del endpoint /api/health</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <IntegrationsReal />
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-primary" />
                <div>
                  <div className="text-sm font-medium">Respuestas automaticas con IA</div>
                  <div className="text-xs text-muted-foreground">Sugerencias contextuales para agentes</div>
                </div>
              </div>
              <Switch checked={aiReplies} onCheckedChange={setAiReplies} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Webhook endpoints info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" /> Webhooks & endpoints</CardTitle>
          <CardDescription>URLs que debes configurar en cada plataforma</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {[
            { label: 'WhatsApp inbound', url: 'POST /api/webhooks/whatsapp' },
            { label: 'Meta (Messenger/IG/Ads)', url: 'POST /api/webhooks/meta' },
            { label: 'Verify token', url: 'commerceflow_verify (configurable en .env)' },
            { label: 'Atribución por click_id', url: 'fbclid / gclid / ttclid capturado al aterrizar' },
          ].map((w) => (
            <div key={w.label} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border">
              <span className="text-muted-foreground">{w.label}</span>
              <code className="font-mono text-[11px] bg-background px-2 py-1 rounded border">{w.url}</code>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}

// ── Integrations real status (reads from /api/health) ──
function IntegrationsReal() {
  const [checks, setChecks] = useState<Array<{ name: string; status: string; detail: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/health?tenantId=ten-saramantha').then(r => r.json()).then(d => {
      // Filter to integration-relevant checks
      const relevant = (d.checks || []).filter((c: { name: string }) =>
        c.name.startsWith('llm_') || c.name.startsWith('adapter_') || c.name.startsWith('logistics_') || c.name.startsWith('webhook_') || c.name === 'database' || c.name === 'tenants'
      )
      setChecks(relevant)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="space-y-1.5" role="status" aria-live="polite" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border">
          <Skeleton className="size-6 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )

  const statusMeta = (s: string) => {
    switch (s) {
      case 'ok': return { label: 'Configurado', dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }
      case 'warning': return { label: 'Parcial', dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
      case 'error': return { label: 'Error', dot: 'bg-rose-500', badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' }
      default: return { label: 'No configurado', dot: 'bg-slate-400', badge: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
    }
  }

  const iconFor = (name: string) => {
    if (name.includes('llm_chatgpt')) return '🤖'
    if (name.includes('llm_xai')) return '🧠'
    if (name.includes('llm_ollama')) return '🖥️'
    if (name.includes('llm_zai')) return '⚡'
    if (name.includes('woocommerce')) return '🛒'
    if (name.includes('shopify')) return '🅢'
    if (name.includes('supabase')) return '🔌'
    if (name.includes('oracle')) return '🗄️'
    if (name.includes('dropi')) return '🚚'
    if (name.includes('99envios')) return '📦'
    if (name.includes('aveonline')) return '✈️'
    if (name.includes('whatsapp')) return '💬'
    if (name.includes('meta')) return '📩'
    if (name.includes('nocodb')) return '📊'
    if (name === 'database') return '🗄️'
    if (name === 'tenants') return '🏢'
    return '🔧'
  }

  return (
    <div className="space-y-1.5">
      {checks.map((c) => {
        const meta = statusMeta(c.status)
        return (
          <div key={c.name} className="flex items-center gap-3 p-2.5 rounded-lg border">
            <span className="text-lg" aria-hidden>{iconFor(c.name)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground truncate">{c.detail}</div>
            </div>
            <Badge variant="outline" className={cn('text-[10px] gap-1', meta.badge)}>
              <span className={cn('size-1.5 rounded-full', meta.dot)} /> {meta.label}
            </Badge>
          </div>
        )
      })}
    </div>
  )
}
