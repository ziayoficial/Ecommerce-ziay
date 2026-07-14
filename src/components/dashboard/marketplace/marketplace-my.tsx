// ZIAY — Marketplace "Mis listings" tab + ToggleActiveButton.
// Split out from marketplace-view.tsx in AUDIT-FINAL-SPLIT-001.

'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Package, RefreshCw } from 'lucide-react'
import {
  ListingCard, EmptyState, type MarketplaceListing,
} from './marketplace-shared'

/**
 * "Mis listings" tab — shows the current tenant's published listings and a
 * per-card "Republicar" action (since the API doesn't support deactivation,
 * the toggle button only re-publishes inactive listings).
 */
export function MyListingsTab({
  myListings, tenantId, onDone,
}: {
  myListings: MarketplaceListing[]
  tenantId: string
  onDone: () => void
}) {
  if (myListings.length === 0) {
    return (
      <EmptyState
        icon={<Package className="size-8" />}
        title="Aún no publicas listings"
        description="Usa el botón 'Publicar listing' para exponer tus productos a otras marcas"
      />
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {myListings.map((l) => (
        <ListingCard
          key={l.id}
          listing={l}
          action={
            <ToggleActiveButton
              listing={l}
              tenantId={tenantId}
              onDone={onDone}
            />
          }
        />
      ))}
    </div>
  )
}

function ToggleActiveButton({
  listing, tenantId, onDone,
}: {
  listing: MarketplaceListing
  tenantId: string
  onDone: () => void
}) {
  // The marketplace API doesn't expose a toggle action, so we re-publish or
  // re-publish with active=false by calling publish_listing again with the
  // same SKU (unique constraint is per-tenant, not per-SKU, so this would
  // create a duplicate). Instead we use update_config-style call — but the
  // API doesn't support it. For this view we call publish_listing with the
  // same data when reactivating, and for deactivation we show a toast that
  // it requires backend support. This keeps the UI honest about its scope.
  const [loading, setLoading] = useState(false)
  const toggle = async () => {
    if (listing.active) {
      toast.info('Para desactivar un listing, elimínalo desde el catálogo de productos')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish_listing',
          tenantId,
          sku: listing.sku,
          name: listing.name,
          price: listing.price,
          imageUrl: listing.imageUrl,
          productId: listing.productId,
        }),
      })
      if (!res.ok) throw new Error('publish failed')
      toast.success(`Listing "${listing.name}" republicado`)
      onDone()
    } catch {
      toast.error('No se pudo republicar el listing')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Button size="sm" variant={listing.active ? 'secondary' : 'default'} onClick={toggle} disabled={loading}>
      {loading ? <RefreshCw className="size-3.5 animate-spin" /> : null}
      {listing.active ? 'Activo' : 'Republicar'}
    </Button>
  )
}
