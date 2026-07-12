'use client'
import { useState } from 'react'
import { Sidebar, ViewId } from '@/components/dashboard/sidebar'
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
import { Zap, Github, BookOpen } from 'lucide-react'

export default function Home() {
  const [view, setView] = useState<ViewId>('overview')
  const [country, setCountry] = useState('ALL')

  const badges: Partial<Record<ViewId, number>> = {
    messenger: 3,
    ads: 2,
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={view} onChange={setView} badges={badges} />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar active={view} country={country} onCountryChange={setCountry} />
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
