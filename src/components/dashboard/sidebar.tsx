'use client'
// IF-1 · P0-1 — `NAV_ITEMS` and `ViewId` were previously declared inline
// in this file. They have been moved to a shared non-`'use client'`
// module (`./nav-items`) so that Server Components (e.g. `src/app/page.tsx`)
// can import the same constant without Turbopack returning a client
// reference proxy (which broke `.find()` and rendered the entire
// dashboard inaccessible). The Lucide icons imported below are only
// used by the `Sidebar` component itself for the brand mark.
import { cn } from '@/lib/utils'
import { Zap } from 'lucide-react'
import { NAV_ITEMS, type ViewId } from './nav-items'

// Re-export for backwards compatibility with any callers that still
// import from './sidebar' (e.g. topbar.tsx, dashboard-client.tsx).
// New code SHOULD import directly from './nav-items' instead.
export type { ViewId } from './nav-items'
export { NAV_ITEMS } from './nav-items'

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
        <div className="leading-tight min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">ZIAY</div>
          {/* subtitle: text-[11px] + truncate is intentional per audit (sidebar is w-64, 168px available — "Comercio Conversacional" fits at ~131px) */}
          <div className="text-[11px] text-sidebar-foreground/70 whitespace-nowrap overflow-hidden text-ellipsis">Comercio Conversacional</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scroll-thin">
        <div className="px-2 pb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/60 font-medium">Operación</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          const badge = badges[item.id]
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              aria-current={isActive ? 'page' : undefined}
              title={item.label}
              className={cn(
                'group relative w-full flex items-center gap-3 rounded-lg pl-3 pr-2 py-2.5 text-sm transition-all duration-200',
                isActive
                  ? 'bg-primary/15 text-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-0.5 ring-1 ring-transparent hover:ring-sidebar-accent-foreground/10'
              )}
            >
              {/* Active indicator — left bar + icon separator (audited: previously only a color change) */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-primary transition-all duration-200',
                  isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-50 group-hover:opacity-30'
                )}
              />
              <span className={cn(
                'flex size-7 items-center justify-center rounded-md transition-colors shrink-0',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-transparent text-sidebar-foreground/70 group-hover:bg-sidebar-accent-foreground/10 group-hover:text-sidebar-accent-foreground'
              )}>
                <Icon className="size-4" />
              </span>
              <div className="flex-1 text-left min-w-0">
                <div className={cn('text-xs font-medium leading-tight truncate', isActive ? 'text-primary' : 'text-sidebar-foreground')}>{item.label}</div>
                <div className={cn('text-[10px] leading-tight truncate', isActive ? 'text-primary/70' : 'text-sidebar-foreground/70')}>{item.hint}</div>
              </div>
              {badge != null && badge > 0 && (
                <span className={cn(
                  'min-w-5 h-5 px-1.5 rounded-full text-[10px] font-semibold flex items-center justify-center tabular-nums shrink-0',
                  isActive ? 'bg-primary text-primary-foreground' : 'bg-primary/20 text-primary'
                )}>{badge}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="px-4 py-3 border-t border-sidebar-border text-[11px] text-sidebar-foreground/70 space-y-1">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>API · DB · Socket.io conectados</span>
        </div>
        <div>v1.0 · Bogotá · LATAM+EU</div>
      </div>
    </aside>
  )
}
