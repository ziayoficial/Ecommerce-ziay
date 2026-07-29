/**
 * Dashboard client island — handles all interactivity.
 * @see docs/adr/0016-ssr-shell-pattern.md
 */
'use client'
// SPRINT-SSR-SHELL-001 §1 — Dashboard client island.
//
// This component owns ALL the dashboard's client-side state (active view,
// country filter, command-palette open/close, budget-warning banner,
// keyboard shortcuts) and renders the Sidebar + Topbar + active view +
// command palette + budget banner.
//
// It is loaded via `next/dynamic` from the server component at
// `src/app/page.tsx`. The server component fetches the session with
// `getServerSession(authOptions)` and redirects unauthenticated users to
// `/login` BEFORE this client component mounts — so the `session` prop
// here is always defined (the `'use client'` island can trust it without
// re-fetching via `useSession()`).
//
// Sidebar/Topbar are themselves client components (they use hooks:
// `useTheme`, `useSession`, `useTenantStore`, `useMounted`). They are
// SSR'd as part of this island — Next.js pre-renders `'use client'`
// components on the server for the initial HTML payload — so the nav
// items, topbar breadcrumb and user avatar all appear in the very first
// server response (good LCP), then hydrate into interactive islands.
//
// All the lazy `next/dynamic` view imports (MessengerView, OrdersView,
// … GovernanceView) live here so that recharts / @dnd-kit / socket.io /
// qrcode.react / input-otp / @mdxeditor only ship in the chunks that
// actually need them (FIX-PERFORMANCE-001).
import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Session } from 'next-auth'
// IF-1 · P0-1 — `Sidebar` is a client component (kept in `./sidebar`), but
// `NAV_ITEMS` + `ViewId` MUST come from the shared non-`'use client'` module
// `./nav-items` so they aren't wrapped in a client reference proxy when
// re-imported by the Server Component in `src/app/page.tsx`.
import { Sidebar } from '@/components/dashboard/sidebar'
import { NAV_ITEMS, type ViewId } from '@/components/dashboard/nav-items'
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
import { Search, LayoutDashboard, Loader2, AlertTriangle } from 'lucide-react'
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

export interface DashboardClientProps {
  /**
   * Server-resolved NextAuth session. The server component
   * (`src/app/page.tsx`) calls `getServerSession(authOptions)` and
   * `redirect('/login')` if absent, so this prop is always defined when
   * the client island mounts — no need to re-fetch via `useSession()`
   * just to decide whether to render. The Topbar still calls
   * `useSession()` internally for the user avatar/menu (it reads from
   * the SessionProvider context, which is populated from the JWT cookie
   * — no extra network roundtrip), but the dashboard shell itself
   * doesn't gate on `status === 'loading'` anymore.
   */
  session: Session
}

export function DashboardClient({ session: _session }: DashboardClientProps) {
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
    <>
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
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto scroll-thin scroll-mt-16 focus:outline-none">
            {/* sr-only h1 mirrors the server-rendered h1 in `src/app/page.tsx`
                but updates with the active view so screen-reader users who
                navigate by headings hear the context change. The server
                h1 provides a static fallback for crawlers / no-JS. */}
            <h2 className="sr-only">
              {NAV_ITEMS.find(n => n.id === view)?.label || 'Dashboard'}
            </h2>
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
    </>
  )
}
