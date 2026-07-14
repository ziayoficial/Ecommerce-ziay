'use client'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useSession, signOut } from 'next-auth/react'
import {
  Sun, Moon, Search, Bell, Globe, Building2, LogOut, User as UserIcon,
  ChevronDown, ShieldCheck, Menu, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { ViewId, NAV_ITEMS } from './sidebar'
import { cn } from '@/lib/utils'
import { useMounted } from '@/hooks/use-mounted'
import { useTenantStore } from '@/hooks/use-tenant'

// Map role → display label + accent color
const ROLE_META: Record<string, { label: string; className: string }> = {
  admin:     { label: 'Admin',     className: 'bg-primary/15 text-primary ring-primary/25' },
  agent:     { label: 'Agente',    className: 'bg-teal-500/15 text-teal-700 ring-teal-500/25' },
  trafficker:{ label: 'Trafficker',className: 'bg-cyan-500/15 text-cyan-700 ring-cyan-500/25' },
  finance:   { label: 'Finance',   className: 'bg-amber-500/15 text-amber-700 ring-amber-500/25' },
  operator:  { label: 'Operator',  className: 'bg-violet-500/15 text-violet-700 ring-violet-500/25' },
  marketing: { label: 'Marketing', className: 'bg-rose-500/15 text-rose-700 ring-rose-500/25' },
}

// Build initials from a name (e.g. "Valentina Restrepo" → "VR")
function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?'
}

export function Topbar({ active, country, onCountryChange, onChangeView, onOpenSearch, badges }: {
  active: ViewId
  country: string
  onCountryChange: (c: string) => void
  onChangeView?: (v: ViewId) => void
  onOpenSearch?: () => void
  badges?: Partial<Record<ViewId, number>>
}) {
  const { theme, setTheme } = useTheme()
  const mounted = useMounted()
  const { data: session, status } = useSession()
  const [signingOut, setSigningOut] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const item = NAV_ITEMS.find(n => n.id === active)
  const { tenants, activeTenant, setTenants, setActive } = useTenantStore()
  // The logged-in user's own tenantId — used to default the tenant switcher so
  // that RBAC-bound API calls (/api/marketplace, /api/novedades, …) don't 403
  // with "tenant mismatch" when the user belongs to a non-first tenant.
  const userTenantId = session?.user?.tenantId ?? undefined

  useEffect(() => {
    fetch('/api/tenants').then(r => r.json()).then(d => setTenants(d.tenants || [], userTenantId))
  }, [setTenants, userTenantId])

  // Lightweight unread-notification count (Messenger priority + Novedades).
  // Best-effort: failures don't break the topbar.
  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      fetch('/api/notifications').then(r => r.ok ? r.json() : null),
    ]).then(([nRes]) => {
      if (cancelled) return
      const n = (nRes.status === 'fulfilled' && nRes.value)?.notifications?.length
      if (typeof n === 'number') setNotifCount(n)
    })
    return () => { cancelled = true }
  }, [])

  const user = session?.user
  const roleMeta = user?.role ? ROLE_META[user.role] || ROLE_META.agent : ROLE_META.agent
  // Prefer session tenant name; fall back to tenant switcher's active tenant.
  const tenantName = user?.tenantName || activeTenant?.marca || '—'

  async function handleLogout() {
    setSigningOut(true)
    // signOut redirects to /login (configured in authOptions.pages.signIn).
    // We pass callbackUrl to bounce back to /login explicitly.
    await signOut({ callbackUrl: '/login', redirect: true })
  }

  function handleMobileNavClick(v: ViewId) {
    setMobileNavOpen(false)
    onChangeView?.(v)
  }

  return (
    <header className="h-16 shrink-0 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="h-full flex items-center gap-2 md:gap-3 px-3 md:px-6">
        {/* ── Mobile: hamburger button (opens Sheet with sidebar nav) ── */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden size-10 shrink-0 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Abrir menú"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="h-16 flex flex-row items-center gap-3 px-5 border-b border-sidebar-border m-0">
              <div className="size-9 rounded-xl bg-primary/20 ring-1 ring-primary/30 flex items-center justify-center">
                <Zap className="size-5 text-primary" />
              </div>
              <SheetTitle className="text-sm font-semibold leading-tight">
                ZIAY
                <span className="block text-[11px] font-normal text-muted-foreground">Comercio Conversacional</span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scroll-thin">
              <div className="px-2 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Operación</div>
              {NAV_ITEMS.map((navItem) => {
                const Icon = navItem.icon
                const isActive = active === navItem.id
                const badge = badges?.[navItem.id]
                return (
                  <button
                    key={navItem.id}
                    onClick={() => handleMobileNavClick(navItem.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative w-full flex items-center gap-3 rounded-lg pl-3 pr-2 py-2.5 text-sm transition-all',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent hover:translate-x-0.5'
                    )}
                  >
                    <span className={cn(
                      'flex size-7 items-center justify-center rounded-md shrink-0',
                      isActive ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground'
                    )}>
                      <Icon className="size-4" />
                    </span>
                    <div className="flex-1 text-left min-w-0">
                      <div className={cn('font-medium leading-tight truncate', isActive ? 'text-primary' : 'text-foreground')}>{navItem.label}</div>
                      <div className="text-[10px] leading-tight truncate text-muted-foreground">{navItem.hint}</div>
                    </div>
                    {badge != null && badge > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full text-[10px] font-semibold flex items-center justify-center tabular-nums shrink-0 bg-primary/20 text-primary">{badge}</span>
                    )}
                  </button>
                )
              })}
            </nav>
          </SheetContent>
        </Sheet>

        {/* ── Title + breadcrumb ── */}
        <div className="flex-1 min-w-0">
          <Breadcrumb>
            <BreadcrumbList className="text-[11px] md:text-xs">
              <BreadcrumbItem>
                <BreadcrumbLink asChild><button type="button" className="hover:text-foreground transition-colors" onClick={() => onChangeView?.('overview')}>Dashboard</button></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-semibold text-sm md:text-base leading-tight line-clamp-1">{item?.label}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <p className="text-[10px] md:text-xs text-muted-foreground leading-snug line-clamp-1 hidden sm:block mt-0.5">
            {active === 'overview' && 'Tu negocio en una pantalla · ingresos, ROAS, CPA y canales'}
            {active === 'messenger' && 'Bandeja unificada WhatsApp + Messenger + Instagram · atribución de campaña'}
            {active === 'catalog' && 'Catálogo visual-primero · filtra por diseño/categoría · chatea con la IA'}
            {active === 'orders' && 'Gestión de pedidos · pago anticipado, contra entrega e híbrido configurable'}
            {active === 'kanban' && 'Tablero §15.1 · 8 columnas · arrastra para cambiar de etapa'}
            {active === 'orchestrator' && 'Pipeline de 9 agentes §12 · ejecuta todo o paso a paso'}
            {active === 'ads' && 'Rendimiento por anuncio · CPA, ROAS, ROI y detección de canibalización'}
            {active === 'monetization' && 'Comisión sobre GMV · reconocimiento en 2 momentos · embudo de cobro'}
            {active === 'integrations' && '5 rutas de catálogo + 3 logística · cotizador · VLM'}
            {active === 'settings' && 'Estrategia de pago por canal/país · umbrales · integraciones'}
          </p>
        </div>

        {/* Tenant switcher — multi-tenant core (desktop only) */}
        <Select value={activeTenant?.id || ''} onValueChange={(v) => {
          const t = tenants.find((x) => x.id === v)
          if (t) setActive(t)
        }}>
          <SelectTrigger className="w-[170px] h-9 hidden md:flex">
            <Building2 className="size-4 mr-1 text-primary" />
            <SelectValue placeholder="Tenant" />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{t.marca}</span>
                  <span className="text-xs text-muted-foreground">· {t.planMonetizacion}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* ── Command palette trigger (desktop button, mobile icon) ── */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onOpenSearch?.()}
                aria-label="Abrir búsqueda rápida (Cmd+K)"
                className="hidden md:flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-xs text-muted-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Search className="size-4" />
                <span>Buscar…</span>
                <kbd className="ml-2 inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </button>
            </TooltipTrigger>
            <TooltipContent>Buscar pedidos, clientes y navegar (Cmd+K)</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Mobile: search icon button (only on <md to avoid double with desktop search button) */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden size-10"
          aria-label="Buscar"
          onClick={() => onOpenSearch?.()}
        >
          <Search className="size-4" />
        </Button>

        <Select value={country} onValueChange={onCountryChange}>
          <SelectTrigger className="w-[120px] h-9 hidden sm:flex">
            <Globe className="size-4 mr-1 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos</SelectItem>
            <SelectItem value="CO">🇨🇴 Colombia</SelectItem>
            <SelectItem value="MX">🇲🇽 México</SelectItem>
            <SelectItem value="ES">🇪🇸 España</SelectItem>
            <SelectItem value="DE">🇩🇪 Alemania</SelectItem>
          </SelectContent>
        </Select>

        {/* Notification bell with badge count */}
        <Button variant="ghost" size="icon" className="relative size-10" aria-label={`Notificaciones${notifCount > 0 ? ` (${notifCount} sin leer)` : ''}`}>
          <Bell className="size-4" />
          {notifCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
              {notifCount > 9 ? '9+' : notifCount}
            </span>
          )}
        </Button>

        <Button
          variant="ghost" size="icon" className="size-10"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Cambiar tema"
        >
          {mounted && theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        {/* User menu — authenticated identity + logout */}
        <div className="flex items-center gap-2 pl-2 md:pl-3 border-l">
          {status === 'loading' ? (
            <div className="hidden md:flex items-center gap-2">
              <div className="size-8 rounded-full bg-muted animate-pulse" />
              <div className="space-y-1">
                <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                <div className="h-2.5 w-16 bg-muted rounded animate-pulse" />
              </div>
            </div>
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Menú de usuario"
                >
                  <Avatar className="size-8 ring-1 ring-primary/25">
                    <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                      {initials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden md:block text-xs leading-tight text-left min-w-0">
                    <div className="font-medium line-clamp-1 max-w-[120px] md:max-w-[160px] lg:max-w-[200px]">
                      {user.name || user.email}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1 min-w-0">
                      <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 shrink-0 ${roleMeta.className}`}>
                        {roleMeta.label}
                      </span>
                      <span className="line-clamp-1 max-w-[80px] sm:max-w-[120px] lg:max-w-[160px] hidden lg:inline min-w-0">· {tenantName}</span>
                    </div>
                  </div>
                  <ChevronDown className="hidden md:block size-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex flex-col gap-1">
                  <span className="font-medium truncate">{user.name || 'Usuario'}</span>
                  <span className="text-xs font-normal text-muted-foreground truncate">{user.email}</span>
                  <span className="flex items-center gap-1.5 pt-1">
                    <Badge variant="secondary" className={`${roleMeta.className} border-0 font-semibold`}>
                      <ShieldCheck className="size-3" />
                      {roleMeta.label}
                    </Badge>
                    {user.tenantName && (
                      <Badge variant="outline" className="font-normal">
                        <Building2 className="size-3" />
                        {user.tenantName}
                      </Badge>
                    )}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  <UserIcon className="size-3.5" />
                  ID: <span className="font-mono truncate">{user.id}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="text-destructive focus:text-destructive focus:bg-destructive/5"
                >
                  <LogOut className="size-3.5" />
                  {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            /* Fallback if middleware ever lets an unauthenticated user through */
            <Button asChild size="sm" variant="outline">
              <a href="/login">Iniciar sesión</a>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
