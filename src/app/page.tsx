'use client'
import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Sidebar, ViewId, NAV_ITEMS } from '@/components/dashboard/sidebar'
import { Topbar } from '@/components/dashboard/topbar'
// OverviewView stays eager — it's the default view rendered on first paint.
// The other 13 views are lazy-loaded via next/dynamic so recharts (~400KB),
// @dnd-kit, socket.io-client, qrcode.react, input-otp, @mdxeditor, etc. only
// ship in the chunks that actually need them. (FIX-PERFORMANCE-001)
import { OverviewView } from '@/components/dashboard/overview-view'
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from '@/components/ui/command'
import { Zap, Github, BookOpen, LayoutDashboard, Search, Loader2, AlertTriangle } from 'lucide-react'
// SPRINT-AI-FRONTEND-001 §1 — `getSocket` opens (or reuses) the singleton
// socket.io client. Used here at the dashboard top level to subscribe to
// `llm:budget_warning` events emitted by `checkBudgetBeforeCall` when the
// daily or monthly spend crosses 80%. The event is fire-and-forget from
// the backend (Sprint 10C); the dashboard shows a dismissible banner so
// the operator can react before the hard 100% block starts returning 429s.
import { getSocket } from '@/lib/socket'

// Shared loading fallback for every lazy view — small, on-brand, no JS.
const viewLoading = () => (
  <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
    <Loader2 className="size-6 animate-spin text-muted-foreground" />
    <span className="sr-only">Cargando…</span>
  </div>
)

const MessengerView = dynamic(
  () => import('@/components/dashboard/messenger-view').then(m => ({ default: m.MessengerView })),
  { loading: viewLoading },
)
const CatalogVisualView = dynamic(
  () => import('@/components/dashboard/catalog-visual-view').then(m => ({ default: m.CatalogVisualView })),
  { loading: viewLoading },
)
const OrdersView = dynamic(
  () => import('@/components/dashboard/orders-view').then(m => ({ default: m.OrdersView })),
  { loading: viewLoading },
)
const KanbanView = dynamic(
  () => import('@/components/dashboard/kanban-view').then(m => ({ default: m.KanbanView })),
  { loading: viewLoading },
)
const OrchestratorView = dynamic(
  () => import('@/components/dashboard/orchestrator-view').then(m => ({ default: m.OrchestratorView })),
  { loading: viewLoading },
)
const AdsView = dynamic(
  () => import('@/components/dashboard/ads-view').then(m => ({ default: m.AdsView })),
  { loading: viewLoading },
)
const MonetizationView = dynamic(
  () => import('@/components/dashboard/monetization-view').then(m => ({ default: m.MonetizationView })),
  { loading: viewLoading },
)
const WalletView = dynamic(
  () => import('@/components/dashboard/wallet-view').then(m => ({ default: m.WalletView })),
  { loading: viewLoading },
)
const LogisticsIntelligenceView = dynamic(
  () => import('@/components/dashboard/logistics-intelligence-view').then(m => ({ default: m.LogisticsIntelligenceView })),
  { loading: viewLoading },
)
const MarketplaceView = dynamic(
  () => import('@/components/dashboard/marketplace-view').then(m => ({ default: m.MarketplaceView })),
  { loading: viewLoading },
)
const NovedadesView = dynamic(
  () => import('@/components/dashboard/novedades-view').then(m => ({ default: m.NovedadesView })),
  { loading: viewLoading },
)
const IntegrationsView = dynamic(
  () => import('@/components/dashboard/integrations-view').then(m => ({ default: m.IntegrationsView })),
  { loading: viewLoading },
)
const SettingsView = dynamic(
  () => import('@/components/dashboard/settings-view').then(m => ({ default: m.SettingsView })),
  { loading: viewLoading },
)
const LLMCostsView = dynamic(
  () => import('@/components/dashboard/llm-costs-view').then(m => ({ default: m.LLMCostsView })),
  { loading: viewLoading },
)
const GovernanceView = dynamic(
  () => import('@/components/dashboard/governance-view').then(m => ({ default: m.GovernanceView })),
  { loading: viewLoading },
)

export default function Home() {
  const [view, setView] = useState<ViewId>('overview')
  const [country, setCountry] = useState('ALL')
  const [searchOpen, setSearchOpen] = useState(false)
  // SPRINT-AI-FRONTEND-001 §1 — budget warning banner state. Populated by
  // the `llm:budget_warning` socket event (Sprint 10C backend). `null` =
  // no banner. Auto-dismissed after 30s via a setTimeout in the listener
  // (cleared on unmount via the cleanup closure of the effect).
  const [budgetWarning, setBudgetWarning] = useState<{ type: string; pct: number; remaining: number } | null>(null)

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

  // ───────────────────────────────────────────────────────────────────────
  // SPRINT-AI-FRONTEND-001 §1 — budget warning banner.
  //
  // Subscribes to the `llm:budget_warning` socket event emitted by
  // `checkBudgetBeforeCall` (Sprint 10C backend) when the daily or
  // monthly LLM spend crosses 80%. The event payload shape is
  // `{ type: 'daily' | 'monthly', pct, spent, budget, remaining,
  //   message }` — we only keep `{ type, pct, remaining }` in state
  // because that's all the banner needs. The banner auto-dismisses
  // after 30s (matches the typical TTL of a budget alert — by then
  // either the operator reacted or the next call already moved the
  // spend past 100% and the 429 path takes over).
  //
  // The socket is the singleton from `@/lib/socket` — it auto-reconnects
  // on transient drops. The cleanup closure tears down the listener on
  // unmount so a HMR or route change doesn't stack duplicate handlers.
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    const handleWarning = (data: { type: string; pct: number; remaining: number }) => {
      setBudgetWarning(data)
      // Auto-dismiss after 30 seconds — the operator has had time to
      // react (raise cap, investigate, throttle). Subsequent 80%
      // crossings will re-emit the event and re-show the banner.
      window.setTimeout(() => setBudgetWarning(null), 30_000)
    }
    socket.on('llm:budget_warning', handleWarning)
    return () => {
      socket.off('llm:budget_warning', handleWarning)
    }
  }, [])

  const handleSelectView = useCallback((v: ViewId) => {
    setView(v)
    setSearchOpen(false)
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido principal
      </a>
      {/* SPRINT-AI-FRONTEND-001 §1 — budget warning banner. Dismissible.
          Triggered by the `llm:budget_warning` socket event when daily
          or monthly LLM spend crosses 80% (Sprint 10C backend). The
          banner spans full width above the sidebar+content so it's
          visible regardless of which view is active. */}
      {budgetWarning && (
        <div
          role="alert"
          aria-live="polite"
          className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-sm text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="truncate">
              Presupuesto {budgetWarning.type === 'daily' ? 'diario' : 'mensual'} de IA al {budgetWarning.pct}% — quedan ${budgetWarning.remaining.toFixed(4)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBudgetWarning(null)}
            aria-label="Cerrar aviso de presupuesto"
            className="text-amber-700 dark:text-amber-300 hover:opacity-70 transition-opacity shrink-0"
          >
            ✕
          </button>
        </div>
      )}
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
          <main id="main-content" className="flex-1 overflow-y-auto scroll-thin">
            <h1 className="sr-only">
              {NAV_ITEMS.find(n => n.id === view)?.label || 'Dashboard'}
            </h1>
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
              {view === 'llm-costs' && <LLMCostsView />}
              {view === 'governance' && <GovernanceView />}
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
              <span className="font-medium text-foreground">ZIAY</span>
            </div>
            <span className="hidden sm:inline">·</span>
            <span>Comercio Conversacional + Atribución Inteligente</span>
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
