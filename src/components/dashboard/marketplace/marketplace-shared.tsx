// ZIAY — Shared types, helpers, and small presentational primitives for
// the marketplace cross-brand dashboard view. Split out from
// marketplace-view.tsx in AUDIT-FINAL-SPLIT-001 — no behavior changes,
// just file layout.

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Image from 'next/image'
import { formatCurrency } from '@/lib/format'
import { ImageOff, CheckCircle2, Clock, XCircle } from 'lucide-react'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────
export type MarketplaceListing = {
  id: string
  tenantId: string
  productId: string | null
  sku: string
  name: string
  price: number
  imageUrl: string | null
  active: boolean
  createdAt: string
  tenantName?: string
}

export type LeadShareConfig = {
  id: string
  tenantId: string
  shareLeads: boolean
  commissionPct: number
}

export type LeadReferral = {
  id: string
  fromTenantId: string
  toTenantId: string
  customerPhone: string
  customerName: string | null
  reason: string
  commission: number
  status: string
  createdAt: string
}

export type MarketplaceData = {
  listings: MarketplaceListing[]
  myListings: MarketplaceListing[]
  leadConfig: LeadShareConfig | null
  referrals: { sent: LeadReferral[]; received: LeadReferral[] }
  currentTenant: { id: string; slug: string; marca: string; nombreNegocio: string } | null
  stats: {
    totalListings: number
    myListingsCount: number
    connectedTenants: number
    totalReferrals: number
    sentReferrals: number
    receivedReferrals: number
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
export function referralStatusMeta(status: string) {
  switch (status) {
    case 'converted':
      return { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20', label: 'Convertido', icon: <CheckCircle2 className="size-3" /> }
    case 'pending':
      return { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20', label: 'Pendiente', icon: <Clock className="size-3" /> }
    case 'expired':
      return { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20', label: 'Expirado', icon: <XCircle className="size-3" /> }
    default:
      return { cls: 'bg-muted text-muted-foreground', label: status, icon: null }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Shared presentational primitives (used by multiple tabs)
// ───────────────────────────────────────────────────────────────────────────
export function ListingCard({
  listing, action, showBrand,
}: {
  listing: MarketplaceListing
  action: React.ReactNode
  showBrand?: boolean
}) {
  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="aspect-[4/3] bg-muted relative shrink-0">
        {listing.imageUrl ? (
          <Image
            src={listing.imageUrl}
            alt={listing.name}
            fill
            className="object-cover"
            sizes="300px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
            <ImageOff className="size-10" />
          </div>
        )}
        {!listing.active && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
            <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>
          </div>
        )}
      </div>
      <CardContent className="p-3 flex-1 flex flex-col gap-2">
        {showBrand && listing.tenantName && (
          <Badge variant="outline" className="text-[10px] w-fit truncate max-w-full">
            {listing.tenantName}
          </Badge>
        )}
        <div className="font-medium text-sm leading-tight line-clamp-2" title={listing.name}>
          {listing.name}
        </div>
        <div className="text-[11px] font-mono text-muted-foreground truncate">SKU: {listing.sku}</div>
        <div className="flex items-center justify-between gap-2 mt-auto">
          <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatCurrency(listing.price)}
          </span>
          {action}
        </div>
      </CardContent>
    </Card>
  )
}

export function EmptyState({
  icon, title, description, actionLabel, onAction,
}: {
  icon: React.ReactNode
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <div className="size-14 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-3">
          {icon}
        </div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>
        {actionLabel && onAction && (
          <Button size="sm" variant="outline" onClick={onAction} className="mt-4">
            {actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
