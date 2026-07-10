'use client'
import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Search, Bell, Globe, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ViewId, NAV_ITEMS } from './sidebar'
import { useMounted } from '@/hooks/use-mounted'
import { useTenantStore } from '@/hooks/use-tenant'

export function Topbar({ active, country, onCountryChange }: {
  active: ViewId
  country: string
  onCountryChange: (c: string) => void
}) {
  const { theme, setTheme } = useTheme()
  const mounted = useMounted()
  const item = NAV_ITEMS.find(n => n.id === active)
  const { tenants, activeTenant, setTenants, setActive } = useTenantStore()

  useEffect(() => {
    fetch('/api/tenants').then(r => r.json()).then(d => setTenants(d.tenants || []))
  }, [setTenants])

  return (
    <header className="h-16 shrink-0 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="h-full flex items-center gap-3 px-4 md:px-6">
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-base md:text-lg leading-tight truncate">{item?.label}</h1>
          <p className="text-xs text-muted-foreground leading-tight truncate hidden sm:block">
            {active === 'overview' && 'Tu negocio en una pantalla · ingresos, ROAS, CPA y canales'}
            {active === 'messenger' && 'Bandeja unificada WhatsApp + Messenger + Instagram · atribución de campaña'}
            {active === 'orders' && 'Gestión de pedidos · pago anticipado, contra entrega e híbrido configurable'}
            {active === 'ads' && 'Rendimiento por anuncio · CPA, ROAS, ROI y detección de canibalización'}
            {active === 'monetization' && 'Comisión sobre GMV · reconocimiento en 2 momentos · embudo de cobro'}
            {active === 'settings' && 'Estrategia de pago por canal/país · umbrales de auto-pausa · integraciones'}
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

        <Button variant="ghost" size="icon" className="relative h-9 w-9">
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

        <div className="hidden md:flex items-center gap-2 pl-2 border-l">
          <div className="size-8 rounded-full bg-primary/15 ring-1 ring-primary/25 flex items-center justify-center text-xs font-semibold text-primary">VR</div>
          <div className="text-xs leading-tight">
            <div className="font-medium">Valentina R.</div>
            <div className="text-muted-foreground">Admin · {activeTenant?.marca || '—'}</div>
          </div>
        </div>
      </div>
    </header>
  )
}
