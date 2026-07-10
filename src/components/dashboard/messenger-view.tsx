'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { timeAgo, shortTime, formatCurrency } from '@/lib/format'
import { getSocket } from '@/lib/socket'
import { toast } from 'sonner'
import { useTenantId } from '@/hooks/use-tenant'
import {
  MessageCircle, Send, Sparkles, Phone, MapPin, Tag, Bot, User, Search,
  CircleDot, ArrowRight, ShoppingCart,
} from 'lucide-react'

type ConvListItem = {
  id: string; status: string; priority: string; unreadCount: number; lastMessageAt: string
  utm?: string; sourceAdId?: string; sourceCampaign?: string
  customer: { id: string; name: string; phone?: string; psid?: string; country?: string }
  channel: { id: string; type: string; displayName: string; paymentStrategy: string }
  assignee: { id: string; name: string } | null
  lastMessage: { body: string; direction: string; createdAt: string } | null
}

type ConvDetail = {
  id: string; status: string; priority: string
  customer: { id: string; name: string; phone?: string; country?: string; city?: string; address?: string; tags?: string }
  channel: { id: string; type: string; displayName: string; paymentStrategy: string; prepayDiscountPct?: number; codFee?: number; requirePrepayMin?: number }
  assignee: { id: string; name: string } | null
  messages: { id: string; direction: string; body: string; type: string; createdAt: string; aiSuggested?: boolean }[]
  orders: { id: string; number: string; status: string; paymentMode: string; total: number; currency: string; items: { name: string; quantity: number }[] }[]
}

const channelMeta = (type: string) => {
  switch (type) {
    case 'whatsapp': return { color: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20', dot: 'bg-emerald-500', label: 'WhatsApp' }
    case 'messenger': return { color: 'bg-sky-500/10 text-sky-600 ring-sky-500/20', dot: 'bg-sky-500', label: 'Messenger' }
    case 'instagram': return { color: 'bg-fuchsia-500/10 text-fuchsia-600 ring-fuchsia-500/20', dot: 'bg-fuchsia-500', label: 'Instagram' }
    default: return { color: 'bg-slate-500/10 text-slate-600 ring-slate-500/20', dot: 'bg-slate-500', label: type }
  }
}

const statusMeta = (s: string) => {
  switch (s) {
    case 'open': return { label: 'Abierta', cls: 'bg-sky-500/10 text-sky-600' }
    case 'pending': return { label: 'Pendiente', cls: 'bg-amber-500/10 text-amber-600' }
    case 'resolved': return { label: 'Resuelta', cls: 'bg-emerald-500/10 text-emerald-600' }
    case 'closed': return { label: 'Cerrada', cls: 'bg-slate-500/10 text-slate-600' }
    default: return { label: s, cls: 'bg-slate-500/10 text-slate-600' }
  }
}

export function MessengerView() {
  const tenantId = useTenantId()
  const [convs, setConvs] = useState<ConvListItem[]>([])
  const [active, setActive] = useState<ConvDetail | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'pending'>('all')
  const [channelFilter, setChannelFilter] = useState('all')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  const loadConvs = useCallback(async () => {
    if (!tenantId) return
    const res = await fetch(`/api/conversations?status=${filter}&channel=${channelFilter}&q=${encodeURIComponent(q)}&tenantId=${tenantId}`)
    const data = await res.json()
    setConvs(data.conversations || [])
    setLoading(false)
  }, [filter, channelFilter, q, tenantId])

  useEffect(() => { loadConvs() }, [loadConvs])

  // Open conversation
  const openConv = useCallback(async (id: string) => {
    setActiveId(id)
    const res = await fetch(`/api/conversations/${id}`)
    const data = await res.json()
    setActive(data.conversation)
    setConvs(prev => prev.map(c => c.id === id ? { ...c, unreadCount: 0 } : c))
  }, [])

  // Socket.io live updates
  useEffect(() => {
    const socket = getSocket()
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('message:new', (msg: { conversationId: string; direction: string; body: string; timestamp: string }) => {
      // Append to active thread if matches
      setActive(prev => {
        if (!prev || prev.id !== msg.conversationId) return prev
        return {
          ...prev,
          messages: [...prev.messages, {
            id: `live-${Date.now()}`, direction: msg.direction, body: msg.body, type: 'text', createdAt: msg.timestamp,
          }],
        }
      })
      // Bump list preview
      setConvs(prev => prev.map(c => c.id === msg.conversationId ? {
        ...c,
        lastMessage: { body: msg.body, direction: msg.direction, createdAt: msg.timestamp },
        lastMessageAt: msg.timestamp,
        unreadCount: c.id === activeId ? 0 : c.unreadCount + 1,
      } : c))
    })
    return () => { socket.off('message:new'); socket.off('connect'); socket.off('disconnect') }
  }, [activeId])

  // Auto-scroll thread
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [active?.messages.length])

  const send = async () => {
    if (!draft.trim() || !activeId) return
    const text = draft.trim()
    setDraft('')
    // Optimistic append
    setActive(prev => prev ? {
      ...prev,
      messages: [...prev.messages, { id: `opt-${Date.now()}`, direction: 'outbound', body: text, type: 'text', createdAt: new Date().toISOString() }],
    } : prev)
    // Persist via API
    await fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, conversationId: activeId, body: text }),
    })
    // Broadcast via socket for other dashboards + simulated customer reply
    getSocket().emit('message:sent', { conversationId: activeId, body: text, agentName: 'Valentina' })
  }

  const aiSuggest = async (agentName: string = 'speech') => {
    if (!activeId || !tenantId) return
    setAiLoading(true)
    try {
      // Use the 10-agent system if agentName is specified, else fallback to generic ai-reply
      const endpoint = agentName && agentName !== 'generic' ? `/api/agents/${agentName}` : '/api/ai-reply'
      const body = agentName && agentName !== 'generic'
        ? { tenantId, conversationId: activeId, customerId: active?.customer.id, perfil: (active as any)?.perfilConversacion || (active?.customer as any)?.perfilDetectado }
        : { conversationId: activeId }
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.reply) setDraft(data.reply)
      if (data.confidence < 0.5) toast.info('Respuesta de respaldo (IA no disponible — fallback determinístico)')
      else toast.success(`Agente "${agentName}" generó sugerencia`)
    } catch {
      toast.error('No se pudo generar la sugerencia')
    } finally {
      setAiLoading(false)
    }
  }

  const updateStatus = async (status: string) => {
    if (!activeId) return
    await fetch(`/api/conversations/${activeId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setActive(prev => prev ? { ...prev, status } : prev)
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, status } : c))
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_300px] gap-4 min-h-[calc(100vh-13rem)] animate-fade-in-up">
      {/* Conversation list */}
      <Card className="flex flex-col overflow-hidden">
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente..." className="pl-8 h-9" />
          </div>
          <div className="flex gap-2">
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Canal" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los canales</SelectItem>
                <SelectItem value="ch-wa-co">WhatsApp CO</SelectItem>
                <SelectItem value="ch-wa-mx">WhatsApp MX</SelectItem>
                <SelectItem value="ch-msg-global">Messenger</SelectItem>
                <SelectItem value="ch-ig-global">Instagram</SelectItem>
              </SelectContent>
            </Select>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs px-2 h-7">Todas</TabsTrigger>
                <TabsTrigger value="open" className="text-xs px-2 h-7">Abiertas</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <CircleDot className={cn('size-3', connected ? 'text-emerald-500' : 'text-slate-400')} />
            <span className="text-muted-foreground">{connected ? 'Tiempo real conectado' : 'Conectando socket...'}</span>
          </div>
        </div>
        <ScrollArea className="flex-1 scroll-thin">
          {loading ? (
            <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : convs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sin conversaciones</div>
          ) : (
            convs.map((c) => {
              const cm = channelMeta(c.channel.type)
              const sm = statusMeta(c.status)
              const isActive = c.id === activeId
              return (
                <button
                  key={c.id}
                  onClick={() => openConv(c.id)}
                  className={cn(
                    'w-full text-left px-3 py-3 border-b hover:bg-muted/50 transition-colors flex gap-3',
                    isActive && 'bg-primary/5 border-l-2 border-l-primary'
                  )}
                >
                  <Avatar className="size-10 rounded-full ring-1 ring-border">
                    <AvatarFallback className={cn('text-xs font-medium', cm.color)}>
                      {c.customer.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{c.customer.name}</span>
                      <span className={cn('size-1.5 rounded-full shrink-0', cm.dot)} />
                      <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(c.lastMessageAt)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded ring-1', cm.color)}>{cm.label}</span>
                      {c.customer.country && <span className="text-[10px] text-muted-foreground">{c.customer.country}</span>}
                      {c.priority === 'urgent' && <Badge variant="destructive" className="text-[9px] h-4 px-1">URGENTE</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {c.lastMessage?.direction === 'outbound' && 'Tú: '}
                      {c.lastMessage?.body || 'Sin mensajes'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', sm.cls)}>{sm.label}</span>
                      {c.unreadCount > 0 && <span className="ml-auto size-4 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">{c.unreadCount}</span>}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </ScrollArea>
      </Card>

      {/* Thread */}
      <Card className="flex flex-col overflow-hidden">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <MessageCircle className="size-12 opacity-30" />
            <p className="text-sm">Selecciona una conversación para empezar</p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="p-3 border-b flex items-center gap-3">
              <Avatar className="size-9 rounded-full">
                <AvatarFallback className={cn('text-xs', channelMeta(active.channel.type).color)}>
                  {active.customer.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{active.customer.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded ring-1', channelMeta(active.channel.type).color)}>{active.channel.displayName}</span>
                  {active.customer.phone && <span>· {active.customer.phone}</span>}
                </div>
              </div>
              <Select value={active.status} onValueChange={updateStatus}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Abierta</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="resolved">Resuelta</SelectItem>
                  <SelectItem value="closed">Cerrada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Messages */}
            <div ref={threadRef} className="flex-1 overflow-y-visible p-4 space-y-3 bg-muted/20">
              {active.messages.map((m) => {
                const isOut = m.direction === 'outbound'
                return (
                  <div key={m.id} className={cn('flex gap-2 max-w-[80%]', isOut ? 'ml-auto flex-row-reverse' : '')}>
                    {!isOut && (
                      <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="size-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-3.5 py-2 text-sm',
                      isOut ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-background border rounded-bl-md'
                    )}>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <div className={cn('text-[10px] mt-1', isOut ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                        {shortTime(m.createdAt)} {isOut && '·✓✓'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Composer */}
            <div className="p-3 border-t space-y-2">
              <div className="flex gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder="Escribe un mensaje... (Enter para enviar, Shift+Enter para salto)"
                  className="min-h-[44px] max-h-24 resize-none text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={aiLoading} className="gap-1.5">
                      <Sparkles className={cn('size-3.5', aiLoading && 'animate-pulse')} />
                      {aiLoading ? 'Generando...' : 'Agentes IA'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">10 agentes especializados (Saramantha §6)</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => aiSuggest('profile')} className="text-xs cursor-pointer">
                      <span className="font-medium">Perfilamiento</span><span className="text-muted-foreground ml-auto">mayorista/detal/...</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('speech')} className="text-xs cursor-pointer">
                      <span className="font-medium">Discurso</span><span className="text-muted-foreground ml-auto">por perfil</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('quote')} className="text-xs cursor-pointer">
                      <span className="font-medium">Cotización</span><span className="text-muted-foreground ml-auto">volumen + margen</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('catalog')} className="text-xs cursor-pointer">
                      <span className="font-medium">Catálogo</span><span className="text-muted-foreground ml-auto">visual-primero</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('theme')} className="text-xs cursor-pointer">
                      <span className="font-medium">Tema/personaje</span><span className="text-muted-foreground ml-auto">Stitch, Hello Kitty</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('objection')} className="text-xs cursor-pointer">
                      <span className="font-medium">Objeciones</span><span className="text-muted-foreground ml-auto">desconfianza, precio...</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('address')} className="text-xs cursor-pointer">
                      <span className="font-medium">Dirección</span><span className="text-muted-foreground ml-auto">10 campos</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('logistics')} className="text-xs cursor-pointer">
                      <span className="font-medium">Logística</span><span className="text-muted-foreground ml-auto">flete real</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('vision')} className="text-xs cursor-pointer">
                      <span className="font-medium">Visión</span><span className="text-muted-foreground ml-auto">SKU por imagen</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => aiSuggest('checkout')} className="text-xs cursor-pointer">
                      <span className="font-medium">Checkout</span><span className="text-muted-foreground ml-auto">resumen + confirma</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => aiSuggest('generic')} className="text-xs cursor-pointer text-muted-foreground">
                      <Sparkles className="size-3" /> Agente genérico (legacy)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">Estrategia: <strong className="text-foreground">{active.channel.paymentStrategy}</strong></span>
                  <Button size="sm" onClick={send} disabled={!draft.trim()} className="gap-1.5">
                    <Send className="size-3.5" /> Enviar
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Customer panel */}
      <Card className="hidden lg:flex flex-col overflow-hidden">
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Sin cliente</div>
        ) : (
          <ScrollArea className="flex-1 scroll-thin">
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 rounded-full">
                  <AvatarFallback className={cn('text-sm', channelMeta(active.channel.type).color)}>
                    {active.customer.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{active.customer.name}</div>
                  <div className="text-xs text-muted-foreground">{active.customer.country} · {active.customer.city}</div>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                {active.customer.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground"><Phone className="size-3.5" /> {active.customer.phone}</div>
                )}
                {active.customer.address && (
                  <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="size-3.5 mt-0.5" /> {active.customer.address}</div>
                )}
                {active.customer.tags && (
                  <div className="flex items-start gap-2 text-muted-foreground"><Tag className="size-3.5 mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                      {active.customer.tags.split(',').map((t) => <Badge key={t} variant="secondary" className="text-[10px] h-4">{t}</Badge>)}
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Atribución</div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Campaña</span><span className="font-medium text-right">{(active as any).sourceCampaign || 'Orgánico'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Canal</span><span className="font-medium">{active.channel.displayName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Estrategia pago</span>
                    <Badge variant="outline" className="text-[10px] h-4">{active.channel.paymentStrategy}</Badge>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><ShoppingCart className="size-3.5" /> Pedidos del cliente</div>
                {active.orders.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin pedidos aún</p>
                ) : (
                  <div className="space-y-2">
                    {active.orders.map((o) => (
                      <div key={o.id} className="p-2 rounded-lg border text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-medium">{o.number}</span>
                          <span className="font-semibold">{formatCurrency(o.total, o.currency)}</span>
                        </div>
                        <div className="text-muted-foreground mt-0.5">{o.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge variant="secondary" className="text-[9px] h-3.5">{o.status}</Badge>
                          <Badge variant="outline" className="text-[9px] h-3.5">{o.paymentMode === 'cod' ? 'Contra entrega' : 'Anticipado'}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div className="p-3 rounded-lg bg-primary/5 border border-primary/15 flex gap-2 text-xs">
                <Bot className="size-4 text-primary shrink-0 mt-0.5" />
                <p className="text-muted-foreground">
                  {active.channel.paymentStrategy === 'advance' && 'Canal exige pago anticipado. Ofrece descuento y envía link del carrito.'}
                  {active.channel.paymentStrategy === 'cod' && 'Canal solo contra entrega. Confirma dirección y ciudad antes de cerrar.'}
                  {active.channel.paymentStrategy === 'hybrid' && `Híbrido: pedidos > ${formatCurrency(active.channel.requirePrepayMin || 0)} recomienda prepay (${active.channel.prepayDiscountPct || 0}% off).`}
                </p>
              </div>

              <Button variant="outline" size="sm" className="w-full gap-1.5">
                <ArrowRight className="size-3.5" /> Crear pedido desde chat
              </Button>
            </div>
          </ScrollArea>
        )}
      </Card>
    </div>
  )
}
