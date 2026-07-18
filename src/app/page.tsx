/**
 * Dashboard home — Server Component shell.
 * @see docs/adr/0016-ssr-shell-pattern.md
 */
// SPRINT-SSR-SHELL-001 §1 — Dashboard SSR shell (server component).
//
// This file is a Next.js Server Component (no `'use client'` directive).
// It runs ONLY on the server, which lets us:
//
//   1. Fetch the session server-side via `getServerSession(authOptions)`.
//      No client-side `useSession()` roundtrip needed before deciding
//      whether to render the shell — the JWT cookie is read once on the
//      server and the session is passed as a prop to the client island.
//
//   2. Redirect unauthenticated users to `/login` BEFORE any HTML is
//      sent. The middleware (`src/middleware.ts`) already does this for
//      every non-public route, but the double-guard here means a
//      misconfigured middleware can't leak the dashboard shell to a
//      logged-out user.
//
//   3. Render the layout shell (skip-link, h1, footer) as static server
//      HTML — these never change between sessions, so they ship in the
//      very first response byte and don't depend on JS hydration. Good
//      for LCP, SEO crawlers that don't run JS, and screen-reader users
//      who land on the page before hydration.
//
// The interactive dashboard (Sidebar + Topbar + active view + command
// palette + budget-warning banner) is hydrated by `DashboardClient`,
// loaded via `next/dynamic` so the 14 lazy view chunks (recharts,
// @dnd-kit, socket.io, qrcode.react, input-otp, @mdxeditor, …) only
// ship in the bundles that actually need them (FIX-PERFORMANCE-001).
//
// Note on Sidebar/Topbar: they are themselves `'use client'` components
// (they use `useTheme`, `useSession`, `useTenantStore`, `useMounted`).
// They are SSR'd as part of the `DashboardClient` island — Next.js
// pre-renders `'use client'` components on the server for the initial
// HTML payload — so the nav items, topbar breadcrumb and user avatar
// all appear in the very first server response, then hydrate into
// interactive islands.
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import dynamic from 'next/dynamic'
// IF-1 · P0-1 — `NAV_ITEMS` MUST be imported from the shared non-`'use client'`
// module (not from `sidebar.tsx`, which is a client component). Importing from
// a `'use client'` module here would make Turbopack return a client reference
// proxy that has no `.find()` method, throwing a TypeError and breaking the
// entire dashboard. See `src/components/dashboard/nav-items.ts`.
import { NAV_ITEMS } from '@/components/dashboard/nav-items'
import { Zap, Github, BookOpen } from 'lucide-react'

const DashboardClient = dynamic(() =>
  import('@/components/dashboard/dashboard-client').then(m => ({ default: m.DashboardClient })),
)

export default async function Home() {
  // Double-guard: middleware already redirects unauthenticated users to
  // /login, but this ensures the dashboard shell never renders for a
  // logged-out user even if middleware is misconfigured.
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  // Initial-view label for the SSR-rendered h1. The client island owns
  // the active-view state and renders a matching sr-only h2 inside
  // <main>; this server h1 provides a static fallback for SEO crawlers
  // and no-JS clients (Sprint 7B a11y/SEO requirement).
  const initialHeading =
    NAV_ITEMS.find((n) => n.id === 'overview')?.label || 'Dashboard'

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido principal
      </a>
      <h1 className="sr-only">{initialHeading}</h1>
      {/*
        DashboardClient renders (as a fragment) the budget-warning banner,
        the Sidebar+Topbar+main flex row, and the global command palette.
        Those nodes become direct flex children of this outer column div,
        so `flex flex-col` lays them out correctly above the <footer>.
      */}
      <DashboardClient session={session} />
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
    </div>
  )
}
