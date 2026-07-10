'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  CreditCard, Truck, Percent, Save, Shield, Zap, Globe, KeyRound, Bot,
} from 'lucide-react'

type ChannelCfg = {
  id: string; type: string; name: string; displayName: string; country?: string | null
  paymentStrategy: string; requirePrepayMin?: number | null
  prepayDiscountPct?: number | null; codFee?: number | null
}

type GlobalCfg = Record<string, string>

const channelMeta = (type: string) => {
  switch (type) {
    case 'whatsapp': return { color: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20', label: 'WhatsApp' }
    case 'messenger': return { color: 'bg-sky-500/10 text-sky-600 ring-sky-500/20', label: 'Messenger' }
    case 'instagram': return { color: 'bg-fuchsia-500/10 text-fuchsia-600 ring-fuchsia-500/20', label: 'Instagram' }
    default: return { color: 'bg-slate-500/10 text-slate-600 ring-slate-500/20', label: type }
  }
}

export function SettingsView() {
  const [channels, setChannels] = useState<ChannelCfg[]>([])
  const [global, setGlobal] = useState<GlobalCfg>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [autoKill, setAutoKill] = useState(true)
  const [aiReplies, setAiReplies] = useState(true)

  useEffect(() => {
    fetch('/api/payments/config').then(r => r.json()).then(d => {
      setChannels(d.channels || [])
      setGlobal(d.global || {})
      setLoading(false)
    })
  }, [])

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

  if (loading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Channel payment strategy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><CreditCard className="size-4 text-primary" /> Estrategia de pago por canal</CardTitle>
          <CardDescription>Define anticipado, contra entrega o híbrido para cada canal y país</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {channels.map((ch) => {
            const cm = channelMeta(ch.type)
            return (
              <div key={ch.id} className="p-4 rounded-xl border space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className={cn('size-9 rounded-lg flex items-center justify-center ring-1 text-xs font-medium', cm.color)}>
                      {ch.country || '🌍'}
                    </span>
                    <div>
                      <div className="font-medium text-sm">{ch.displayName}</div>
                      <div className="text-xs text-muted-foreground">{ch.name} · {ch.country || 'Internacional'}</div>
                    </div>
                  </div>
                  <Select value={ch.paymentStrategy} onValueChange={(v) => updateChannel(ch.id, 'paymentStrategy', v)}>
                    <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="advance"><span className="flex items-center gap-2"><CreditCard className="size-3.5" /> Anticipado</span></SelectItem>
                      <SelectItem value="cod"><span className="flex items-center gap-2"><Truck className="size-3.5" /> Contra entrega</span></SelectItem>
                      <SelectItem value="hybrid"><span className="flex items-center gap-2"><Percent className="size-3.5" /> Híbrido</span></SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Mín. para prepago (híbrido)</Label>
                    <Input
                      type="number"
                      value={ch.requirePrepayMin ?? ''}
                      onChange={(e) => updateChannel(ch.id, 'requirePrepayMin', Number(e.target.value))}
                      placeholder="Ej. 250000"
                      disabled={ch.paymentStrategy !== 'hybrid'}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">% descuento prepago</Label>
                    <Input
                      type="number" step="0.5"
                      value={ch.prepayDiscountPct ?? ''}
                      onChange={(e) => updateChannel(ch.id, 'prepayDiscountPct', Number(e.target.value))}
                      placeholder="Ej. 5"
                      disabled={ch.paymentStrategy === 'cod'}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Recargo envío COD</Label>
                    <Input
                      type="number"
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
                  <Button size="sm" variant="outline" onClick={() => saveChannel(ch.id)} disabled={saving === ch.id} className="gap-1.5">
                    <Save className="size-3.5" /> {saving === ch.id ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">ROAS mínimo (auto-pausa)</Label>
                <Input type="number" step="0.1" value={global.roas_kill_threshold || ''} onChange={(e) => setGlobal({ ...global, roas_kill_threshold: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">CPA objetivo (COP)</Label>
                <Input type="number" value={global.cpa_target || ''} onChange={(e) => setGlobal({ ...global, cpa_target: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Valor máx. para COD (COP)</Label>
                <Input type="number" value={global.cod_max_order_value || ''} onChange={(e) => setGlobal({ ...global, cod_max_order_value: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Moneda por defecto</Label>
                <Select value={global.default_currency || 'COP'} onValueChange={(v) => setGlobal({ ...global, default_currency: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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
            <Button onClick={saveGlobal} disabled={saving === 'global'} className="gap-1.5">
              <Save className="size-3.5" /> {saving === 'global' ? 'Guardando...' : 'Guardar umbrales'}
            </Button>
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
    </div>
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

  if (loading) return <div className="text-sm text-muted-foreground">Cargando estado de integraciones...</div>

  const statusMeta = (s: string) => {
    switch (s) {
      case 'ok': return { label: 'Configurado', dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-600' }
      case 'warning': return { label: 'Parcial', dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-600' }
      case 'error': return { label: 'Error', dot: 'bg-rose-500', badge: 'bg-rose-500/10 text-rose-600' }
      default: return { label: 'No configurado', dot: 'bg-slate-400', badge: 'bg-slate-500/10 text-slate-500' }
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
            <span className="text-lg">{iconFor(c.name)}</span>
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
