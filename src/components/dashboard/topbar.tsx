'use client'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useSession, signOut } from 'next-auth/react'
import {
  Sun, Moon, Search, Bell, Globe, Building2, LogOut, User as UserIcon, ChevronDown, ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ViewId, NAV_ITEMS } from './sidebar'
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

export function Topbar({ active, country, onCountryChange }: {
  active: ViewId
  country: string
  onCountryChange: (c: string) => void
}) {
  const { theme, setTheme } = useTheme()
  const mounted = useMounted()
  const { data: session, status } = useSession()
  const [signingOut, setSigningOut] = useState(false)
  const item = NAV_ITEMS.find(n => n.id === active)
  const { tenants, activeTenant, setTenants, setActive } = useTenantStore()

  useEffect(() => {
    fetch('/api/tenants').then(r => r.json()).then(d => setTenants(d.tenants || []))
  }, [setTenants])

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

  return (
    <header className="h-16 shrink-0 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="h-full flex items-center gap-3 px-4 md:px-6">
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm md:text-lg leading-tight line-clamp-2 sm:line-clamp-1">{item?.label}</h1>
          <p className="text-[11px] md:text-xs text-muted-foreground leading-snug line-clamp-1 hidden sm:block">
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

        {/* Tenant switcher — multi-tenant core */}
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

        <div className="hidden lg:flex items-center gap-2 w-56">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="Buscar pedido, cliente, ad ID..." className="pl-8 h-9" />
          </div>
        </div>

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

        <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label="Notificaciones">
          <Bell className="size-4" />
          <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-rose-500" />
        </Button>

        <Button
          variant="ghost" size="icon" className="h-9 w-9"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Cambiar tema"
        >
          {mounted && theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        {/* User menu — authenticated identity + logout */}
        <div className="flex items-center gap-2 pl-2 border-l">
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
                  <div className="hidden md:block text-xs leading-tight text-left">
                    <div className="font-medium line-clamp-1 max-w-[140px]">
                      {user.name || user.email}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1">
                      <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ${roleMeta.className}`}>
                        {roleMeta.label}
                      </span>
                      <span className="line-clamp-1 max-w-[80px]">· {tenantName}</span>
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
