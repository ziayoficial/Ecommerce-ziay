'use client'
import { useCallback, useEffect, useState } from 'react'
import { Sidebar, ViewId, NAV_ITEMS } from '@/components/dashboard/sidebar'
import { Topbar } from '@/components/dashboard/topbar'
import { OverviewView } from '@/components/dashboard/overview-view'
import { MessengerView } from '@/components/dashboard/messenger-view'
import { CatalogVisualView } from '@/components/dashboard/catalog-visual-view'
import { OrdersView } from '@/components/dashboard/orders-view'
import { KanbanView } from '@/components/dashboard/kanban-view'
import { OrchestratorView } from '@/components/dashboard/orchestrator-view'
import { AdsView } from '@/components/dashboard/ads-view'
import { MonetizationView } from '@/components/dashboard/monetization-view'
import { WalletView } from '@/components/dashboard/wallet-view'
import { LogisticsIntelligenceView } from '@/components/dashboard/logistics-intelligence-view'
import { MarketplaceView } from '@/components/dashboard/marketplace-view'
import { NovedadesView } from '@/components/dashboard/novedades-view'
import { IntegrationsView } from '@/components/dashboard/integrations-view'
import { SettingsView } from '@/components/dashboard/settings-view'
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from '@/components/ui/command'
import { Zap, Github, BookOpen, LayoutDashboard, Search } from 'lucide-react'

export default function Home() {
  const [view, setView] = useState<ViewId>('overview')
  const [country, setCountry] = useState('ALL')
  const [searchOpen, setSearchOpen] = useState(false)

  const badges: Partial<Record<ViewId, number>> = {
    messenger: 3,
    ads: 2,
  }

  // ───────────────────────────────────────────────────────────────────────
  // Global keyboard shortcuts:
  //   Cmd+K / Ctrl+K → open command palette (search + navigation)
  //   1-9            → jump to the nth nav item (numeric shortcuts)
  //   ?              → also opens the palette (helps discoverability)
  // We ignore shortcuts while the user is typing in a form field so they
  // don't hijack legitimate input (e.g. typing "1" in a search box).
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const isEditing =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        target?.isContentEditable ||
        (target as HTMLElement | null)?.getAttribute('role') === 'combobox'

      // Cmd/Ctrl + K always opens palette (even in inputs — common UX).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
        return
      }

      if (isEditing || e.metaKey || e.ctrlKey || e.altKey) return

      // "?" opens palette as a discovery aid.
      if (e.key === '?') {
        e.preventDefault()
        setSearchOpen(true)
        return
      }

      // Numeric 1-9 → first 9 nav items.
      const n = parseInt(e.key, 10)
      if (!Number.isNaN(n) && n >= 1 && n <= 9) {
        const item = NAV_ITEMS[n - 1]
        if (item) {
          e.preventDefault()
          setView(item.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSelectView = useCallback((v: ViewId) => {
    setView(v)
    setSearchOpen(false)
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={view} onChange={setView} badges={badges} />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar
            active={view}
            country={country}
            onCountryChange={setCountry}
            onChangeView={setView}
            onOpenSearch={() => setSearchOpen(true)}
            badges={badges}
          />
          <main className="flex-1 overflow-y-auto scroll-thin">
            <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
              {view === 'overview' && <OverviewView />}
              {view === 'messenger' && <MessengerView />}
              {view === 'catalog' && <CatalogVisualView />}
              {view === 'orders' && <OrdersView />}
              {view === 'kanban' && <KanbanView />}
              {view === 'orchestrator' && <OrchestratorView />}
              {view === 'ads' && <AdsView />}
              {view === 'monetization' && <MonetizationView />}
              {view === 'wallet' && <WalletView />}
              {view === 'logistics' && <LogisticsIntelligenceView />}
              {view === 'marketplace' && <MarketplaceView />}
              {view === 'novedades' && <NovedadesView />}
              {view === 'integrations' && <IntegrationsView />}
              {view === 'settings' && <SettingsView />}
            </div>
          </main>
        </div>
      </div>

      <footer className="shrink-0 border-t bg-background">
        <div className="px-4 md:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="size-5 rounded-md bg-primary/15 ring-1 ring-primary/25 flex items-center justify-center">
                <Zap className="size-3 text-primary" />
              </div>
              <span className="font-medium text-foreground">CommerceFlow OS</span>
            </div>
            <span className="hidden sm:inline">·</span>
            <span>Conversational Commerce + Ad Attribution</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden md:inline flex items-center gap-1.5">
              <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">⌘K</kbd>
              <span>para buscar y navegar</span>
            </span>
            <span className="hidden md:inline">Stack: Next.js 16 · Prisma · Socket.io · LLM</span>
            <a href="#" className="flex items-center gap-1 hover:text-foreground transition-colors">
              <BookOpen className="size-3.5" /> Docs
            </a>
            <a href="#" className="flex items-center gap-1 hover:text-foreground transition-colors">
              <Github className="size-3.5" /> Repo
            </a>
          </div>
        </div>
      </footer>

      {/* ── Global command palette (Cmd+K / Ctrl+K) ── */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} title="Búsqueda y navegación" description="Salta a cualquier vista o busca pedidos, clientes y anuncios.">
        <CommandInput placeholder="Escribe una vista o búsqueda…" autoFocus />
        <CommandList>
          <CommandEmpty>No hay resultados.</CommandEmpty>
          <CommandGroup heading="Navegación">
            {NAV_ITEMS.map((item, idx) => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.hint}`}
                  onSelect={() => handleSelectView(item.id)}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground ml-1">· {item.hint}</span>
                  {idx < 9 && <CommandShortcut>{idx + 1}</CommandShortcut>}
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Atajos">
            <CommandItem disabled>
              <Search className="size-4 text-muted-foreground" />
              <span>Abrir/cerrar paleta</span>
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
            <CommandItem disabled>
              <LayoutDashboard className="size-4 text-muted-foreground" />
              <span>Navegar con teclas 1-9</span>
              <CommandShortcut>1…9</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  )
}
