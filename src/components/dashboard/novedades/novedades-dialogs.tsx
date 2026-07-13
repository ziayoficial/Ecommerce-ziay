// ZIAY — Novedades create-case + create-redelivery dialogs.
// Split out from novedades-view.tsx in SPRINT3-REFACTOR-001 — no UI changes.

'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Plus } from 'lucide-react'

// ───────────────────────────────────────────────────────────────────────────
// CreateCaseDialog
// ───────────────────────────────────────────────────────────────────────────

export function CreateCaseDialog({ open, onOpenChange, tenantId, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tenantId: string | undefined
  onCreated: () => void
}) {
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [guideNumber, setGuideNumber] = useState('')
  const [carrierName, setCarrierName] = useState('Servientrega')
  const [type, setType] = useState('paquete_perdido')
  const [priority, setPriority] = useState('normal')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!tenantId) { toast.error('Sin tenant activo'); return }
    if (!customerName || !phone || !description) { toast.error('Cliente, teléfono y descripción son obligatorios'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/novedades?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName, phone, guideNumber: guideNumber || undefined,
          carrierName: carrierName || undefined, type, priority, description,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'No se pudo crear')
      }
      toast.success('Caso creado')
      onOpenChange(false)
      setCustomerName(''); setPhone(''); setGuideNumber(''); setDescription('')
      onCreated()
    } catch (e: any) {
      toast.error(e?.message || 'Error al crear caso')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-emerald-600" /> Nuevo caso de novedad</DialogTitle>
          <DialogDescription>Registra un incidente logístico o de producto.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Nombre del cliente *</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Teléfono *</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Número de guía</Label>
              <Input value={guideNumber} onChange={e => setGuideNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Transportista</Label>
              <Select value={carrierName} onValueChange={setCarrierName}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Servientrega">Servientrega</SelectItem>
                  <SelectItem value="Coordinadora">Coordinadora</SelectItem>
                  <SelectItem value="Envia">Envia</SelectItem>
                  <SelectItem value="TCC">TCC</SelectItem>
                  <SelectItem value="DHL">DHL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paquete_perdido">Paquete perdido</SelectItem>
                  <SelectItem value="producto_danado">Producto dañado</SelectItem>
                  <SelectItem value="direccion_incorrecta">Dirección incorrecta</SelectItem>
                  <SelectItem value="retraso">Retraso</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Descripción *</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin mr-1" />}
            Crear caso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CreateRedeliveryDialog
// ───────────────────────────────────────────────────────────────────────────

export function CreateRedeliveryDialog({ open, onOpenChange, tenantId, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tenantId: string | undefined
  onCreated: () => void
}) {
  const [guideNumber, setGuideNumber] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [originalAddress, setOriginalAddress] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!tenantId) { toast.error('Sin tenant activo'); return }
    if (!guideNumber || !customerName || !customerPhone || !originalAddress || !reason) {
      toast.error('Completa todos los campos obligatorios')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/redelivery?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guideNumber, customerName, customerPhone, originalAddress,
          newAddress: newAddress || undefined, reason,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'No se pudo crear')
      }
      toast.success('Reintento creado')
      onOpenChange(false)
      setGuideNumber(''); setCustomerName(''); setCustomerPhone('')
      setOriginalAddress(''); setNewAddress(''); setReason('')
      onCreated()
    } catch (e: any) {
      toast.error(e?.message || 'Error al crear reintento')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-emerald-600" /> Nuevo reintento de entrega</DialogTitle>
          <DialogDescription>Programa un nuevo intento de entrega para una guía fallida.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Número de guía *</Label>
            <Input value={guideNumber} onChange={e => setGuideNumber(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Cliente *</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Teléfono *</Label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Dirección original *</Label>
            <Textarea value={originalAddress} onChange={e => setOriginalAddress(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <Label>Nueva dirección (opcional)</Label>
            <Textarea value={newAddress} onChange={e => setNewAddress(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <Label>Motivo *</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin mr-1" />}
            Crear reintento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
