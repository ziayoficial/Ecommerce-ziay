/**
 * Shared navigation config for the ZIAY dashboard.
 *
 * This module is INTENTIONALLY NOT marked `'use client'`. It is a plain
 * TypeScript constant + type, importable from BOTH:
 *
 *   - Server Components (e.g. `src/app/page.tsx`) — which need the array
 *     to render the initial `<h1>` heading server-side.
 *   - Client Components (e.g. `sidebar.tsx`, `topbar.tsx`,
 *     `dashboard-client.tsx`) — which need the same array to render the
 *     interactive sidebar / command palette.
 *
 * Background (IF-1 / P0-1): previously `NAV_ITEMS` was exported from
 * `sidebar.tsx`, a `'use client'` module. When the Server Component
 * `src/app/page.tsx` imported `NAV_ITEMS` from that client module,
 * Turbopack/Next.js 16 RSC returned a *client reference proxy* instead
 * of the actual array — so `NAV_ITEMS.find(...)` threw
 * `TypeError: NAV_ITEMS.find is not a function`, which the root
 * ErrorBoundary caught and replaced with "Algo salió mal". That made
 * ALL 16 dashboard views inaccessible.
 *
 * The Lucide icon components (`LayoutDashboard`, `MessagesSquare`, …)
 * are React components but they are still plain values — moving them
 * to a non-`'use client'` module does NOT make them server-only; they
 * remain usable from any client component that imports this module.
 *
 * @see docs/adr/0016-ssr-shell-pattern.md
 */
import {
  LayoutDashboard,
  MessagesSquare,
  ShoppingCart,
  Target,
  Settings,
  Zap,
  DollarSign,
  Plug,
  KanbanSquare,
  Workflow,
  Grid3x3,
  Wallet,
  AlertTriangle,
  Truck,
  Store,
  Shield,
} from 'lucide-react'

export type ViewId =
  | 'overview'
  | 'messenger'
  | 'catalog'
  | 'orders'
  | 'kanban'
  | 'orchestrator'
  | 'ads'
  | 'monetization'
  | 'wallet'
  | 'logistics'
  | 'marketplace'
  | 'novedades'
  | 'integrations'
  | 'settings'
  | 'llm-costs'
  | 'governance'

export interface NavItem {
  id: ViewId
  label: string
  icon: typeof LayoutDashboard
  hint: string
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard, hint: 'KPIs · ROAS · CPA' },
  { id: 'messenger', label: 'Mensajería', icon: MessagesSquare, hint: 'WhatsApp · Messenger · IG' },
  { id: 'catalog', label: 'Catálogo Visual', icon: Grid3x3, hint: 'Ver + chatear con IA' },
  { id: 'orders', label: 'Pedidos & Pagos', icon: ShoppingCart, hint: 'Anticipado · Contra entrega' },
  { id: 'kanban', label: 'Kanban operativo', icon: KanbanSquare, hint: 'NocoDB · §10' },
  { id: 'orchestrator', label: 'Orquestador', icon: Workflow, hint: '9 agentes · §12' },
  { id: 'llm-costs', label: 'Costos de IA', icon: DollarSign, hint: 'Tokens · USD · Presupuesto' },
  { id: 'ads', label: 'Atribución de Pauta', icon: Target, hint: 'CPA · ROAS · ROI' },
  { id: 'monetization', label: 'Monetización', icon: DollarSign, hint: 'Comisión sobre GMV' },
  { id: 'wallet', label: 'Wallet', icon: Wallet, hint: 'Balance · Retiros · 2FA' },
  { id: 'logistics', label: 'Inteligencia Logística', icon: Truck, hint: 'Scores · Guías · Alertas' },
  { id: 'marketplace', label: 'Marketplace', icon: Store, hint: 'Cross-brand · Lead sharing' },
  { id: 'novedades', label: 'Novedades', icon: AlertTriangle, hint: 'Incidencias · Escalación' },
  { id: 'governance', label: 'Gobernanza', icon: Shield, hint: 'Escalaciones · Trazabilidad §11' },
  { id: 'integrations', label: 'Catálogo e Integraciones', icon: Plug, hint: 'Shopify · Woo · Dropi' },
  { id: 'settings', label: 'Configuración', icon: Settings, hint: 'Estrategia de pago' },
]
