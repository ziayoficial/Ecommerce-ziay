'use client'
import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenantId } from '@/hooks/use-tenant'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { t } from '@/lib/i18n'
import { formatCurrency, timeAgo } from '@/lib/format'
import { Search, Sparkles, MessageSquare, X, Filter, Grid3x3, List, Send, Zap, Tag, Package, Eye, Bot, RefreshCw, AlertCircle } from 'lucide-react'

type Product = {
  id: string; sku: string; name: string; description: string | null
  price: number; cost: number; imageUrl: string | null; stock: number
  diseno: string | null; categoria: string | null
  imagenMetadataVisible: boolean; fuenteSincronizacion: string | null
}
type Conversation = {
  id: string; status: string
  customer: { id: string; name: string; phone?: string; country?: string }
  channel: { id: string; type: string; displayName: string }
  lastMessage: { body: string; direction: string; createdAt: string } | null
}

export function CatalogVisualView() {
  const tenantId = useTenantId()
  const [products, setProducts] = useState<Product[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [q, setQ] = useState('')
  const [filterDiseno, setFilterDiseno] = useState('all')
  const [filterCategoria, setFilterCategoria] = useState('all')
  const [sortBy, setSortBy] = useState<'name' | 'price-asc' | 'price-desc'>('name')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [chatHistory, setChatHistory] = useState<{ role: 'agent' | 'user'; text: string }[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [selectedConversacion, setSelectedConversacion] = useState<string>('')

  const load = useCallback((showRefreshing = false) => {
    if (!tenantId) return
    let cancelled = false
    if (showRefreshing) setRefreshing(true)
    setError(null)
    Promise.all([
      fetch(`/api/catalog/products?tenantId=${tenantId}&q=${encodeURIComponent(q)}`).then(r => r.json()),
      fetch(`/api/conversations?tenantId=${tenantId}&status=open`).then(r => r.json()),
    ]).then(([p, c]) => {
      if (cancelled) return
      setProducts(p.products || [])
      setConversations(c.conversations || [])
      setLastUpdated(new Date())
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setError('No se pudo cargar el catálogo. Verifica tu conexión o intenta de nuevo.')
        setLoading(false)
      }
    }).finally(() => {
      if (!cancelled) setRefreshing(false)
    })
    return () => { cancelled = true }
  }, [tenantId, q])

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    Promise.all([
      fetch(`/api/catalog/products?tenantId=${tenantId}&q=${encodeURIComponent(q)}`).then(r => r.json()),
      fetch(`/api/conversations?tenantId=${tenantId}&status=open`).then(r => r.json()),
    ]).then(([p, c]) => {
      if (cancelled) return
      setProducts(p.products || [])
      setConversations(c.conversations || [])
      setLastUpdated(new Date())
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setError('No se pudo cargar el catálogo. Verifica tu conexión o intenta de nuevo.')
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [tenantId, q])

  const filtered = products
    .filter(p => filterDiseno === 'all' || (p.diseno || 'liso') === filterDiseno)
    .filter(p => filterCategoria === 'all' || (p.categoria || '') === filterCategoria)
    .sort((a, b) => {
      if (sortBy === 'price-asc') return a.price - b.price
      if (sortBy === 'price-desc') return b.price - a.price
      return a.name.localeCompare(b.name)
    })

  const disenos = ['all', ...new Set(products.map(p => p.diseno || 'liso'))]
  const categorias = ['all', ...new Set(products.map(p => p.categoria || '').filter(Boolean))]

  const openProduct = (p: Product) => { setSelectedProduct(p); setChatOpen(true); setChatHistory([]); setChatMessage('') }

  const askAgent = async (agentName: string = 'catalog') => {
    if (!selectedProduct || !tenantId) return
    setAiLoading(true)
    try {
      const res = await fetch(`/api/agents/${agentName}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, query: selectedProduct.name, items: [{ sku: selectedProduct.sku, cantidad: 1 }] }),
      })
      const data = await res.json()
      if (data.reply) setChatHistory(prev => [...prev, { role: 'agent', text: data.reply }])
    } catch { toast.error('No se pudo generar la respuesta') }
    finally { setAiLoading(false) }
  }

  const sendMessage = () => {
    if (!chatMessage.trim()) return
    setChatHistory(prev => [...prev, { role: 'user', text: chatMessage }])
    setChatMessage('')
    setTimeout(() => askAgent('catalog'), 500)
  }

  const sendToConversation = async () => {
    if (!selectedProduct || !selectedConversacion || !tenantId) return
    try {
      const res = await fetch('/api/catalog/send-to-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, conversationId: selectedConversacion, sku: selectedProduct.sku }),
      })
      const data = await res.json()
      if (data.message) { toast.success('Producto enviado a la conversacion'); setSendDialogOpen(false) }
    } catch { toast.error('No se pudo enviar el producto') }
  }

  if (error) {
    return (
      <section aria-label="Catálogo visual">
        <Alert variant="destructive" className="animate-fade-in-up" role="alert">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar el catálogo</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => load(true)} className="gap-1.5">
              <RefreshCw className="size-3.5" /> Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  if (loading) return (
    <section aria-label="Catálogo visual" className="space-y-4" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
    </section>
  )

  return (
    <section aria-label="Catálogo visual" className="space-y-4 animate-fade-in-up">
      {/* Header: last-updated + refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] sm:text-xs text-foreground/70 truncate">
          {lastUpdated ? (
            <span>Actualizado hace <strong className="text-foreground tabular-nums font-medium">{timeAgo(lastUpdated.toISOString())}</strong></span>
          ) : (
            <span>Datos de muestra</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5 h-9 px-3" aria-label={t('common.refresh')}>
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          {refreshing ? t('common.refreshing') : t('common.refresh')}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Grid3x3 className="size-4 text-primary" /> Catalogo Visual Interactivo</CardTitle>
              <CardDescription>{filtered.length} de {products.length} productos - clic para ver detalle + chatear con IA</CardDescription>
            </div>
            <div className="flex rounded-lg border overflow-hidden" role="group" aria-label="Modo de vista">
              <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('grid')} className="rounded-none px-2.5" aria-label="Vista de cuadrícula" aria-pressed={viewMode === 'grid'}><Grid3x3 className="size-3.5" /></Button>
              <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('list')} className="rounded-none px-2.5" aria-label="Vista de lista" aria-pressed={viewMode === 'list'}><List className="size-3.5" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder_product')} className="pl-8 h-9" />
            </div>
            <Select value={filterDiseno} onValueChange={setFilterDiseno}>
              <SelectTrigger className="h-9 w-36"><Filter className="size-3.5 mr-1" /><SelectValue placeholder="Diseno" /></SelectTrigger>
              <SelectContent>{disenos.map(d => <SelectItem key={d} value={d}>{d === 'all' ? 'Todos los disenos' : d}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterCategoria} onValueChange={setFilterCategoria}>
              <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>{categorias.map(c => <SelectItem key={c} value={c}>{c === 'all' ? 'Todas' : c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Nombre</SelectItem>
                <SelectItem value="price-asc">Precio: Menor a Mayor</SelectItem>
                <SelectItem value="price-desc">Precio: Mayor a Menor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(filterDiseno !== 'all' || filterCategoria !== 'all' || q) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {q && <Badge variant="secondary" className="gap-1 text-xs">Busqueda: "{q}" <X className="size-2.5 cursor-pointer" aria-hidden onClick={() => setQ('')} /></Badge>}
              {filterDiseno !== 'all' && <Badge variant="secondary" className="gap-1 text-xs">Diseno: {filterDiseno} <X className="size-2.5 cursor-pointer" aria-hidden onClick={() => setFilterDiseno('all')} /></Badge>}
              {filterCategoria !== 'all' && <Badge variant="secondary" className="gap-1 text-xs">Categoria: {filterCategoria} <X className="size-2.5 cursor-pointer" aria-hidden onClick={() => setFilterCategoria('all')} /></Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card><CardContent className="p-12 text-center">
          <Package className="size-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Sin productos con estos filtros</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setQ(''); setFilterDiseno('all'); setFilterCategoria('all') }}>Limpiar filtros</Button>
        </CardContent></Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`Ver producto ${p.name}`}
              className="rounded-xl border overflow-hidden cursor-pointer hover:shadow-lg hover:border-primary/30 transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openProduct(p)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProduct(p) } }}
            >
              <div className="aspect-square bg-muted relative overflow-hidden">
                {p.imageUrl ? <Image src={p.imageUrl} alt={p.name} fill sizes="256px" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Package className="size-8" /></div>}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100" aria-hidden>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" className="h-8 w-8 p-0 rounded-full pointer-events-none" aria-label="Ver producto" tabIndex={-1}><Eye className="size-3.5" /></Button>
                    <Button size="sm" variant="secondary" className="h-8 w-8 p-0 rounded-full pointer-events-none" aria-label="Enviar a chat" tabIndex={-1}><MessageSquare className="size-3.5" /></Button>
                  </div>
                </div>
                {p.imagenMetadataVisible && <Badge variant="secondary" className="absolute top-1.5 right-1.5 text-[9px] h-4 gap-0.5 bg-white/90"><Sparkles className="size-2.5" aria-hidden /> Metadata</Badge>}
                {p.stock <= 0 && <Badge variant="destructive" className="absolute bottom-1.5 right-1.5 text-[9px]">Agotado</Badge>}
              </div>
              <div className="p-2.5 space-y-1">
                <div className="font-medium text-xs truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">{p.sku}</div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold tabular-nums">{formatCurrency(p.price)}</span>
                  <Badge variant="outline" className="text-[9px] h-4">{p.diseno || 'liso'}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card><CardContent className="p-0"><div className="divide-y">
          {filtered.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`Ver producto ${p.name}`}
              className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openProduct(p)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProduct(p) } }}
            >
              <div className="size-14 rounded-lg overflow-hidden bg-muted shrink-0 relative">
                {p.imageUrl ? <Image src={p.imageUrl} alt={p.name} fill sizes="56px" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Package className="size-5 text-muted-foreground" /></div>}
              </div>
              <div className="flex-1 min-w-0"><div className="font-medium text-sm truncate">{p.name}</div><div className="text-xs text-muted-foreground font-mono">{p.sku}</div></div>
              <Badge variant="outline" className="text-[10px]">{p.diseno || 'liso'}</Badge>
              <span className="text-sm font-bold tabular-nums w-24 text-right">{formatCurrency(p.price)}</span>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 pointer-events-none" aria-label="Enviar a chat" tabIndex={-1}><MessageSquare className="size-3.5" /></Button>
            </div>
          ))}
        </div></CardContent></Card>
      )}

      {/* Product detail + chat dialog */}
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0">
          <DialogHeader className="sr-only"><DialogTitle>{selectedProduct?.name}</DialogTitle><DialogDescription>Detalle + chat IA</DialogDescription></DialogHeader>
          {selectedProduct && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] h-full max-h-[85vh]">
              {/* Left: Product */}
              <div className="flex flex-col overflow-y-auto scroll-thin">
                <div className="aspect-square bg-muted relative">
                  {selectedProduct.imageUrl ? <Image src={selectedProduct.imageUrl} alt={selectedProduct.name} fill sizes="512px" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Package className="size-12" /></div>}
                  {selectedProduct.imagenMetadataVisible && <Badge variant="secondary" className="absolute top-2 right-2 gap-0.5"><Sparkles className="size-3" /> Franja metadata</Badge>}
                </div>
                <div className="p-4 space-y-3">
                  <div><h3 className="font-semibold text-base">{selectedProduct.name}</h3><p className="text-xs text-muted-foreground font-mono">{selectedProduct.sku}</p></div>
                  {selectedProduct.description && <p className="text-sm text-muted-foreground">{selectedProduct.description}</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold tabular-nums">{formatCurrency(selectedProduct.price)}</span>
                    <Badge variant={selectedProduct.stock > 0 ? 'default' : 'destructive'}>Stock: {selectedProduct.stock}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedProduct.diseno && <Badge variant="outline" className="gap-1"><Tag className="size-3" /> {selectedProduct.diseno}</Badge>}
                    {selectedProduct.categoria && <Badge variant="outline" className="gap-1"><Package className="size-3" /> {selectedProduct.categoria}</Badge>}
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => askAgent('quote')} disabled={aiLoading} className="gap-1.5" size="sm"><Zap className="size-3.5" /> Cotizar</Button>
                    <Button onClick={() => setSendDialogOpen(true)} variant="outline" className="gap-1.5" size="sm"><Send className="size-3.5" /> Enviar a chat</Button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={() => askAgent('catalog')} variant="ghost" size="sm" className="gap-1 text-xs" disabled={aiLoading}><Bot className="size-3" /> Catalogo</Button>
                    <Button onClick={() => askAgent('theme')} variant="ghost" size="sm" className="gap-1 text-xs" disabled={aiLoading}><Tag className="size-3" /> Tema</Button>
                    <Button onClick={() => askAgent('objection')} variant="ghost" size="sm" className="gap-1 text-xs" disabled={aiLoading}><MessageSquare className="size-3" /> Objeciones</Button>
                  </div>
                </div>
              </div>
              {/* Right: Chat */}
              <div className="flex flex-col border-l bg-muted/10">
                <div className="px-4 py-3 border-b bg-background/80 backdrop-blur">
                  <div className="flex items-center gap-2">
                    <div className="size-7 rounded-full bg-primary/15 ring-1 ring-primary/25 flex items-center justify-center"><Bot className="size-3.5 text-primary" /></div>
                    <div><div className="text-sm font-medium">Asistente IA</div><div className="text-[10px] text-muted-foreground">Contexto: {selectedProduct.name}</div></div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-3 min-h-[300px]">
                  {chatHistory.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      <Bot className="size-8 mx-auto mb-2 opacity-30" />
                      Pregunta sobre este producto
                      <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
                        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setChatHistory([{ role: 'user', text: 'Tienes mas disenos?' }]); setTimeout(() => askAgent('catalog'), 300) }}>Mas disenos?</Button>
                        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setChatHistory([{ role: 'user', text: 'Cuanto cuesta el envio?' }]); setTimeout(() => askAgent('logistics'), 300) }}>Envio?</Button>
                        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setChatHistory([{ role: 'user', text: 'Cotiza 6 unidades' }]); setTimeout(() => askAgent('quote'), 300) }}>Cotiza 6</Button>
                      </div>
                    </div>
                  )}
                  {chatHistory.map((m, i) => (
                    <div key={i} className={cn('flex gap-2 max-w-[90%]', m.role === 'user' ? 'ml-auto flex-row-reverse' : '')}>
                      <div className={cn('size-6 rounded-full flex items-center justify-center shrink-0', m.role === 'user' ? 'bg-muted' : 'bg-primary/15 ring-1 ring-primary/25')}>
                        {m.role === 'user' ? <span className="text-[10px]">Tu</span> : <Bot className="size-3 text-primary" />}
                      </div>
                      <div className={cn('rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-background border')}>{m.text}</div>
                    </div>
                  ))}
                  {aiLoading && (
                    <div className="flex gap-2">
                      <div className="size-6 rounded-full bg-primary/15 ring-1 ring-primary/25 flex items-center justify-center"><Bot className="size-3 text-primary animate-pulse" /></div>
                      <div className="rounded-2xl px-3 py-2 bg-background border"><div className="flex gap-1">
                        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div></div>
                    </div>
                  )}
                </div>
                <div className="p-3 border-t bg-background">
                  <div className="flex gap-2">
                    <Input value={chatMessage} onChange={(e) => setChatMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }} placeholder="Pregunta sobre este producto..." className="h-9 text-sm" />
                    <Button size="sm" onClick={sendMessage} disabled={!chatMessage.trim() || aiLoading} className="gap-1.5" aria-label="Enviar mensaje"><Send className="size-3.5" /></Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Send to conversation */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Enviar a conversacion</DialogTitle><DialogDescription>Enviar <strong>{selectedProduct?.name}</strong> a:</DialogDescription></DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto scroll-thin">
            {conversations.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No hay conversaciones abiertas</p>
            : conversations.map(c => (
              <button key={c.id} onClick={() => { setSelectedConversacion(c.id); sendToConversation() }} className="w-full flex items-center gap-2 p-2.5 rounded-lg border hover:bg-muted/40 text-left transition-colors">
                <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">{c.customer.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}</div>
                <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{c.customer.name}</div><div className="text-xs text-muted-foreground truncate">{c.lastMessage?.body || 'Sin mensajes'}</div></div>
                <Send className="size-3.5 text-muted-foreground" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
