'use client'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, MessagesSquare, ShoppingCart, Target, Settings, Zap, DollarSign, Plug, KanbanSquare, Workflow, Grid3x3,
} from 'lucide-react'

export type ViewId = 'overview' | 'messenger' | 'catalog' | 'orders' | 'kanban' | 'orchestrator' | 'ads' | 'monetization' | 'integrations' | 'settings'

export const NAV_ITEMS: { id: ViewId; label: string; icon: typeof LayoutDashboard; hint: string }[] = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard, hint: 'KPIs · ROAS · CPA' },
  { id: 'messenger', label: 'Mensajería', icon: MessagesSquare, hint: 'WhatsApp · Messenger · IG' },
  { id: 'catalog', label: 'Catálogo Visual', icon: Grid3x3, hint: 'Ver + chatear con IA' },
  { id: 'orders', label: 'Pedidos & Pagos', icon: ShoppingCart, hint: 'Anticipado · Contra entrega' },
  { id: 'kanban', label: 'Kanban operativo', icon: KanbanSquare, hint: 'NocoDB · §10' },
  { id: 'orchestrator', label: 'Orquestador', icon: Workflow, hint: '9 agentes · §12' },
  { id: 'ads', label: 'Atribución de Pauta', icon: Target, hint: 'CPA · ROAS · ROI' },
  { id: 'monetization', label: 'Monetización', icon: DollarSign, hint: 'Comisión sobre GMV' },
  { id: 'integrations', label: 'Catálogo e Integraciones', icon: Plug, hint: 'Shopify · Woo · Dropi' },
  { id: 'settings', label: 'Configuración', icon: Settings, hint: 'Estrategia de pago' },
]

export function Sidebar({ active, onChange, badges }: {
  active: ViewId
  onChange: (v: ViewId) => void
  badges: Partial<Record<ViewId, number>>
}) {
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="h-16 flex items-center gap-3 px-5 border-b border-sidebar-border">
        <div className="size-9 rounded-xl bg-primary/20 ring-1 ring-primary/30 flex items-center justify-center">
          <Zap className="size-5 text-primary" />
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-sm">CommerceFlow OS</div>
          <div className="text-[11px] text-sidebar-foreground/60">Conversational Commerce</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scroll-thin">
        <div className="px-2 pb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-medium">Operación</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          const badge = badges[item.id]
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={cn(
                'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all group',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <Icon className={cn('size-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground')} />
              <div className="flex-1 text-left">
                <div className="font-medium leading-tight">{item.label}</div>
                <div className={cn('text-[10px] leading-tight', isActive ? 'text-primary-foreground/70' : 'text-sidebar-foreground/45')}>{item.hint}</div>
              </div>
              {badge != null && badge > 0 && (
                <span className={cn(
                  'min-w-5 h-5 px-1.5 rounded-full text-[10px] font-semibold flex items-center justify-center',
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/20 text-primary'
                )}>{badge}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="px-4 py-3 border-t border-sidebar-border text-[11px] text-sidebar-foreground/50 space-y-1">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>API · DB · Socket.io conectados</span>
        </div>
        <div>v1.0 · Bogotá · LATAM+EU</div>
      </div>
    </aside>
  )
}
