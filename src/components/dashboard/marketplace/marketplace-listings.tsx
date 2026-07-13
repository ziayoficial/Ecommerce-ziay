// ZIAY — Marketplace cross-brand catalog tab + "Referir" dialog.
// Split out from marketplace-view.tsx in AUDIT-FINAL-SPLIT-001.

'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { ArrowRight, Package, RefreshCw, Share2 } from 'lucide-react'
import {
  ListingCard, EmptyState, type MarketplaceListing,
} from './marketplace-shared'

/**
 * Cross-brand catalog grid. Renders listings from OTHER tenants, each with
 * a "Referir" button that opens the referral dialog.
 */
export function CatalogTab({
  listings, fromTenantId, onDone,
}: {
  listings: MarketplaceListing[]
  fromTenantId: string
  onDone: () => void
}) {
  if (listings.length === 0) {
    return (
      <EmptyState
        icon={<Package className="size-8" />}
        title="Sin listings de otras marcas"
        description="Cuando otras marcas publiquen listings activos, aparecerán aquí"
      />
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {listings.map((l) => (
        <ListingCard
          key={l.id}
          listing={l}
          showBrand
          action={
            <ReferButton
              listing={l}
              fromTenantId={fromTenantId}
              onDone={onDone}
            />
          }
        />
      ))}
    </div>
  )
}

function ReferButton({
  listing, fromTenantId, onDone,
}: {
  listing: MarketplaceListing
  fromTenantId: string
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!phone.trim() || !reason.trim()) {
      toast.error('Teléfono y motivo son obligatorios')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_referral',
          fromTenantId,
          toTenantId: listing.tenantId,
          customerPhone: phone.trim(),
          customerName: name.trim() || null,
          reason: reason.trim(),
        }),
      })
      if (!res.ok) throw new Error('referral failed')
      toast.success(`Referral enviado a ${listing.tenantName}`)
      setOpen(false)
      setPhone(''); setName(''); setReason('')
      onDone()
    } catch {
      toast.error('No se pudo crear el referral')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ArrowRight className="size-3.5" />
          Referir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Referir lead a {listing.tenantName}</DialogTitle>
          <DialogDescription>
            Comparte el contacto de un cliente interesado en &quot;{listing.name}&quot;
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="r-phone" className="text-xs">Teléfono del cliente *</Label>
            <Input id="r-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 123 4567" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-name" className="text-xs">Nombre (opcional)</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="María Pérez" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-reason" className="text-xs">Motivo *</Label>
            <Input id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cliente preguntó por este producto" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <RefreshCw className="size-4 animate-spin" /> : <Share2 className="size-4" />}
            Enviar referral
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
